import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { chatPost, approvalStatus, toJsonSchema } from '@agent-gateway/protocol';
import { openStore, type Store } from '../../src/store/store.js';
import { OfflineQueue } from '../../src/offline-queue/service.js';
import { LinkServer, LinkRegistry, PairingCodes } from '../../src/link/index.js';
import { createSessionServer } from '../../src/mcp/session.js';
import { safeText } from '../../src/routing/sanitize.js';
import { TestClient, ORIGIN, type Harness } from '../link/helpers.js';
import { pairModule, until } from '../routing/harness.js';

const definitions = [chatPost, approvalStatus].map((t) => ({
  name: t.name,
  description: t.description,
  category: t.category,
  minRole: t.minRole,
  ...toJsonSchema(t),
}));
let store: Store, queue: OfflineQueue, server: LinkServer;
const browsers: TestClient[] = [],
  clients: Client[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()));
  browsers.splice(0).forEach((b) => b.ws.terminate());
  await server?.close();
  queue?.close();
  store?.close();
});

/** Pair a user with the given name, take the browser offline, queue one write. */
async function queueAs(userName: string, shownName = userName) {
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
  const h: Harness = {
    store,
    registry,
    codes,
    server,
    port: await server.listen(),
    dbPath: ':memory:',
  };
  const m = await pairModule(h, 'u1', { userName });
  browsers.push(m.tc);
  m.tc.send({ type: 'toolset', tools: definitions, eventReadAllowed: true });
  await until(
    () => !!store.queue.catalog({ worldId: m.worldId, userId: m.userId, agentId: m.agentId }),
  );
  m.tc.ws.terminate();
  await until(() => !registry.get(m.worldId, m.userId));
  const s = createSessionServer({
    version: '0',
    registry,
    queue,
    selector: { world: 'w1', user: 'u1' },
    tools: [chatPost, approvalStatus],
    knownIdentities: () =>
      store
        .listActivePairings()
        .map((p) => ({ worldId: p.worldId, userId: p.userId, userName: shownName || p.userName })),
  });
  const client = new Client({ name: 'test', version: '0' }),
    [a, b] = InMemoryTransport.createLinkedPair();
  clients.push(client);
  await Promise.all([s.connect(a), client.connect(b)]);
  const reply = await client.callTool({ name: chatPost.name, arguments: { content: 'x' } });
  const id = (reply.structuredContent as { id: string }).id;
  const status = await client.callTool({ name: 'approval_status', arguments: { id } });
  const text = (r: unknown) => (r as { content: { text: string }[] }).content[0]!.text;
  return { reply, status, id, enqueueText: text(reply), statusText: text(status) };
}

describe('offline queue reply wording', () => {
  it('names world and user and the next step in both texts; structuredContent unchanged', async () => {
    const r = await queueAs('Gamemaster');
    for (const t of [r.enqueueText, r.statusText]) {
      expect(t).toContain('queued for Gamemaster in world w1');
      expect(t).toContain('held until Gamemaster opens that world with Agent Gateway connected');
      expect(t).toContain('asks for approval there');
      expect(t).toContain('Nothing has been approved or run yet');
    }
    expect(r.enqueueText).toContain('approval_status');
    expect(r.reply.structuredContent).toEqual({ status: 'pending_approval', id: r.id });
    expect(r.status.structuredContent).toEqual({ id: r.id, status: 'queued' });
  });

  it('sanitises control characters in the name', async () => {
    const name = 'Eve\u001b[31m\u0007\nX';
    const r = await queueAs(name);
    for (const t of [r.enqueueText, r.statusText]) {
      expect(t).not.toMatch(/[\u0000-\u001f\u007f]/);
      expect(t).toContain(safeText(name));
    }
  });

  it('bounds a 500-character name as notConnected does', async () => {
    const name = 'N'.repeat(500);
    const r = await queueAs('Long', name);
    for (const t of [r.enqueueText, r.statusText]) {
      expect(t).toContain(safeText(name));
      expect(t).not.toContain(name);
      expect(t.length).toBeLessThan(600);
    }
  });

  it('falls back to the user id when the name is empty', async () => {
    const r = await queueAs('');
    for (const t of [r.enqueueText, r.statusText]) {
      expect(t).toContain('queued for u1 in world w1');
      expect(t).not.toMatch(/undefined|as \.|for  in/);
    }
  });
});
