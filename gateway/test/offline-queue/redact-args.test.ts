import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  chatPost,
  approvalStatus,
  imageUpload,
  TOOLS,
  toJsonSchema,
} from '@agent-gateway/protocol';
import { openStore, type Store } from '../../src/store/store.js';
import { OfflineQueue } from '../../src/offline-queue/service.js';
import { LinkServer, LinkRegistry, PairingCodes, LinkCallError } from '../../src/link/index.js';
import { createSessionServer } from '../../src/mcp/session.js';
import { TestClient, ORIGIN, type Harness } from '../link/helpers.js';
import { pairModule, until } from '../routing/harness.js';

const redacted = TOOLS.filter((t) => t.redactArgs?.length);
const define = (t: (typeof TOOLS)[number]) => ({
  name: t.name,
  description: t.description,
  category: t.category,
  minRole: t.minRole,
  ...toJsonSchema(t),
});
const definitions = [chatPost, approvalStatus, ...redacted].map(define);
const data = 'QUJD'.repeat(20000); // 80000 base64 chars, >= 64 KiB
const MARK = data.slice(0, 32);

let dir: string, dbPath: string, store: Store, queue: OfflineQueue, server: LinkServer;
const browsers: TestClient[] = [],
  clients: Client[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()));
  browsers.splice(0).forEach((b) => b.ws.terminate());
  await server?.close();
  queue?.close();
  store?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = '';
});
const rows = () => {
  const db = new DatabaseSync(dbPath);
  const all = db.prepare('SELECT * FROM queued_calls').all();
  db.close();
  return all as Record<string, unknown>[];
};

async function offline() {
  dir = mkdtempSync(join(tmpdir(), 'redact-'));
  dbPath = join(dir, 'gw.db');
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
  const h: Harness = {
    store,
    registry,
    codes,
    server,
    port: await server.listen(),
    dbPath,
  };
  const m = await pairModule(h, 'u1');
  browsers.push(m.tc);
  m.tc.send({ type: 'toolset', tools: definitions, eventReadAllowed: true });
  const owner = { worldId: m.worldId, userId: m.userId, agentId: m.agentId };
  await until(() => !!store.queue.catalog(owner));
  m.tc.ws.terminate();
  await until(() => !registry.get(m.worldId, m.userId));
  const s = createSessionServer({
    version: '0',
    registry,
    queue,
    selector: { world: 'w1', user: 'u1' },
    tools: [chatPost, approvalStatus, ...redacted],
    knownIdentities: () =>
      store
        .listActivePairings()
        .map((p) => ({ worldId: p.worldId, userId: p.userId, userName: p.userName })),
  });
  const client = new Client({ name: 'test', version: '0' }),
    [a, b] = InMemoryTransport.createLinkedPair();
  clients.push(client);
  await Promise.all([s.connect(a), client.connect(b)]);
  return { owner, client };
}

describe('redactArgs tools are not queued offline', () => {
  it('has at least one redacted core tool', () => {
    expect(redacted.length).toBeGreaterThan(0);
    expect(redacted.map((t) => t.name)).toContain(imageUpload.name);
  });

  it('direct enqueue throws WORLD_OFFLINE for every redacted tool and stores nothing', async () => {
    const { owner } = await offline();
    for (const t of redacted) {
      let err: unknown;
      try {
        queue.enqueue(owner, 's', t.name, { data, mime: 'image/png' });
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(LinkCallError);
      expect((err as LinkCallError).code).toBe('WORLD_OFFLINE');
      expect((err as LinkCallError).message).not.toContain(MARK);
    }
    expect(rows()).toHaveLength(0);
  });

  it('MCP call is an error, not pending_approval, and no row holds the data', async () => {
    const { client } = await offline();
    for (const t of redacted) {
      const res = (await client.callTool({
        name: t.name,
        arguments: { data, mime: 'image/png' },
      })) as { isError?: boolean; content: { text: string }[]; structuredContent?: unknown };
      expect(res.isError).toBe(true);
      const all = JSON.stringify(res);
      expect(all).toContain('WORLD_OFFLINE');
      expect(all).not.toContain('pending_approval');
      expect(all).not.toContain(MARK);
      expect(res.content[0]!.text).toContain('Nothing was stored or run');
    }
    const r = rows();
    expect(r).toHaveLength(0);
    expect(JSON.stringify(r)).not.toContain(MARK);
  });

  it('a non-redacted write still queues with validated args', async () => {
    const { client } = await offline();
    const res = await client.callTool({ name: 'chat_post', arguments: { content: 'hi' } });
    const sc = res.structuredContent as { status: string; id: string };
    expect(sc.status).toBe('pending_approval');
    expect(sc.id).toBeTruthy();
    const r = rows();
    expect(r).toHaveLength(1);
    expect(JSON.parse(r[0]!.args as string)).toEqual({ content: 'hi' });
  });
});
