import { request } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { HttpServer, type HttpServerOptions } from '../../src/http/index.js';
import { createSessionServer } from '../../src/mcp/session.js';
import { MAX_HTTP_SESSIONS_PUBLIC } from '../../src/config/index.js';
import {
  MAX_HTTP_SESSIONS_PER_CLIENT,
  MAX_HTTP_SESSIONS_PER_PRINCIPAL,
} from '../../src/http/limits.js';
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

/** Local mode: no public URL, and every client authenticates as the one `local` principal. */
function localOptions(): Partial<HttpServerOptions> {
  hostHeader = '127.0.0.1';
  return {
    publicUrl: undefined,
    authenticate: () => ({ key: 'local', selector: { worldId: 'w1', userId: 'u1' } }),
    maxSessions: 16,
  };
}
const localInit = (port: number, ip: string) => raw(port, { 'x-forwarded-for': ip }, initBody);
const localCall = (port: number, ip: string, sid: string) =>
  raw(port, { 'x-forwarded-for': ip, 'mcp-session-id': sid }, callBody);

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

  it('bounds one client key at 32 across principals, but not a principal elsewhere', async () => {
    const { port } = await setup();
    for (let p = 0; p < 2; p++)
      for (let i = 0; i < 16; i++) expect((await init(port, `o${p}`, '5.5.5.5')).status).toBe(200);
    expect((await init(port, 'third', '5.5.5.5')).status).toBe(503);
    expect((await init(port, 'third', '5.5.5.6')).status).toBe(200);
  });

  it('admits a fifth principal at full quota under the public cap of 256', async () => {
    const { port } = await setup();
    expect(MAX_HTTP_SESSIONS_PUBLIC).toBe(256);
    for (let p = 0; p < 5; p++)
      for (let i = 0; i < MAX_HTTP_SESSIONS_PER_PRINCIPAL; i++)
        expect((await init(port, `q${p}`, `7.7.7.${p}`)).status).toBe(200);
    expect(http!.sessionCount).toBe(5 * MAX_HTTP_SESSIONS_PER_PRINCIPAL);
  });

  it('still holds the global public cap at 256: a seventeenth principal gets 503', async () => {
    const { port, lines } = await setup();
    const principals = MAX_HTTP_SESSIONS_PUBLIC / MAX_HTTP_SESSIONS_PER_PRINCIPAL;
    for (let p = 0; p < principals; p++)
      for (let i = 0; i < MAX_HTTP_SESSIONS_PER_PRINCIPAL; i++)
        expect((await init(port, `g${p}`, `7.8.${p}.1`)).status).toBe(200);
    expect(http!.sessionCount).toBe(MAX_HTTP_SESSIONS_PUBLIC);
    expect((await init(port, 'extra', '7.8.99.1')).status).toBe(503);
    expect(http!.sessionCount).toBe(MAX_HTTP_SESSIONS_PUBLIC);
    expect(lines).toEqual([]);
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

  it('local mode: 17 clients all get 200 and only the least recently active is evicted', async () => {
    const { port, lines } = await setup(localOptions());
    hostHeader = '127.0.0.1';
    const sids: string[] = [];
    for (let i = 1; i <= 17; i++) {
      const r = await localInit(port, `7.7.7.${i}`);
      expect(r.status).toBe(200);
      sids.push(r.sid!);
    }
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('principal=local reason=global-cap');
    expect((await localCall(port, '7.7.7.1', sids[0]!)).status).toBe(404);
    for (let i = 2; i <= 17; i++)
      expect((await localCall(port, `7.7.7.${i}`, sids[i - 1]!)).status).toBe(200);
  });

  it('local mode: a global-cap eviction spares a session in flight', async () => {
    const { port } = await setup(localOptions());
    hostHeader = '127.0.0.1';
    const sids: string[] = [];
    for (let i = 1; i <= 16; i++) sids.push((await localInit(port, `7.7.7.${i}`)).sid!);
    gate.hold = true;
    const busy = localCall(port, '7.7.7.1', sids[0]!);
    await until(() => gate.held.length === 1, 3000);
    expect((await localInit(port, '7.7.7.99')).status).toBe(200);
    release(mod!);
    expect((await busy).status).toBe(200);
    expect((await localCall(port, '7.7.7.2', sids[1]!)).status).toBe(404);
  });

  it('public mode still caps one principal at its own cap', async () => {
    const { port } = await setup();
    const sids: string[] = [];
    for (let i = 1; i <= MAX_HTTP_SESSIONS_PER_PRINCIPAL + 1; i++)
      sids.push((await init(port, 'a', `8.8.8.${i}`)).sid!);
    expect(http!.sessionCount).toBe(MAX_HTTP_SESSIONS_PER_PRINCIPAL);
    expect((await call(port, 'a', '8.8.8.1', sids[0]!)).status).toBe(404);
    expect((await call(port, 'a', '8.8.8.2', sids[1]!)).status).toBe(200);
  });

  it('at the client cap a principal replaces its own oldest session under that client key', async () => {
    const { port, lines } = await setup();
    // Fill the client key: 16 + 13 from others, 3 of its own.
    for (let i = 0; i < 16; i++) await init(port, 'o0', '6.6.6.6');
    for (let i = 0; i < 13; i++) await init(port, 'o1', '6.6.6.6');
    const mine = [];
    for (let i = 0; i < 3; i++) mine.push(await init(port, 'p', '6.6.6.6'));
    expect(lines).toEqual([]);
    expect((await init(port, 'p', '6.6.6.6')).status).toBe(200);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('reason=client-cap');
    expect((await call(port, 'p', '6.6.6.6', mine[0]!.sid!)).status).toBe(404);
    expect((await call(port, 'p', '6.6.6.6', mine[1]!.sid!)).status).toBe(200);
  });

  it('at the client cap a principal whose only idle session is elsewhere gets 503', async () => {
    const { port, lines } = await setup();
    const elsewhere = await init(port, 'p', '6.6.6.7');
    for (let p = 0; p < 2; p++)
      for (let i = 0; i < MAX_HTTP_SESSIONS_PER_CLIENT / 2; i++)
        await init(port, `o${p}`, '6.6.6.6');
    expect((await init(port, 'p', '6.6.6.6')).status).toBe(503);
    expect(lines).toEqual([]);
    expect((await call(port, 'p', '6.6.6.7', elsewhere.sid!)).status).toBe(200);
  });

  it('a refused initialize costs the requester no session', async () => {
    const { port, lines } = await setup();
    const mine = [];
    for (let i = 0; i < MAX_HTTP_SESSIONS_PER_PRINCIPAL; i++)
      mine.push(await init(port, 'a', '4.4.4.4'));
    for (let p = 0; p < 2; p++)
      for (let i = 0; i < MAX_HTTP_SESSIONS_PER_CLIENT / 2; i++)
        await init(port, `o${p}`, '4.4.4.5');
    expect((await init(port, 'a', '4.4.4.5')).status).toBe(503);
    expect(lines).toEqual([]);
    for (const r of mine) expect((await call(port, 'a', '4.4.4.4', r.sid!)).status).toBe(200);
  });

  it('evicts the least recently active session, not the oldest opened', async () => {
    const { port } = await setup();
    const s: Reply[] = [];
    for (let i = 0; i < MAX_HTTP_SESSIONS_PER_PRINCIPAL; i++)
      s.push(await init(port, 'a', '3.3.3.3'));
    expect((await call(port, 'a', '3.3.3.3', s[0]!.sid!)).status).toBe(200);
    expect((await init(port, 'a', '3.3.3.3')).status).toBe(200);
    expect((await call(port, 'a', '3.3.3.3', s[1]!.sid!)).status).toBe(404);
    expect((await call(port, 'a', '3.3.3.3', s[0]!.sid!)).status).toBe(200);
  });

  it('counts pending initializes toward the principal cap', async () => {
    let open!: () => void;
    const gated = new Promise<void>((r) => (open = r));
    let started = 0;
    const { port } = await setup({
      createSession: () => {
        const server = createSessionServer({
          version: '0.0.0',
          registry: h!.registry,
          selector: { world: 'w1', user: 'u1', exactId: true },
          tools: [fixtureTool],
          callTimeoutMs: 5000,
        });
        const connect = server.connect.bind(server);
        server.connect = async (t) => {
          started++;
          await gated;
          return connect(t);
        };
        return server;
      },
    });
    const first = Array.from({ length: MAX_HTTP_SESSIONS_PER_PRINCIPAL }, () =>
      init(port, 'a', '2.2.2.2'),
    );
    await until(() => started === MAX_HTTP_SESSIONS_PER_PRINCIPAL, 3000);
    expect((await init(port, 'a', '2.2.2.2')).status).toBe(503);
    open();
    for (const r of await Promise.all(first)) expect(r.status).toBe(200);
    expect(http!.sessionCount).toBe(MAX_HTTP_SESSIONS_PER_PRINCIPAL);
  });

  it('a POST whose body is still arriving pins its session against eviction', async () => {
    const { port, lines } = await setup();
    const s: Reply[] = [];
    for (let i = 0; i < MAX_HTTP_SESSIONS_PER_PRINCIPAL; i++)
      s.push(await init(port, 'a', '1.1.1.1'));
    gate.hold = true;
    const busy = s.slice(0, -1).map((r) => call(port, 'a', '1.1.1.1', r.sid!));
    await until(() => gate.held.length === s.length - 1, 3000);
    const slow = await new Promise<{ status: number; finish: () => void; done: Promise<number> }>(
      (resolve, reject) => {
        const req = request({
          host: '127.0.0.1',
          port,
          path: '/mcp',
          method: 'POST',
          headers: {
            host: hostHeader,
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
            'x-principal': 'a',
            'x-forwarded-for': '1.1.1.1',
            'mcp-session-id': s.at(-1)!.sid!,
          },
        });
        const done = new Promise<number>((res2, rej2) => {
          req.on('response', (r) => {
            r.resume();
            r.on('end', () => res2(r.statusCode ?? 0));
          });
          req.on('error', rej2);
        });
        req.write(callBody.slice(0, 5));
        setTimeout(
          () =>
            resolve({
              status: 0,
              finish: () => req.end(callBody.slice(5)),
              done,
            }),
          150,
        );
        req.on('error', reject);
      },
    );
    expect((await init(port, 'a', '1.1.1.1')).status).toBe(503);
    expect(lines).toEqual([]);
    release(mod!);
    slow.finish();
    expect(await slow.done).toBe(200);
    for (const p of await Promise.all(busy)) expect(p.status).toBe(200);
  });

  it('closes the session server and its hub handlers when connect throws', async () => {
    let base = -1;
    const { port } = await setup({
      createSession: () => {
        const server = createSessionServer({
          version: '0.0.0',
          registry: h!.registry,
          selector: { world: 'w1', user: 'u1', exactId: true },
          tools: [fixtureTool],
          callTimeoutMs: 5000,
        });
        server.connect = () => Promise.reject(new Error('boom'));
        return server;
      },
    });
    base = h!.registry.listenerCount('connected');
    const r = await init(port, 'a', '9.9.9.9');
    expect(r.status).toBe(500);
    expect(h!.registry.listenerCount('connected')).toBe(base);
  });

  it('closes an attached session server when handleRequest throws', async () => {
    const { port } = await setup({
      createSession: () => {
        const server = createSessionServer({
          version: '0.0.0',
          registry: h!.registry,
          selector: { world: 'w1', user: 'u1', exactId: true },
          tools: [fixtureTool],
          callTimeoutMs: 5000,
        });
        const connect = server.connect.bind(server);
        server.connect = async (t) => {
          await connect(t);
          (t as unknown as { handleRequest: () => Promise<void> }).handleRequest = () =>
            Promise.reject(new Error('boom'));
        };
        return server;
      },
    });
    const base = h!.registry.listenerCount('connected');
    const r = await init(port, 'a', '9.9.9.9');
    expect(r.status).toBe(500);
    expect(h!.registry.listenerCount('connected')).toBe(base);
    expect(http!.sessionCount).toBe(0);
  });
});
