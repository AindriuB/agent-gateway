import { request } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { HttpServer } from '../../src/http/index.js';
import { loadOrCreateToken, rotateToken } from '../../src/http/token.js';
import { openStore } from '../../src/store/index.js';
import { createSessionServer } from '../../src/mcp/session.js';
import { startServer, type Harness } from '../link/helpers.js';
import { fixtureTool, pairModule, until, type FakeModule } from '../routing/harness.js';

type CallFrame = { type: 'call'; id: string; sessionId: string; tool: string };

let h: Harness | undefined;
let http: HttpServer | undefined;
const clients: Client[] = [];
const modules: FakeModule[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close().catch(() => undefined)));
  modules.splice(0).forEach((m) => m.tc.ws.terminate());
  await http?.close();
  http = undefined;
  await h?.server.close();
  h?.store.close();
  h = undefined;
});

const tokenStore = openStore(':memory:');
const token = loadOrCreateToken(tokenStore);
const TOKEN = token.created as string;
token.commit();

async function setup(over: Partial<ConstructorParameters<typeof HttpServer>[0]> = {}) {
  h = await startServer();
  const harness = h;
  http = new HttpServer({
    host: '127.0.0.1',
    port: 0,
    token,
    registry: harness.registry,
    version: '9.9.9',
    startedAt: Date.now(),
    createSession: () =>
      createSessionServer({
        version: '0.0.0',
        registry: harness.registry,
        selector: {},
        knownIdentities: () =>
          harness.store.listActivePairings().map((p) => ({
            worldId: p.worldId,
            userId: p.userId,
            userName: p.userName,
          })),
        tools: [fixtureTool],
        callTimeoutMs: 5000,
      }),
    maxRequestBytes: 10_000,
    rps: 1000,
    maxSessions: 16,
    idleMs: 60_000,
    ...over,
  });
  const port = await http.listen();
  return { h: harness, port, url: `http://127.0.0.1:${port}` };
}

const initBody = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 't', version: '0' },
  },
});
const post = (url: string, body: string, auth: string | null = `Bearer ${TOKEN}`) =>
  fetch(`${url}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(auth ? { authorization: auth } : {}),
    },
    body,
  });

async function connect(url: string): Promise<Client> {
  const client = new Client({ name: 't', version: '0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${url}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${TOKEN}` } },
    }),
  );
  clients.push(client);
  return client;
}

