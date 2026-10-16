import { request } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { HttpServer, type HttpServerOptions } from '../../src/http/index.js';
import { createSessionServer } from '../../src/mcp/session.js';
import { MAX_HTTP_SESSIONS_PUBLIC } from '../../src/config/index.js';
import { EVICTION_LOG_WINDOW_MS, MAX_HTTP_SESSIONS_PER_PRINCIPAL } from '../../src/http/limits.js';
import { startServer, type Harness } from '../link/helpers.js';
import { fixtureTool, pairModule, until, type FakeModule } from '../routing/harness.js';

let h: Harness | undefined;
let http: HttpServer | undefined;
let mod: FakeModule | undefined;
afterEach(async () => {
  mod?.tc.ws.terminate();
  mod = undefined;
  await http?.close();
  http = undefined;
  await h?.server.close();
  h?.store.close();
  h = undefined;
});

const PUBLIC = 'https://gw.example.com';

/** Held tool calls: set `hold` and the module keeps its answers until `release()`. */
const gate = { hold: false, held: [] as string[] };
function answer(m: FakeModule): void {
  m.tc.ws.on('message', (d) => {
    const f = JSON.parse(d.toString()) as { type: string; id: string };
    if (f.type !== 'call') return;
    const send = () =>
      m.tc.send({ type: 'result', id: f.id, ok: true, text: 'ok', structured: { b: 'B' } });
    if (gate.hold) gate.held.push(f.id);
    else send();
  });
}
function release(m: FakeModule): void {
  for (const id of gate.held.splice(0))
    m.tc.send({ type: 'result', id, ok: true, text: 'ok', structured: { b: 'B' } });
  gate.hold = false;
}

let hostHeader = 'gw.example.com';

async function setup(over: Partial<HttpServerOptions> = {}) {
  hostHeader = 'gw.example.com';
  gate.hold = false;
  gate.held = [];
  h = await startServer();
  const harness = h;
  mod = await pairModule(harness, 'u1');
  answer(mod);
  const lines: string[] = [];
  const debugLines: string[] = [];
  // A ticking clock keeps the per-client request rate under its limit.
  let clock = 1_000_000;
  http = new HttpServer({
    host: '127.0.0.1',
    port: 0,
    registry: harness.registry,
    version: '9.9.9',
    startedAt: Date.now(),
    publicUrl: PUBLIC,
    trustProxy: true,
    authenticate: (req) => {
      const p = req.headers['x-principal'];
      return typeof p === 'string'
        ? { key: `oauth:${p}`, selector: { worldId: 'w1', userId: 'u1' } }
        : undefined;
    },
    createSession: ({ principal }) =>
      createSessionServer({
        version: '0.0.0',
        registry: harness.registry,
        selector: {
          world: principal.selector!.worldId,
          user: principal.selector!.userId,
          exactId: true,
        },
        tools: [fixtureTool],
        callTimeoutMs: 5000,
      }),
    maxRequestBytes: 10_000,
    rps: 1000,
    maxSessions: MAX_HTTP_SESSIONS_PUBLIC,
    idleMs: 600_000,
    now: () => (clock += 100),
    log: (l) => lines.push(l),
    logDebug: (l) => debugLines.push(l),
    ...over,
  });
  return { port: await http.listen(), lines, debugLines };
}

