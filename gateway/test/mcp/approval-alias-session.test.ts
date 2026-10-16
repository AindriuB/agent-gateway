import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { chatPost, approvalStatus, imageUpload, toJsonSchema } from '@agent-gateway/protocol';
import { openStore, type Store } from '../../src/store/store.js';
import { OfflineQueue } from '../../src/offline-queue/service.js';
import { QUEUE_CONFIG } from '../../src/offline-queue/repository.js';
import { LinkServer, LinkRegistry, PairingCodes } from '../../src/link/index.js';
import { createSessionServer } from '../../src/mcp/session.js';
import { TestClient, ORIGIN, type Harness } from '../link/helpers.js';
import { pairModule, reconnectModule, until, type FakeModule } from '../routing/harness.js';

const tools = [chatPost, imageUpload, approvalStatus];
const definitions = tools.map((t) => ({
  name: t.name,
  description: t.description,
  category: t.category,
  minRole: t.minRole,
  ...toJsonSchema(t),
}));
let store: Store, queue: OfflineQueue, server: LinkServer, h: Harness;
let clock = 1_000_000;
const browsers: TestClient[] = [],
  clients: Client[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()));
  browsers.splice(0).forEach((b) => b.ws.terminate());
  await server?.close();
  queue?.close();
  store?.close();
});
const owner = (m: FakeModule) => ({ worldId: m.worldId, userId: m.userId, agentId: m.agentId });
async function start() {
  clock = 1_000_000;
  store = openStore(':memory:');
  const registry = new LinkRegistry(),
    codes = new PairingCodes();
  queue = new OfflineQueue(store, registry, undefined, () => clock);
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
}
async function pair(userId: string) {
  const m = await pairModule(h, userId, { userName: userId });
  browsers.push(m.tc);
  m.tc.send({ type: 'toolset', tools: definitions, eventReadAllowed: true });
  await until(() => !!store.queue.catalog(owner(m)));
  return m;
}
const capable = async (m: FakeModule, ids: string[] = []) => {
  m.tc.send({ type: 'approvalState', ids });
  await until(() => queue.capable(h.registry.get(m.worldId, m.userId)!));
};
async function session(user: string) {
  const s = createSessionServer({
    version: '0',
    registry: h.registry,
    queue,
    selector: { world: 'w1', user },
    tools,
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
/** The agent calls a write; the (fake) module answers pending_approval with this alias. */
async function livePending(
  m: FakeModule,
  c: Client,
  alias: string,
  name = chatPost.name,
  args = {},
  /** Frames the module sends before the result, as when its report beats the result frame. */
  before: object[] = [],
) {
  const arguments_ = name === chatPost.name ? { content: 'hello', ...args } : { ...args };
  const result = c.callTool({ name, arguments: arguments_ });
  const call = (await m.tc.next('call')) as { id: string };
  for (const f of before) m.tc.send(f);
  if (before.length) await new Promise((r) => setTimeout(r, 30));
  m.tc.send({
    type: 'result',
    id: call.id,
    ok: true,
    text: 'Waiting for approval',
    structured: { status: 'pending_approval', id: alias },
  });
  const res = await result;
  expect(res.structuredContent).toMatchObject({ status: 'pending_approval', id: alias });
  return res;
}
const rows = (m: FakeModule) => {
  return ['alias-1', 'alias-2', 'alias-3'].flatMap(
    (a) => store.queue.getByAlias(owner(m), a) ?? [],
  );
};
const status = async (c: Client, id: string) =>
  c.callTool({ name: 'approval_status', arguments: { id } });
const offline = async (m: FakeModule) => {
  m.tc.ws.terminate();
  await until(() => !h.registry.get(m.worldId, m.userId));
};

describe('mirrored pending approvals', () => {
  it('creates exactly one row per alias on a capable connection and none on a legacy one', async () => {
    await start();
    const m = await pair('u1');
    const c = await session('u1');
    await livePending(m, c, 'alias-1'); // no list sent: a 7.1-style module
    expect(rows(m)).toHaveLength(0);
    await capable(m);
    await livePending(m, c, 'alias-2');
    await livePending(m, c, 'alias-2'); // a retry that returns the same id (task 109)
    expect(rows(m)).toHaveLength(1);
    expect(rows(m)[0]).toMatchObject({
      approval_alias: 'alias-2',
      state: 'pending',
      tool: chatPost.name,
      args: JSON.stringify({ content: 'hello' }),
      connection_id: h.registry.get(m.worldId, m.userId)!.id,
    });
  });

  it('mirrors nothing for image_upload (redactArgs) or for image bytes in arguments', async () => {
    await start();
    const m = await pair('u1');
    await capable(m);
    const c = await session('u1');
    const png = Buffer.from('89504e470d0a1a0a00000000', 'hex').toString('base64');
    await livePending(m, c, 'alias-1', imageUpload.name, { data: png, mime: 'image/png' });
    await livePending(m, c, 'alias-2', chatPost.name, { content: `data:image/png;base64,${png}` });
    expect(rows(m)).toHaveLength(0);
  });

  it('a report for a held alias is recorded; one from another owner changes nothing', async () => {
    await start();
    const m = await pair('u1');
    const m2 = await pair('u2');
    await capable(m);
    await capable(m2);
    const c = await session('u1');
    await livePending(m, c, 'alias-1');
    m2.tc.send({ type: 'approvalState', id: 'alias-1', state: 'approved' });
    m.tc.send({ type: 'approvalState', id: 'no-such-alias', state: 'approved' });
    m.tc.send({ type: 'approvalState', id: 'alias-1', state: 'denied' });
    await until(() => store.queue.getByAlias(owner(m), 'alias-1')?.alias_report === 'denied');
    expect(store.queue.getByAlias(owner(m2), 'alias-1')).toBeUndefined();
  });

  it('orphans a pending alias on disconnect and answers approval_status with the queued text', async () => {
    await start();
    const m = await pair('u1');
    await capable(m);
    const c = await session('u1');
    await livePending(m, c, 'alias-1');
    await offline(m);
    expect(store.queue.getByAlias(owner(m), 'alias-1')).toMatchObject({
      state: 'pending',
      orphaned_at: expect.any(Number),
    });
    const s = await status(c, 'alias-1');
    expect(s.structuredContent).toMatchObject({ id: 'alias-1', status: 'queued' });
    expect(JSON.stringify(s.content)).toContain('World offline: queued');
    // Another user cannot read it.
    const m2 = await pair('u2');
    await offline(m2);
    const c2 = await session('u2');
    const theirs = await status(c2, 'alias-1');
    expect(theirs.isError).toBe(true);
    expect(JSON.stringify(theirs)).not.toContain('queued for');
  });

  it.each(['denied', 'expired'] as const)(
    'answers a %s alias from the row after the requester disconnects',
    async (term) => {
      await start();
      const m = await pair('u1');
      await capable(m);
      const c = await session('u1');
      await livePending(m, c, 'alias-1');
      m.tc.send({ type: 'approvalState', id: 'alias-1', state: term });
      await until(() => store.queue.getByAlias(owner(m), 'alias-1')?.alias_report === term);
      await offline(m);
      const s = await status(c, 'alias-1');
      expect(s.isError).toBeFalsy();
      expect(s.structuredContent).toMatchObject({ id: 'alias-1', status: term });
    },
  );

  it('an offline retry of the same call returns the open alias and adds no row', async () => {
    await start();
    const m = await pair('u1');
    await capable(m);
    const c = await session('u1');
    await livePending(m, c, 'alias-1');
    await offline(m);
    const again = await c.callTool({ name: chatPost.name, arguments: { content: 'hello' } });
    expect(again.structuredContent).toMatchObject({ status: 'pending_approval', id: 'alias-1' });
    const other = await c.callTool({ name: chatPost.name, arguments: { content: 'different' } });
    expect((other.structuredContent as { id: string }).id).not.toBe('alias-1');
    // Only the different call became a new row.
    expect(store.queue.queued(owner(m))).toHaveLength(1);
    expect(rows(m)).toHaveLength(1);
  });

  it('an approved alias becomes unknown on disconnect and is never replayed', async () => {
    await start();
    const m = await pair('u1');
    await capable(m);
    const c = await session('u1');
    await livePending(m, c, 'alias-1');
    m.tc.send({ type: 'approvalState', id: 'alias-1', state: 'approved' });
    await until(() => store.queue.getByAlias(owner(m), 'alias-1')?.alias_report === 'approved');
    await offline(m);
    expect(store.queue.getByAlias(owner(m), 'alias-1')?.state).toBe('unknown');
    const re = await reconnectModule(h, m);
    browsers.push(re.tc);
    re.tc.send({ type: 'toolset', tools: definitions, eventReadAllowed: true });
    await capable(re);
    await new Promise((r) => setTimeout(r, 50));
    expect(re.tc.messages.some((x) => x.type === 'queuedCalls')).toBe(false);
    expect(JSON.stringify(await status(c, 'alias-1'))).toContain('outcome unknown');
  });

  it('a same-tab reconnect that still lists the id goes back to live and is not replayed', async () => {
    await start();
    const m = await pair('u1');
    await capable(m);
    const c = await session('u1');
    await livePending(m, c, 'alias-1');
    await offline(m);
    const re = await reconnectModule(h, m);
    browsers.push(re.tc);
    re.tc.send({ type: 'toolset', tools: definitions, eventReadAllowed: true });
    await capable(re, ['alias-1']);
    await new Promise((r) => setTimeout(r, 50));
    expect(re.tc.messages.some((x) => x.type === 'queuedCalls')).toBe(false);
    expect(store.queue.getByAlias(owner(m), 'alias-1')).toMatchObject({
      state: 'pending',
      orphaned_at: null,
      connection_id: h.registry.get(m.worldId, m.userId)!.id,
    });
    // The module is asked again for the status, as for any live approval.
    const asked = status(c, 'alias-1');
    const call = (await re.tc.next('call')) as { id: string; tool: string };
    expect(call.tool).toBe('approval_status');
    re.tc.send({
      type: 'result',
      id: call.id,
      ok: true,
      text: 'pending',
      structured: { id: 'alias-1', status: 'pending' },
    });
    expect((await asked).structuredContent).toMatchObject({ status: 'pending' });
  });

  it('a reload (empty list) requeues the orphan; approving the replay runs it once and answers the alias', async () => {
    await start();
    const m = await pair('u1');
    await capable(m);
    const c = await session('u1');
    await livePending(m, c, 'alias-1');
    await offline(m);
    const re = await reconnectModule(h, m);
    browsers.push(re.tc);
    re.tc.send({ type: 'toolset', tools: definitions, eventReadAllowed: true });
    await capable(re, []);
    const batch = (await re.tc.next('queuedCalls')) as {
      calls: { id: string; tool: string; args: unknown }[];
    };
    expect(batch.calls).toHaveLength(1);
    expect(batch.calls[0]).toMatchObject({ tool: chatPost.name, args: { content: 'hello' } });
    const qid = batch.calls[0]!.id;
    re.tc.send({ type: 'queuedStatus', id: qid, status: 'pending', text: 'Awaiting approval' });
    await until(() => store.queue.get(owner(m), qid)?.state === 'pending');
    re.tc.send({ type: 'queuedStatus', id: qid, status: 'approved', text: 'ran once' });
    await until(() => store.queue.get(owner(m), qid)?.state === 'approved');
    // A second hello list (or duplicate reply) never replays it again.
    re.tc.send({ type: 'approvalState', ids: [] });
    await new Promise((r) => setTimeout(r, 50));
    expect(re.tc.messages.filter((x) => x.type === 'queuedCalls')).toHaveLength(0);
    const s = await status(c, 'alias-1');
    expect(s.structuredContent).toMatchObject({
      id: 'alias-1',
      status: 'approved',
      result: 'ran once',
    });
  });

  it('an orphan past its deadline expires and is never replayed', async () => {
    await start();
    const m = await pair('u1');
    await capable(m);
    const c = await session('u1');
    await livePending(m, c, 'alias-1');
    await offline(m);
    clock += QUEUE_CONFIG.ttlMs + 1;
    const s = await status(c, 'alias-1');
    expect(s.structuredContent).toMatchObject({ status: 'expired' });
    const re = await reconnectModule(h, m);
    browsers.push(re.tc);
    re.tc.send({ type: 'toolset', tools: definitions, eventReadAllowed: true });
    await capable(re, []);
    await new Promise((r) => setTimeout(r, 50));
    expect(re.tc.messages.some((x) => x.type === 'queuedCalls')).toBe(false);
  });

  it("survives a gateway restart: the orphan is asked again on the owner's next hello", async () => {
    await start();
    const m = await pair('u1');
    await capable(m);
    const c = await session('u1');
    await livePending(m, c, 'alias-1');
    await offline(m);
    // A new process over the same db: its start-up sweep must keep the orphan.
    new OfflineQueue(store, new LinkRegistry(), undefined, () => clock).close();
    expect(store.queue.getByAlias(owner(m), 'alias-1')?.state).toBe('pending');
    const re = await reconnectModule(h, m);
    browsers.push(re.tc);
    re.tc.send({ type: 'toolset', tools: definitions, eventReadAllowed: true });
    await capable(re, []);
    const batch = (await re.tc.next('queuedCalls')) as { calls: { id: string }[] };
    expect(batch.calls).toHaveLength(1);
  });

  it('keeps an approved report that arrives before its row, and applies it', async () => {
    await start();
    const m = await pair('u1');
    await capable(m);
    const c = await session('u1');
    await livePending(m, c, 'alias-1', chatPost.name, {}, [
      { type: 'approvalState', id: 'alias-1', state: 'approved' },
    ]);
    expect(store.queue.getByAlias(owner(m), 'alias-1')).toMatchObject({
      alias_report: 'approved',
      state: 'unknown',
    });
  });

  it('mirrors a call whose link closed before the result was processed, already orphaned', async () => {
    await start();
    const m = await pair('u1');
    await capable(m);
    const c = await session('u1');
    const conn = h.registry.get(m.worldId, m.userId)!;
    await offline(m);
    expect(conn.closed).toBe(true);
    const row = queue.recordLive(conn, 's', chatPost.name, { content: 'late' }, 'alias-3', true);
    expect(row).toMatchObject({
      state: 'pending',
      connection_id: null,
      orphaned_at: expect.any(Number),
    });
    const s = await status(c, 'alias-3');
    expect(s.structuredContent).toMatchObject({ id: 'alias-3', status: 'queued' });
    const re = await reconnectModule(h, m);
    browsers.push(re.tc);
    re.tc.send({ type: 'toolset', tools: definitions, eventReadAllowed: true });
    await capable(re, []);
    expect(((await re.tc.next('queuedCalls')) as { calls: unknown[] }).calls).toHaveLength(1);
  });

  it('flags image bytes behind any data: prefix or in a byte array and mirrors nothing', async () => {
    await start();
    const m = await pair('u1');
    await capable(m);
    const c = await session('u1');
    const png = Buffer.from('89504e470d0a1a0a00000000', 'hex').toString('base64');
    await livePending(m, c, 'alias-1', chatPost.name, {
      content: `data:application/octet-stream;base64,${png}`,
    });
    await livePending(m, c, 'alias-2', chatPost.name, { content: `  \n${png}` });
    expect(rows(m)).toHaveLength(0);
  });

  it('holds a reconnect: the held approval is listed, reported approved, never requeued', async () => {
    await start();
    const m = await pair('u1');
    await capable(m);
    const c = await session('u1');
    await livePending(m, c, 'alias-1');
    await offline(m);
    const re = await reconnectModule(h, m);
    browsers.push(re.tc);
    re.tc.send({ type: 'toolset', tools: definitions, eventReadAllowed: true });
    await capable(re, ['alias-1']); // the held record is still in the list
    re.tc.send({ type: 'approvalState', id: 'alias-1', state: 'approved' });
    await until(() => store.queue.getByAlias(owner(m), 'alias-1')?.state === 'unknown');
    await offline(re);
    const re2 = await reconnectModule(h, m);
    browsers.push(re2.tc);
    re2.tc.send({ type: 'toolset', tools: definitions, eventReadAllowed: true });
    await capable(re2, []);
    await new Promise((r) => setTimeout(r, 50));
    expect(re2.tc.messages.some((x) => x.type === 'queuedCalls')).toBe(false);
    expect(JSON.stringify(await status(c, 'alias-1'))).toContain('outcome unknown');
  });

  it('a second tab with an empty list takes the approval over: asked once, in the new tab', async () => {
    await start();
    const m = await pair('u1');
    await capable(m);
    const c = await session('u1');
    await livePending(m, c, 'alias-1');
    // The new tab connects while the old link is still registered; its empty list requeues the row.
    const re = await reconnectModule(h, m);
    browsers.push(re.tc);
    re.tc.send({ type: 'toolset', tools: definitions, eventReadAllowed: true });
    await capable(re, []);
    const batch = (await re.tc.next('queuedCalls')) as { calls: { id: string }[] };
    expect(batch.calls).toHaveLength(1);
    re.tc.send({
      type: 'queuedStatus',
      id: batch.calls[0]!.id,
      status: 'approved',
      text: 'ran once',
    });
    await until(() => store.queue.get(owner(m), batch.calls[0]!.id)?.state === 'approved');
    expect((await status(c, 'alias-1')).structuredContent).toMatchObject({ status: 'approved' });
  });

  it("answers the pending list with the aliases this connection owns, and no one else's", async () => {
    await start();
    const m = await pair('u1');
    const m2 = await pair('u2');
    await capable(m);
    await capable(m2);
    const c = await session('u1');
    await livePending(m, c, 'alias-1');
    await offline(m);
    const re = await reconnectModule(h, m);
    browsers.push(re.tc);
    re.tc.send({ type: 'toolset', tools: definitions, eventReadAllowed: true });
    // Another user claims u1's alias in its own list: it is never confirmed to them.
    await m2.tc.next('approvalOwnership'); // the reply to its first (empty) list
    m2.tc.send({ type: 'approvalState', ids: ['alias-1', 'nope'] });
    expect(await m2.tc.next('approvalOwnership')).toMatchObject({
      ids: [],
      unknown: ['alias-1', 'nope'],
    });
    await capable(re, ['alias-1', 'not-held']);
    expect(await re.tc.next('approvalOwnership')).toMatchObject({
      ids: ['alias-1'],
      unknown: ['not-held'],
    });
  });

  it('a stale tab is not confirmed: X runs once, in the tab that took it over', async () => {
    await start();
    const m = await pair('u1');
    await capable(m);
    const c = await session('u1');
    await livePending(m, c, 'alias-1');
    // Tab B takes over (A's link just died silently), gets X requeued, and it runs once.
    const b = await reconnectModule(h, m);
    browsers.push(b.tc);
    b.tc.send({ type: 'toolset', tools: definitions, eventReadAllowed: true });
    await capable(b, []);
    expect(await b.tc.next('approvalOwnership')).toMatchObject({ ids: [] });
    const batch = (await b.tc.next('queuedCalls')) as { calls: { id: string }[] };
    const qid = batch.calls[0]!.id;
    b.tc.send({ type: 'queuedStatus', id: qid, status: 'approved', text: 'ran once' });
    await until(() => store.queue.get(owner(m), qid)?.state === 'approved');
    await offline(b);
    // Tab A wakes up, reconnects and lists X: it is not owned, and nothing is replayed.
    const a = await reconnectModule(h, m);
    browsers.push(a.tc);
    a.tc.send({ type: 'toolset', tools: definitions, eventReadAllowed: true });
    await capable(a, ['alias-1']);
    // The gateway knows X (it was requeued and run elsewhere): not owned, not unknown.
    expect(await a.tc.next('approvalOwnership')).toMatchObject({ ids: [], unknown: [] });
    await new Promise((r) => setTimeout(r, 50));
    expect(a.tc.messages.some((x) => x.type === 'queuedCalls')).toBe(false);
    expect(store.queue.getByAlias(owner(m), 'alias-1')).toMatchObject({ state: 'approved' });
  });

  it('keeps an early report across the disconnect and applies it to an orphan inserted late', async () => {
    await start();
    const m = await pair('u1');
    await capable(m);
    await session('u1');
    const conn = h.registry.get(m.worldId, m.userId)!;
    m.tc.send({ type: 'approvalState', id: 'alias-3', state: 'approved' });
    await new Promise((r) => setTimeout(r, 50));
    await offline(m);
    const row = queue.recordLive(conn, 's', chatPost.name, { content: 'late' }, 'alias-3', true);
    expect(row).toBeDefined();
    expect(store.queue.getByAlias(owner(m), 'alias-3')).toMatchObject({
      alias_report: 'approved',
      state: 'unknown',
    });
  });
});
