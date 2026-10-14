import { request } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { HttpServer, type HttpPrincipal, type HttpServerOptions } from '../../src/http/index.js';
import { createSessionServer } from '../../src/mcp/session.js';
import { startServer, type Harness } from '../link/helpers.js';
import { fixtureTool, pairModule, tick, type FakeModule } from '../routing/harness.js';

type CallFrame = { type: 'call'; id: string };

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

const PUBLIC = 'https://gw.example.com';

async function setup(over: Partial<HttpServerOptions> = {}) {
  h = await startServer();
  const harness = h;
  http = new HttpServer({
    host: '127.0.0.1',
    port: 0,
    registry: harness.registry,
    version: '9.9.9',
    startedAt: Date.now(),
    createSession: ({ principal }) =>
      createSessionServer({
        version: '0.0.0',
        registry: harness.registry,
        selector: principal.selector
          ? { world: principal.selector.worldId, user: principal.selector.userId, exactId: true }
          : {},
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
  return { h: harness, port };
}

interface Reply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}
const raw = (
  port: number,
  headers: Record<string, string>,
  path = '/mcp',
  body?: string,
): Promise<Reply> =>
  new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          ...(body === undefined
            ? {}
            : {
                'content-type': 'application/json',
                accept: 'application/json, text/event-stream',
              }),
          ...headers,
        },
      },
      (res) => {
        let text = '';
        res.on('data', (c: Buffer) => (text += c.toString()));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: text }),
        );
      },
    );
    req.on('error', reject);
    req.end(body);
  });

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
const asKey =
  (header = 'x-principal') =>
  (req: { headers: Record<string, string | string[] | undefined> }): HttpPrincipal | undefined => {
    const k = req.headers[header];
    return typeof k === 'string' ? { key: k } : undefined;
  };

describe('Host and Origin allowlists', () => {
  it('accepts the public host and origin and refuses others', async () => {
    const { port } = await setup({ publicUrl: PUBLIC });
    const get = (host: string, origin?: string) =>
      raw(port, { host, ...(origin ? { origin } : {}) }, '/status');
    expect((await get('gw.example.com')).status).toBe(200);
    expect((await get('evil.example')).status).toBe(403);
    expect((await get('gw.example.com', PUBLIC)).status).toBe(200);
    expect((await get('gw.example.com', 'https://evil.example')).status).toBe(403);
    expect((await get('gw.example.com', 'http://gw.example.com')).status).toBe(403);
    // Loopback names still work for local testing.
    expect((await get(`127.0.0.1:${port}`, 'http://localhost:30000')).status).toBe(200);
  });

  it('includes a non-default port of the public URL', async () => {
    const { port } = await setup({ publicUrl: 'https://gw.example.com:8443' });
    expect((await raw(port, { host: 'gw.example.com:8443' }, '/status')).status).toBe(200);
    expect((await raw(port, { host: 'gw.example.com' }, '/status')).status).toBe(403);
  });

  it('without a public URL a public host is refused', async () => {
    const { port } = await setup();
    expect((await raw(port, { host: 'gw.example.com' }, '/status')).status).toBe(403);
  });

  it('never reads X-Forwarded-Host', async () => {
    const { port } = await setup({ publicUrl: PUBLIC, trustProxy: true });
    const bad = await raw(
      port,
      { host: 'evil.example', 'x-forwarded-host': 'gw.example.com' },
      '/status',
    );
    expect(bad.status).toBe(403);
    const ok = await raw(
      port,
      { host: 'gw.example.com', 'x-forwarded-host': 'evil.example' },
      '/status',
    );
    expect(ok.status).toBe(200);
  });
});

describe('/status in public mode', () => {
  it('shows version and uptime but no connected users', async () => {
    const { h: harness, port } = await setup({ publicUrl: PUBLIC });
    const m = await pairModule(harness, 'user-secret-id', {
      userName: 'SecretName',
      worldId: 'world-secret',
    });
    modules.push(m);
    const r = await raw(port, { host: 'gw.example.com' }, '/status');
    expect(r.status).toBe(200);
    expect(r.body).toContain('9.9.9');
    expect(r.body).toContain('Uptime');
    for (const s of ['user-secret-id', 'SecretName', 'world-secret'])
      expect(r.body).not.toContain(s);
  });

  it('local mode still lists them', async () => {
    const { h: harness, port } = await setup();
    const m = await pairModule(harness, 'user-secret-id', { userName: 'SecretName' });
    modules.push(m);
    const r = await raw(port, { host: '127.0.0.1' }, '/status');
    expect(r.body).toContain('SecretName');
  });

  it('lists them for a request the authenticator accepts', async () => {
    const { h: harness, port } = await setup({ publicUrl: PUBLIC, authenticate: asKey() });
    const m = await pairModule(harness, 'u1', { userName: 'SecretName' });
    modules.push(m);
    const r = await raw(port, { host: 'gw.example.com', 'x-principal': 'a' }, '/status');
    expect(r.body).toContain('SecretName');
  });
});