describe('local HTTP transport', () => {
  it('lists and calls a fixture tool through the SDK client', async () => {
    const { h, url } = await setup();
    const m = await pairModule(h, 'u1');
    modules.push(m);
    const client = await connect(url);
    expect((await client.listTools()).tools.map((t) => t.name)).toContain('fixture_tool');
    const pending = client.callTool({ name: 'fixture_tool', arguments: { a: 'x' } });
    const frame = (await m.tc.next('call')) as CallFrame;
    m.tc.send({ type: 'result', id: frame.id, ok: true, text: 'ok', structured: { b: 'B' } });
    expect((await pending).structuredContent).toEqual({ b: 'B' });
  });

  it('rejects missing or wrong tokens with 401', async () => {
    const { url } = await setup();
    expect((await post(url, initBody, null)).status).toBe(401);
    expect((await post(url, initBody, 'Bearer nope')).status).toBe(401);
    expect((await post(url, initBody, `Bearer ${TOKEN}x`)).status).toBe(401);
    expect((await post(url, initBody)).status).toBe(200);
  });

  it('answers 413 over the size limit and 429 over the rate limit', async () => {
    const { url } = await setup({ maxRequestBytes: 200, rps: 3 });
    expect((await post(url, 'x'.repeat(500))).status).toBe(413);
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await post(url, '{')).status);
    expect(statuses).toContain(429);
  });

  it('refuses a foreign Host header', async () => {
    const { port } = await setup();
    const status = await new Promise<number>((resolve, reject) => {
      request(
        { host: '127.0.0.1', port, path: '/status', headers: { host: 'evil.test' } },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      )
        .on('error', reject)
        .end();
    });
    expect(status).toBe(403);
  });

  it('gives each HTTP session its own sessionId toward the module', async () => {
    const { h, url } = await setup();
    const m = await pairModule(h, 'u1');
    modules.push(m);
    const a = await connect(url);
    const b = await connect(url);
    const ids: string[] = [];
    for (const c of [a, b]) {
      const pending = c.callTool({ name: 'fixture_tool', arguments: { a: 'x' } });
      const frame = (await m.tc.next('call')) as CallFrame;
      ids.push(frame.sessionId);
      m.tc.send({ type: 'result', id: frame.id, ok: true, text: 'ok', structured: { b: 'B' } });
      await pending;
    }
    expect(ids[0]).toBeTruthy();
    expect(ids[0]).not.toBe(ids[1]);
  });

  it('replaces the requester own idle session at the cap', async () => {
    const { url } = await setup({ maxSessions: 2 });
    await connect(url);
    await connect(url);
    expect((await post(url, initBody)).status).toBe(200);
    expect(http?.sessionCount).toBe(2);
  });

  it('answers 503 at the cap when other principals hold every session', async () => {
    const { url } = await setup({
      maxSessions: 2,
      authenticate: (req) => {
        const b = req.headers.authorization;
        return typeof b === 'string' ? { key: b } : undefined;
      },
    });
    const as = (who: string) =>
      post(url, initBody, `Bearer ${who}`).then((r) => {
        expect(r.status).toBe(200);
        return r.headers.get('mcp-session-id')!;
      });
    const first = await as('one');
    await as('two');
    expect((await post(url, initBody, 'Bearer three')).status).toBe(503);
    expect(http?.sessionCount).toBe(2);
    const ping = JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/list' });
    const still = await fetch(`${url}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: 'Bearer one',
        'mcp-session-id': first,
      },
      body: ping,
    });
    expect(still.status).toBe(200);
  });

  it('closes idle sessions and runs their cleanup', async () => {
    const { h, url } = await setup({ idleMs: 100 });
    const base = {
      connected: h.registry.listenerCount('connected'),
      disconnected: h.registry.listenerCount('disconnected'),
    };
    await connect(url);
    expect(http?.sessionCount).toBe(1);
    expect(h.registry.listenerCount('connected')).toBeGreaterThan(base.connected);
    await until(() => http?.sessionCount === 0, 3000);
    await until(() => h.registry.listenerCount('connected') === base.connected, 3000);
    expect(h.registry.listenerCount('disconnected')).toBe(base.disconnected);
  });

  it('serves an escaped status page with no secrets', async () => {
    const { h, url } = await setup();
    modules.push(await pairModule(h, 'u1', { userName: '<script>alert(1)</script>' }));
    const res = await fetch(`${url}/status`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('9.9.9');
    expect(html).toContain('Uptime');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain(TOKEN);
    for (const m of modules) expect(html).not.toContain(m.token);
  });
});

describe('http token', () => {
  it('is persisted only on commit, stored hashed, verified, and rotated', () => {
    const store = openStore(':memory:');
    const first = loadOrCreateToken(store);
    expect(first.created).toBeTruthy();
    // A run that never commits (its listen failed) leaves nothing behind.
    expect(store.getHttpTokenHash()).toBeUndefined();
    expect(loadOrCreateToken(store).created).toBeTruthy();
    first.commit();
    expect(store.getHttpTokenHash()).toMatch(/^[0-9a-f]{64}$/);
    expect(store.getHttpTokenHash()).not.toContain(first.created!);
    const second = loadOrCreateToken(store);
    expect(second.created).toBeUndefined();
    expect(second.verify(first.created)).toBe(true);
    expect(second.verify('other')).toBe(false);
    expect(second.verify(undefined)).toBe(false);
    const rotated = rotateToken(store);
    expect(second.verify(first.created)).toBe(false);
    expect(second.verify(rotated)).toBe(true);
    store.close();
  });

  it('commit reports false when a rotation stored a token first', () => {
    const store = openStore(':memory:');
    const mine = loadOrCreateToken(store);
    const rotated = rotateToken(store);
    expect(mine.commit()).toBe(false);
    expect(mine.verify(mine.created)).toBe(false);
    expect(mine.verify(rotated)).toBe(true);
    store.close();
  });
});
