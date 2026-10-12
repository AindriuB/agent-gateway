import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { chatPost, approvalStatus, toJsonSchema } from '@agent-gateway/protocol';
import { openStore, type Store } from '../../src/store/store.js';
import { OfflineQueue } from '../../src/offline-queue/service.js';
import { LinkServer, LinkRegistry, PairingCodes } from '../../src/link/index.js';
import { createSessionServer } from '../../src/mcp/session.js';
import { toolsets } from '../../src/routing/toolsets.js';
import { TestClient, ORIGIN, hello, type Harness } from '../link/helpers.js';
import { pairModule, reconnectModule, until, type FakeModule } from '../routing/harness.js';
const write = chatPost,
  read = approvalStatus;
const definitions = [write, approvalStatus].map((t) => ({
  name: t.name,
  description: t.description,
  category: t.category,
  minRole: t.minRole,
  ...toJsonSchema(t),
}));
let store: Store, queue: OfflineQueue, server: LinkServer, h: Harness;
const dirs: string[] = [];
const browsers: TestClient[] = [],
  clients: Client[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()));
  browsers.splice(0).forEach((b) => b.ws.terminate());
  await server?.close();
  queue?.close();
  store?.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
async function start(dbPath = ':memory:') {
  store = openStore(dbPath);
  const registry = new LinkRegistry(),
    codes = new PairingCodes();
  queue = new OfflineQueue(store, registry);
  server = new LinkServer({
    store,
    registry,
    codes,
    queue,
    port: 0,
    allowedOrigins: [ORIGIN],
    gatewayVersion: 'test',
  });
  h = { store, registry, codes, server, port: await server.listen(), dbPath: ':memory:' };
  const m = await pairModule(h, 'u1', { userName: 'Alice' });
  browsers.push(m.tc);
  m.tc.send({ type: 'toolset', tools: definitions, eventReadAllowed: true });
  await until(
    () => !!store.queue.catalog({ worldId: m.worldId, userId: m.userId, agentId: m.agentId }),
  );
  return m;
}
async function session(user = 'u1') {
  const s = createSessionServer({
    version: '0',
    registry: h.registry,
    queue,
    selector: { world: 'w1', user },
    tools: [write, approvalStatus],
    knownIdentities: () =>
      store
        .listActivePairings()
        .map((p) => ({ worldId: p.worldId, userId: p.userId, userName: p.userName })),
  });
  const client = new Client({ name: 'test', version: '0' }),
    [a, b] = InMemoryTransport.createLinkedPair();
  clients.push(client);
  await Promise.all([s.connect(a), client.connect(b)]);
  return client;
}
async function offline(m: FakeModule) {
  m.tc.ws.terminate();
  await until(() => !h.registry.get(m.worldId, m.userId));
}
async function queued(client: Client) {
  const result = await client.callTool({ name: write.name, arguments: { content: 'fixture' } });
  expect(result.isError, JSON.stringify(result)).not.toBe(true);
  expect(result.structuredContent).toMatchObject({
    status: 'pending_approval',
    id: expect.any(String),
  });
  return (result.structuredContent as { id: string }).id;
}
describe('real link and MCP durable offline writes', () => {
  it('commits immediate owner receipt, survives session close, and delivers only after fresh matching catalog', async () => {
    const m = await start();
    await offline(m);
    const client = await session();
    const id = await queued(client);
    await client.close();
    const fresh = await session();
    expect(
      (await fresh.callTool({ name: 'approval_status', arguments: { id } })).structuredContent,
    ).toMatchObject({ id, status: 'queued' });
    const re = await reconnectModule(h, m);
    browsers.push(re.tc);
    expect(re.tc.messages.some((x) => x.type === 'queuedCalls')).toBe(false);
    re.tc.send({ type: 'toolset', tools: definitions, eventReadAllowed: true });
    const batch = await re.tc.next('queuedCalls');
    expect(batch).toMatchObject({
      calls: [{ id, tool: write.name, args: { content: 'fixture' }, definition: definitions[0] }],
    });
    re.tc.send({ type: 'queuedStatus', id, status: 'pending', text: 'Awaiting once approval' });
    await until(
      () =>
        store.queue.get({ worldId: m.worldId, userId: m.userId, agentId: m.agentId }, id)?.state ===
        'pending',
    );
    re.tc.send({
      type: 'queuedStatus',
      id,
      status: 'approved',
      text: 'executed exactly one handler',
    });
    await until(
      () =>
        store.queue.get({ worldId: m.worldId, userId: m.userId, agentId: m.agentId }, id)?.state ===
        'approved',
    );
    re.tc.send({ type: 'queuedStatus', id, status: 'pending', text: 'reordered stale response' });
    expect(
      (await fresh.callTool({ name: 'approval_status', arguments: { id } })).structuredContent,
    ).toMatchObject({ status: 'approved', result: 'executed exactly one handler' });
    await offline(re);
    expect(
      (await fresh.callTool({ name: 'approval_status', arguments: { id } })).structuredContent,
    ).toMatchObject({ status: 'approved' });
  });
  it('never queues reads or binds a fresh offline name selector', async () => {
    const m = await start();
    await offline(m);
    const c = await session();
    expect(
      JSON.stringify(await c.callTool({ name: read.name, arguments: { id: 'missing' } })),
    ).toContain('WORLD_OFFLINE');
    const named = await session(m.userName);
    expect(
      JSON.stringify(
        await named.callTool({ name: write.name, arguments: { content: 'no name fallback' } }),
      ),
    ).toContain('WORLD_OFFLINE');
    expect(
      store.queue.queued({ worldId: m.worldId, userId: m.userId, agentId: m.agentId }),
    ).toHaveLength(0);
    await named.close();
  });
  it('denies changed definition and never automatically resends claimed work after disconnect', async () => {
    const m = await start();
    await offline(m);
    const c = await session(),
      id = await queued(c);
    const re = await reconnectModule(h, m);
    browsers.push(re.tc);
    re.tc.send({ type: 'toolset', tools: definitions, eventReadAllowed: true });
    await re.tc.next('queuedCalls');
    await offline(re);
    const owner = { worldId: m.worldId, userId: m.userId, agentId: m.agentId };
    expect(store.queue.get(owner, id)?.state).toBe('unknown');
    const re2 = await reconnectModule(h, m);
    browsers.push(re2.tc);
    re2.tc.send({ type: 'toolset', tools: definitions, eventReadAllowed: true });
    await until(() => !!toolsets.catalog(h.registry.get(m.worldId, m.userId)!));
    expect(store.queue.queued(owner)).toHaveLength(0);
  });
  it('marks unmatched current definitions denied and does not revive them later', async () => {
    const m = await start();
    await offline(m);
    const c = await session(),
      id = await queued(c),
      re = await reconnectModule(h, m);
    browsers.push(re.tc);
    re.tc.send({
      type: 'toolset',
      tools: [{ ...definitions[0]!, description: 'changed canonical implementation' }],
      eventReadAllowed: true,
    });
    const owner = { worldId: m.worldId, userId: m.userId, agentId: m.agentId };
    await until(() => store.queue.get(owner, id)?.state === 'denied');
    re.tc.send({ type: 'toolset', tools: definitions, eventReadAllowed: true });
    expect(store.queue.queued(owner)).toEqual([]);
  });
  it('refuses revoked owner status and queued writes', async () => {
    const m = await start();
    await offline(m);
    const c = await session(),
      id = await queued(c);
    store.revokePairing(m.agentId);
    expect(
      JSON.stringify(await c.callTool({ name: 'approval_status', arguments: { id } })),
    ).toContain('FORBIDDEN');
    expect(
      JSON.stringify(await c.callTool({ name: write.name, arguments: { content: 'other' } })),
    ).toContain('FORBIDDEN');
  });
  it('rejects older protocol peers before replay', async () => {
    await start();
    const tc = await TestClient.connect(h.port);
    browsers.push(tc);
    tc.send(hello({ kind: 'pairingCode', code: h.codes.generate() }, { protocolVersion: '5.0.0' }));
    expect(await tc.next()).toMatchObject({ type: 'reject', code: 'PROTOCOL_MAJOR_MISMATCH' });
  });
  it('preserves failed approved execution status through duplicate replies, offline session recreation and database reopen', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'queue-status-'));
    dirs.push(dir);
    const path = join(dir, 'q.sqlite');
    const m = await start(path);
    await offline(m);
    const first = await session(),
      id = await queued(first);
    const re = await reconnectModule(h, m);
    browsers.push(re.tc);
    re.tc.send({ type: 'toolset', tools: definitions, eventReadAllowed: true });
    await re.tc.next('queuedCalls');
    re.tc.send({
      type: 'queuedStatus',
      id,
      status: 'approved',
      text: 'FORBIDDEN: macro source changed',
      resultFailed: true,
    });
    await until(
      () =>
        store.queue.get({ worldId: m.worldId, userId: m.userId, agentId: m.agentId }, id)?.state ===
        'approved',
    );
    re.tc.send({
      type: 'queuedStatus',
      id,
      status: 'approved',
      text: 'stale success',
      resultFailed: false,
    });
    await offline(re);
    await first.close();
    await server.close();
    queue.close();
    store.close();
    store = openStore(path);
    queue = new OfflineQueue(store, h.registry);
    const fresh = await session();
    expect(
      (await fresh.callTool({ name: 'approval_status', arguments: { id } })).structuredContent,
    ).toMatchObject({
      id,
      status: 'approved',
      result: 'FORBIDDEN: macro source changed',
      resultFailed: true,
    });
  });
});
