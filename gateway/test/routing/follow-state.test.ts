import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { approvalStatus, chatPost, eventsPoll, toJsonSchema } from '@agent-gateway/protocol';
import { EventBuffer } from '../../src/events/buffer.js';
import { OfflineQueue } from '../../src/offline-queue/service.js';
import { LinkRegistry, LinkServer, PairingCodes } from '../../src/link/index.js';
import { createSessionServer } from '../../src/mcp/session.js';
import { openStore } from '../../src/store/index.js';
import { ORIGIN, type Harness } from '../link/helpers.js';
import { pairModule, reconnectModule, until, type FakeModule } from './harness.js';

const definitions = [chatPost, approvalStatus].map((t) => ({
  name: t.name,
  description: t.description,
  category: t.category,
  minRole: t.minRole,
  ...toJsonSchema(t),
}));

let server: LinkServer | undefined;
let events: EventBuffer | undefined;
let queue: OfflineQueue | undefined;
let store: ReturnType<typeof openStore> | undefined;
const clients: Client[] = [];
const modules: FakeModule[] = [];
afterEach(async () => {
  hint.mockClear();
  await Promise.all(clients.splice(0).map((c) => c.close()));
  modules.splice(0).forEach((m) => m.tc.ws.terminate());
  events?.close();
  queue?.close();
  await server?.close();
  store?.close();
});

const hint = vi.fn(() => ({ code: 'ABCD-2345', expiresInMin: 10 }));

async function start() {
  store = openStore(':memory:');
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
  const h: Harness = {
    store,
    registry,
    codes,
    server,
    port: await server.listen(),
    dbPath: ':memory:',
  };
  const session = createSessionServer({
    version: '0',
    registry,
    events,
    queue,
    tools: [chatPost, approvalStatus, eventsPoll],
    pairingHint: hint,
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

const pair = async (h: Harness, userId: string): Promise<FakeModule> => {
  const m = await pairModule(h, userId, { userName: userId });
  modules.push(m);
  m.tc.send({ type: 'toolset', tools: definitions, eventReadAllowed: true });
  await until(
    () => !!store!.queue.catalog({ worldId: m.worldId, userId: m.userId, agentId: m.agentId }),
  );
  return m;
};
const drop = async (h: Harness, m: FakeModule) => {
  m.tc.ws.terminate();
  await until(() => !h.registry.get(m.worldId, m.userId));
};

describe('state tied to a pairing does not follow a re-bind', () => {
  it('a pending events_poll returns when the session re-binds', async () => {
    const { h, client } = await start();
    const a = await pair(h, 'uA');
    const cancel = vi.spyOn(events!, 'cancelSession');
    await client.listTools();
    const poll = client.callTool({ name: 'events_poll', arguments: { after: 0 } });
    await until(() => events!.pendingCount === 1);
    await drop(h, a);
    await pair(h, 'uB');
    await client.listTools();
    expect(cancel).toHaveBeenCalledTimes(1);
    await poll;
    expect(events!.pendingCount).toBe(0);
  });

  it('a queued intent is invisible after re-binding to B and visible again after returning to A', async () => {
    const { h, client } = await start();
    const a = await pair(h, 'uA');
    await client.listTools();
    await drop(h, a);
    const queuedRes = await client.callTool({ name: chatPost.name, arguments: { content: 'x' } });
    expect(queuedRes.structuredContent).toMatchObject({ status: 'pending_approval' });
    // A queued intent is an answer, not a not-connected error: no pairing code is offered.
    expect(hint).not.toHaveBeenCalled();
    const id = (queuedRes.structuredContent as { id: string }).id;

    const b = await pair(h, 'uB');
    const forB = client.callTool({ name: 'approval_status', arguments: { id } });
    // Not in B's queue: it goes over the link to B, which is where the id is unknown.
    const frame = (await b.tc.next('call')) as { id: string };
    b.tc.send({
      type: 'result',
      id: frame.id,
      ok: true,
      text: 'unknown id',
      structured: { id, status: 'unknown' },
    });
    expect(JSON.stringify((await forB).structuredContent)).not.toContain('queued');

    await drop(h, b);
    const back = await reconnectModule(h, a);
    modules.push(back);
    const again = await client.callTool({ name: 'approval_status', arguments: { id } });
    expect(again.structuredContent).toMatchObject({ id, status: 'queued' });
  });
});
