import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { approvalStatus, chatPost, eventsPoll, toJsonSchema } from '@agent-gateway/protocol';
import { EventBuffer } from '../../src/events/buffer.js';
import { OfflineQueue } from '../../src/offline-queue/service.js';
import { LinkRegistry, LinkServer, PairingCodes } from '../../src/link/index.js';
import { createSessionServer, type SessionServerOptions } from '../../src/mcp/session.js';
import { openStore } from '../../src/store/index.js';
import { ORIGIN, type Harness } from '../link/helpers.js';
import { pairModule, tick, until, type FakeModule } from '../routing/harness.js';

const core = [chatPost, approvalStatus, eventsPoll].map((t) => ({
  name: t.name,
  description: t.description,
  category: t.category,
  minRole: t.minRole,
  ...toJsonSchema(t),
}));
const pack = (name: string, category: 'read' | 'write' | 'destructive' | 'code') => ({
  name,
  category,
  minRole: 'player' as const,
  description: `${name} fixture`,
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  outputSchema: { type: 'object', properties: {}, additionalProperties: false },
  pack: { id: 'fixture', version: '1.0.0', prefix: 'fixture' },
});
const announced = [
  ...core,
  pack('fixture-look', 'read'),
  pack('fixture-edit', 'write'),
  pack('fixture-destroy', 'destructive'),
];

let server: LinkServer | undefined;
let events: EventBuffer | undefined;
let queue: OfflineQueue | undefined;
let store: ReturnType<typeof openStore> | undefined;
let dbPath = '';
const clients: Client[] = [];
const modules: FakeModule[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()));
  modules.splice(0).forEach((m) => m.tc.ws.terminate());
  events?.close();
  queue?.close();
  await server?.close();
  store?.close();
});

async function start(allowedCategories: SessionServerOptions['allowedCategories']) {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  dbPath = join(mkdtempSync(join(tmpdir(), 'ag-scopes-')), 'g.db');
  store = openStore(dbPath);
  const registry = new LinkRegistry();
  events = new EventBuffer(store, registry);
  queue = new OfflineQueue(store, registry);
  const codes = new PairingCodes();
  server = new LinkServer({
    store,
    registry,
    codes,
    events,
    queue,
    port: 0,
    allowedOrigins: [ORIGIN],
    gatewayVersion: 'test',
  });
  const h: Harness = { store, registry, codes, server, port: await server.listen(), dbPath };
  const session = createSessionServer({
    version: '0',
    registry,
    events,
    queue,
    tools: [chatPost, approvalStatus, eventsPoll],
    allowedCategories,
    selector: { world: 'w1', user: 'u1', exactId: true },
    knownIdentities: () =>
      store!
        .listActivePairings()
        .map((p) => ({ worldId: p.worldId, userId: p.userId, userName: p.userName })),
  });
  const client = new Client({ name: 't', version: '0' });
  clients.push(client);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([session.connect(a), client.connect(b)]);
  return { h, client };
}

const pair = async (h: Harness): Promise<FakeModule> => {
  const m = await pairModule(h, 'u1');
  modules.push(m);
  m.tc.send({ type: 'toolset', tools: announced, eventReadAllowed: true });
  await until(
    () => !!store!.queue.catalog({ worldId: m.worldId, userId: m.userId, agentId: m.agentId }),
  );
  return m;
};
const queued = (): number => {
  const db = new DatabaseSync(dbPath);
  const n = (db.prepare('SELECT count(*) AS n FROM queued_calls').get() as { n: number }).n;
  db.close();
  return n;
};
const text = (res: unknown): string => JSON.stringify((res as { content: unknown }).content);
const calls = (m: FakeModule) => m.tc.messages.filter((x) => x.type === 'call');

describe('read-only scope', () => {
  it('lists no write, destructive or code tool, core or pack, and keeps gateway_status', async () => {
    const { h, client } = await start(['read']);
    await pair(h);
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(['approval_status', 'events_poll', 'fixture-look', 'gateway_status']);
  });

  it('refuses a write while connected: FORBIDDEN, no frame', async () => {
    const { h, client } = await start(['read']);
    const m = await pair(h);
    await client.listTools();
    for (const name of ['chat_post', 'fixture-edit', 'fixture-destroy']) {
      const res = await client.callTool({ name, arguments: {} });
      expect(res.isError).toBe(true);
      expect(text(res)).toContain('FORBIDDEN');
    }
    await tick();
    expect(calls(m)).toHaveLength(0);
    expect(queued()).toBe(0);
  });

  it('refuses a write while offline: FORBIDDEN, nothing queued, no frame', async () => {
    const { h, client } = await start(['read']);
    const m = await pair(h);
    m.tc.ws.terminate();
    await until(() => !h.registry.get(m.worldId, m.userId));
    const res = await client.callTool({ name: 'chat_post', arguments: { content: 'hi' } });
    expect(res.isError).toBe(true);
    expect(text(res)).toContain('FORBIDDEN');
    // A pack tool's category is unknown offline, so a scoped session cannot call it either.
    const pk = await client.callTool({ name: 'fixture-edit', arguments: {} });
    expect(text(pk)).toContain('FORBIDDEN');
    expect(queued()).toBe(0);
    await tick();
    expect(calls(m)).toHaveLength(0);
  });

  it('control: an unrestricted session queues the same offline write', async () => {
    const { h, client } = await start(undefined);
    const m = await pair(h);
    m.tc.ws.terminate();
    await until(() => !h.registry.get(m.worldId, m.userId));
    const res = await client.callTool({ name: 'chat_post', arguments: { content: 'hi' } });
    expect(JSON.stringify(res)).toContain('pending_approval');
    expect(queued()).toBe(1);
  });
});

describe('read + write scope', () => {
  it('can call a write tool and not a destructive one', async () => {
    const { h, client } = await start(['read', 'write']);
    const m = await pair(h);
    expect((await client.listTools()).tools.map((t) => t.name)).toContain('fixture-edit');
    expect((await client.listTools()).tools.map((t) => t.name)).not.toContain('fixture-destroy');
    const ok = client.callTool({ name: 'fixture-edit', arguments: {} });
    const frame = (await m.tc.next('call')) as { id: string };
    m.tc.send({ type: 'result', id: frame.id, ok: true, text: 'done', structured: {} });
    expect((await ok).isError).toBeFalsy();
    const no = await client.callTool({ name: 'fixture-destroy', arguments: {} });
    expect(no.isError).toBe(true);
    expect(text(no)).toContain('FORBIDDEN');
    await tick();
    // The one frame (the write) was consumed above; the refused destructive call sent none.
    expect(calls(m)).toHaveLength(0);
  });
});
