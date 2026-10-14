import { request } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { HttpServer, type HttpServerOptions } from '../../src/http/index.js';
import { createSessionServer } from '../../src/mcp/session.js';
import { MAX_HTTP_SESSIONS_PER_PRINCIPAL } from '../../src/http/limits.js';
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

async function setup(over: Partial<HttpServerOptions> = {}) {
  gate.hold = false;
  gate.held = [];
  h = await startServer();
  const harness = h;
  mod = await pairModule(harness, 'u1');
  answer(mod);
  const lines: string[] = [];
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
    maxSessions: 64,
    idleMs: 600_000,
    now: () => (clock += 100),
    log: (l) => lines.push(l),
    ...over,
  });
  return { port: await http.listen(), lines };
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
          host: 'gw.example.com',
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

describe('HTTP session eviction', () => {
  it('a principal that never closes sessions opens 20 from rotating IPs', async () => {
    const { port } = await setup();
    for (let i = 1; i <= 20; i++) {
      const ip = `9.129.58.${i}`;
      const r = await init(port, 'chatgpt', ip);
      expect(r.status).toBe(200);
      expect((await call(port, 'chatgpt', ip, r.sid!)).status).toBe(200);
    }
    expect(http!.sessionCount).toBeLessThanOrEqual(MAX_HTTP_SESSIONS_PER_PRINCIPAL);
  });

  it('the same run from one fixed IP also succeeds', async () => {
    const { port } = await setup();
    for (let i = 0; i < 20; i++) {
      const r = await init(port, 'chatgpt', '9.129.58.7');
      expect(r.status).toBe(200);
      expect((await call(port, 'chatgpt', '9.129.58.7', r.sid!)).status).toBe(200);
    }
    expect(http!.sessionCount).toBeLessThanOrEqual(MAX_HTTP_SESSIONS_PER_PRINCIPAL);
  });

  it("never evicts another principal's session", async () => {
    const { port, lines } = await setup();
    const b = [await init(port, 'b', '9.129.58.1'), await init(port, 'b', '9.129.58.1')];
    expect(lines).toEqual([]);
    for (let i = 0; i < 20; i++) expect((await init(port, 'a', '9.129.58.1')).status).toBe(200);
    for (const r of b) expect((await call(port, 'b', '9.129.58.1', r.sid!)).status).toBe(200);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((l) => l.includes('principal=oauth'))).toBe(true);
  });

  it('refuses a ninth principal at the global cap and closes nothing', async () => {
    const { port, lines } = await setup({ maxSessions: 8 });
    const sids: string[] = [];
    for (let i = 0; i < 8; i++) sids.push((await init(port, `p${i}`, `10.0.0.${i}`)).sid!);
    const r = await init(port, 'p8', '10.0.0.8');
    expect(r.status).toBe(503);
    expect(r.body).toContain('too many sessions');
    expect(http!.sessionCount).toBe(8);
    expect(lines).toEqual([]);
    for (let i = 0; i < 8; i++)
      expect((await call(port, `p${i}`, `10.0.0.${i}`, sids[i]!)).status).toBe(200);
  });

  it('at the global cap a principal replaces its own idle session', async () => {
    const { port, lines } = await setup({ maxSessions: 3 });
    const mine = await init(port, 'me', '10.0.0.1');
    await init(port, 'x', '10.0.0.2');
    await init(port, 'y', '10.0.0.3');
    const r = await init(port, 'me', '10.0.0.1');
    expect(r.status).toBe(200);
    expect(http!.sessionCount).toBe(3);
    expect((await call(port, 'me', '10.0.0.1', mine.sid!)).status).toBe(404);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('reason=global-cap');
  });

  it('bounds one client key at 16 across principals, but not a principal elsewhere', async () => {
    const { port } = await setup();
    for (let p = 0; p < 4; p++)
      for (let i = 0; i < 4; i++) expect((await init(port, `o${p}`, '5.5.5.5')).status).toBe(200);
    expect((await init(port, 'fifth', '5.5.5.5')).status).toBe(503);
    expect((await init(port, 'fifth', '5.5.5.6')).status).toBe(200);
  });

  it('never evicts a session with a request in flight', async () => {
    const { port, lines } = await setup();
    const held: Reply[] = [];
    for (let i = 0; i < MAX_HTTP_SESSIONS_PER_PRINCIPAL; i++)
      held.push(await init(port, 'a', '1.1.1.1'));
    // Put every session of 'a' in flight.
    gate.hold = true;
    const pending = held.map((r) => call(port, 'a', '1.1.1.1', r.sid!));
    await until(() => gate.held.length === held.length, 3000);
    const refused = await init(port, 'a', '1.1.1.1');
    expect(refused.status).toBe(503);
    expect(lines).toEqual([]);
    release(mod!);
    for (const p of await Promise.all(pending)) expect(p.status).toBe(200);
    expect((await init(port, 'a', '1.1.1.1')).status).toBe(200);
  });

  it('writes one log line per eviction with no identifiers', async () => {
    const { port, lines } = await setup();
    const first = await init(port, 'grant-secret-id', '203.0.113.77');
    for (let i = 0; i < MAX_HTTP_SESSIONS_PER_PRINCIPAL; i++)
      await init(port, 'grant-secret-id', '203.0.113.77');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(
      /^http session evicted: principal=(oauth|local) reason=(principal-cap|client-cap|global-cap) idle_ms=\d+$/,
    );
    for (const secret of ['grant-secret-id', first.sid!, '203.0.113.77'])
      expect(lines[0]).not.toContain(secret);
  });
});