interface Reply {
  status: number;
  sid: string | undefined;
  body: string;
}
const raw = (
  port: number,
  headers: Record<string, string>,
  body: string | undefined,
  method = 'POST',
): Promise<Reply> =>
  new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path: '/mcp',
        method,
        headers: {
          host: hostHeader,
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
          resolve({
            status: res.statusCode ?? 0,
            sid: res.headers['mcp-session-id'] as string | undefined,
            body: text,
          }),
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
const callBody = JSON.stringify({
  jsonrpc: '2.0',
  id: 2,
  method: 'tools/call',
  params: { name: 'fixture_tool', arguments: { a: 'x' } },
});
const init = (port: number, principal: string, ip: string) =>
  raw(port, { 'x-principal': principal, 'x-forwarded-for': ip }, initBody);
const call = (port: number, principal: string, ip: string, sid: string) =>
  raw(port, { 'x-principal': principal, 'x-forwarded-for': ip, 'mcp-session-id': sid }, callBody);

/** Open a GET SSE stream on a session and keep it open; resolves once headers arrive. */
function openStream(
  port: number,
  principal: string,
  ip: string,
  sid: string,
): Promise<{ status: number; close: () => void }> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path: '/mcp',
        method: 'GET',
        headers: {
          host: hostHeader,
          accept: 'text/event-stream',
          'x-principal': principal,
          'x-forwarded-for': ip,
          'mcp-session-id': sid,
        },
      },
      (res) => {
        res.resume();
        resolve({ status: res.statusCode ?? 0, close: () => req.destroy() });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

// Pins today's behaviour for task 110 (spike). It changes nothing in src/.
describe('HTTP session churn from one OAuth principal', () => {
  it('twenty initializes with no DELETE give exactly four evictions, oldest-idle first', async () => {
    const { port, lines, debugLines } = await setup();
    const sids: string[] = [];
    for (let i = 0; i < 20; i++) {
      const r = await init(port, 'chatgpt', '9.129.58.1');
      expect(r.status).toBe(200);
      sids.push(r.sid!);
    }
    expect(MAX_HTTP_SESSIONS_PER_PRINCIPAL).toBe(16);
    expect(lines.length + debugLines.length).toBe(20 - MAX_HTTP_SESSIONS_PER_PRINCIPAL);
    for (const l of [...lines, ...debugLines])
      expect(l).toMatch(/^http session evicted: principal=oauth reason=principal-cap idle_ms=\d+$/);
    // Oldest-idle first: the first four ids are the ones gone, the last sixteen still work.
    for (let i = 0; i < 4; i++)
      expect((await call(port, 'chatgpt', '9.129.58.1', sids[i]!)).status).toBe(404);
    for (let i = 4; i < 20; i++)
      expect((await call(port, 'chatgpt', '9.129.58.1', sids[i]!)).status).toBe(200);
  });

  it('fifty evictions for one principal in ten minutes give one info line, the rest debug', async () => {
    const { port, lines, debugLines } = await setup();
    for (let i = 0; i < MAX_HTTP_SESSIONS_PER_PRINCIPAL + 50; i++)
      expect((await init(port, 'chatgpt', '9.129.58.1')).status).toBe(200);
    expect(lines).toHaveLength(1);
    expect(debugLines).toHaveLength(49);
    // Another principal has its own allowance.
    for (let i = 0; i < MAX_HTTP_SESSIONS_PER_PRINCIPAL + 1; i++)
      await init(port, 'other', '9.129.58.2');
    expect(lines).toHaveLength(2);
  });

  it('logs a second info line once the ten-minute window has passed', async () => {
    let clock = 1_000_000;
    const { port, lines, debugLines } = await setup({ now: () => (clock += 100) });
    const churn = async () => {
      for (let i = 0; i < MAX_HTTP_SESSIONS_PER_PRINCIPAL + 3; i++)
        expect((await init(port, 'chatgpt', '9.129.58.1')).status).toBe(200);
    };
    await churn();
    expect(lines).toHaveLength(1);
    expect(debugLines).toHaveLength(2);
    // Still inside the window: more evictions stay at debug.
    clock += EVICTION_LOG_WINDOW_MS - 60_000;
    await churn();
    expect(lines).toHaveLength(1);
    clock += 120_000;
    await init(port, 'chatgpt', '9.129.58.1');
    expect(lines).toHaveLength(2);
  });

  it('a POST on an evicted session id gets 404 with body "unknown session"', async () => {
    const { port } = await setup();
    const first = await init(port, 'chatgpt', '9.129.58.1');
    for (let i = 0; i < MAX_HTTP_SESSIONS_PER_PRINCIPAL; i++)
      await init(port, 'chatgpt', '9.129.58.1');
    const r = await call(port, 'chatgpt', '9.129.58.1', first.sid!);
    expect(r.status).toBe(404);
    expect(r.body).toContain('unknown session');
  });

  it('a session with only an open GET SSE stream is evictable (the 95 residual)', async () => {
    const { port, lines } = await setup();
    const s: Reply[] = [];
    for (let i = 0; i < MAX_HTTP_SESSIONS_PER_PRINCIPAL; i++)
      s.push(await init(port, 'a', '1.1.1.1'));
    const stream = await openStream(port, 'a', '1.1.1.1', s[0]!.sid!);
    expect(stream.status).toBe(200);
    // The stream refreshed s[0] to most recent; make it the least recent again by touching the rest.
    for (let i = 1; i < s.length; i++)
      expect((await call(port, 'a', '1.1.1.1', s[i]!.sid!)).status).toBe(200);
    expect((await init(port, 'a', '1.1.1.1')).status).toBe(200);
    expect(lines).toHaveLength(1);
    expect((await call(port, 'a', '1.1.1.1', s[0]!.sid!)).status).toBe(404);
    stream.close();
  });

  it('a session with a POST in flight is not evicted', async () => {
    const { port, lines } = await setup();
    const s: Reply[] = [];
    for (let i = 0; i < MAX_HTTP_SESSIONS_PER_PRINCIPAL; i++)
      s.push(await init(port, 'a', '1.1.1.1'));
    // s[0] ends up least recent but has a call in flight, so s[1] goes instead.
    gate.hold = true;
    const busy = call(port, 'a', '1.1.1.1', s[0]!.sid!);
    await until(() => gate.held.length === 1, 3000);
    gate.hold = false;
    // Request start refreshed s[0]; touch the rest so s[0] is least recent while still in flight.
    for (let i = 1; i < s.length; i++)
      expect((await call(port, 'a', '1.1.1.1', s[i]!.sid!)).status).toBe(200);
    expect((await init(port, 'a', '1.1.1.1')).status).toBe(200);
    expect(lines).toHaveLength(1);
    release(mod!);
    expect((await busy).status).toBe(200);
    expect((await call(port, 'a', '1.1.1.1', s[0]!.sid!)).status).toBe(200);
    expect((await call(port, 'a', '1.1.1.1', s[1]!.sid!)).status).toBe(404);
  });
});
