import { afterEach, describe, expect, it } from 'vitest';
import { chatPost, toJsonSchema } from '@agent-gateway/protocol';
import { openStore, type Store } from '../../src/store/store.js';
import { OfflineQueue } from '../../src/offline-queue/service.js';
import { LinkServer, LinkRegistry, PairingCodes } from '../../src/link/index.js';
import { TestClient, ORIGIN, type Harness } from './helpers.js';
import { pairModule, until } from '../routing/harness.js';

let store: Store, queue: OfflineQueue, server: LinkServer, h: Harness;
const browsers: TestClient[] = [];
afterEach(async () => {
  browsers.splice(0).forEach((b) => b.ws.terminate());
  await server?.close();
  queue?.close();
  store?.close();
});
const definition = {
  name: chatPost.name,
  description: chatPost.description,
  category: chatPost.category,
  minRole: chatPost.minRole,
  ...toJsonSchema(chatPost),
};
async function start() {
  store = openStore(':memory:');
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
  const m = await pairModule(h, 'u1');
  browsers.push(m.tc);
  const owner = { worldId: m.worldId, userId: m.userId, agentId: m.agentId };
  return { m, owner, conn: () => h.registry.get(m.worldId, m.userId)! };
}

describe('the approvalState frame on the link', () => {
  it('a module that never sent the list is not capable and its transitions are ignored', async () => {
    const { m, owner, conn } = await start();
    const row = store.queue.insertAlias(
      owner,
      's',
      definition,
      { content: 'x' },
      'a1',
      conn().id,
      Date.now(),
    );
    m.tc.send({ type: 'approvalState', id: 'a1', state: 'approved' });
    await new Promise((r) => setTimeout(r, 50));
    expect(queue.capable(conn())).toBe(false);
    expect(store.queue.get(owner, row.id)?.alias_report).toBe('pending');
    expect(m.tc.closed).toBe(false);
  });

  it('the list marks the connection capable and a transition is then recorded', async () => {
    const { m, owner, conn } = await start();
    const row = store.queue.insertAlias(
      owner,
      's',
      definition,
      { content: 'x' },
      'a1',
      conn().id,
      Date.now(),
    );
    m.tc.send({ type: 'approvalState', ids: ['a1'] });
    await until(() => queue.capable(conn()));
    m.tc.send({ type: 'approvalState', id: 'a1', state: 'expired' });
    await until(() => store.queue.get(owner, row.id)?.alias_report === 'expired');
    expect(store.queue.get(owner, row.id)?.state).toBe('expired');
  });

  it('closes the link on a malformed frame', async () => {
    const { m } = await start();
    m.tc.send({ type: 'approvalState', id: 'a1', state: 'bogus' });
    await m.tc.untilClosed();
    expect(m.tc.closed).toBe(true);
  });
});