describe('per-client limits', () => {
  it('limits failed authentication per client key, before the token is checked', async () => {
    let t = 1_000_000;
    const { port } = await setup({ trustProxy: true, now: () => t });
    const bad = (ip: string) =>
      raw(
        port,
        { host: '127.0.0.1', 'x-forwarded-for': ip, authorization: 'Bearer nope' },
        '/mcp',
        initBody,
      );
    for (let i = 0; i < 10; i++) expect((await bad('203.0.113.9')).status).toBe(401);
    const eleventh = await bad('203.0.113.9');
    expect(eleventh.status).toBe(429);
    expect(eleventh.headers['retry-after']).toBeDefined();
    expect((await bad('203.0.113.10')).status).toBe(401);
    t += 61_000;
    expect((await bad('203.0.113.9')).status).toBe(401);
  });

  it('keys by the TCP peer without --trust-proxy', async () => {
    const { port } = await setup();
    const bad = (ip: string) =>
      raw(port, { host: '127.0.0.1', 'x-forwarded-for': ip }, '/mcp', initBody);
    for (let i = 0; i < 10; i++) await bad(`203.0.113.${i}`);
    expect((await bad('203.0.113.99')).status).toBe(429);
  });

  it('caps sessions per client key in public mode', async () => {
    const { port } = await setup({
      publicUrl: PUBLIC,
      trustProxy: true,
      authenticate: () => ({ key: 'p', selector: { worldId: 'w1', userId: 'u1' } }),
    });
    const init = (ip: string) =>
      raw(port, { host: 'gw.example.com', 'x-forwarded-for': ip }, '/mcp', initBody);
    for (let i = 0; i < 4; i++) expect((await init('203.0.113.9')).status).toBe(200);
    expect((await init('203.0.113.9')).status).toBe(503);
    expect((await init('203.0.113.10')).status).toBe(200);
  });

  it('caps the request rate per client key in public mode', async () => {
    const { port } = await setup({
      publicUrl: PUBLIC,
      trustProxy: true,
      authenticate: () => ({ key: 'p', selector: { worldId: 'w1', userId: 'u1' } }),
      now: () => 5_000_000,
    });
    const poke = (ip: string) =>
      raw(port, { host: 'gw.example.com', 'x-forwarded-for': ip }, '/mcp', '{');
    const a: number[] = [];
    for (let i = 0; i < 11; i++) a.push((await poke('203.0.113.9')).status);
    expect(a.slice(0, 10).every((s) => s === 400)).toBe(true);
    expect(a[10]).toBe(429);
    expect((await poke('203.0.113.10')).status).toBe(400);
  });
});

describe('principal selector seam', () => {
  const connect = async (port: number, principal: string) => {
    const client = new Client({ name: 't', version: '0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
        requestInit: { headers: { 'x-principal': principal } },
      }),
    );
    clients.push(client);
    return client;
  };
  const authenticate = (req: { headers: Record<string, string | string[] | undefined> }) =>
    asKey()(req) && {
      key: 'a',
      selector: { worldId: 'w1', userId: 'u1' },
    };

  it('reaches the granted user only', async () => {
    const { h: harness, port } = await setup({ authenticate });
    const m1 = await pairModule(harness, 'u1', { userName: 'one' });
    const m2 = await pairModule(harness, 'u2', { userName: 'two' });
    modules.push(m1, m2);
    const client = await connect(port, 'a');
    const pending = client.callTool({ name: 'fixture_tool', arguments: { a: 'x' } });
    const frame = (await m1.tc.next('call')) as CallFrame;
    m1.tc.send({ type: 'result', id: frame.id, ok: true, text: 'ok', structured: { b: 'B' } });
    expect((await pending).structuredContent).toEqual({ b: 'B' });
    await tick();
    expect(m2.tc.messages.filter((m) => m.type === 'call')).toEqual([]);
  });

  it('is offline when only another user is connected', async () => {
    const { h: harness, port } = await setup({ authenticate });
    const m2 = await pairModule(harness, 'u2', { userName: 'u1' });
    modules.push(m2);
    const client = await connect(port, 'a');
    const res = (await client.callTool({ name: 'fixture_tool', arguments: { a: 'x' } })) as {
      isError?: boolean;
      content: { text: string }[];
    };
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toMatch(/^WORLD_OFFLINE/);
    await tick();
    expect(m2.tc.messages.filter((m) => m.type === 'call')).toEqual([]);
  });

  it('answers a session id sent with another principal like an unknown session', async () => {
    const { port } = await setup({ authenticate: asKey() });
    const init = await raw(port, { host: '127.0.0.1', 'x-principal': 'a' }, '/mcp', initBody);
    expect(init.status).toBe(200);
    const sid = init.headers['mcp-session-id'] as string;
    const list = JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const other = await raw(
      port,
      { host: '127.0.0.1', 'x-principal': 'b', 'mcp-session-id': sid },
      '/mcp',
      list,
    );
    expect(other.status).toBe(404);
    expect(other.body).toContain('unknown session');
    const same = await raw(
      port,
      { host: '127.0.0.1', 'x-principal': 'a', 'mcp-session-id': sid },
      '/mcp',
      list,
    );
    expect(same.status).toBe(200);
  });
});

describe('failed-auth limit and fail-closed sessions', () => {
  it('a client key at the failed-auth limit gets 429 even with a valid credential', async () => {
    const { port } = await setup({
      authenticate: (req) => (req.headers['x-secret'] === 'good' ? { key: 'a' } : undefined),
      now: () => 9_000_000,
    });
    const go = (secret: string) =>
      raw(port, { host: '127.0.0.1', 'x-secret': secret }, '/mcp', initBody);
    for (let i = 0; i < 10; i++) expect((await go('bad')).status).toBe(401);
    expect((await go('good')).status).toBe(429);
  });

  it('refuses a public session whose principal grants no user', async () => {
    const { port } = await setup({ publicUrl: PUBLIC, authenticate: () => ({ key: 'p' }) });
    const r = await raw(port, { host: 'gw.example.com' }, '/mcp', initBody);
    expect(r.status).toBe(403);
    expect(r.headers['mcp-session-id']).toBeUndefined();
  });
});
