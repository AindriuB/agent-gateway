import { PassThrough } from 'node:stream';
import WebSocket from 'ws';
import { MAX_FAILED_CODE_ATTEMPTS_PER_CLIENT } from '../../src/link/code-attempts.js';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp, type App } from '../../src/app.js';
import { createInvite } from '../../src/link/invites.js';
import { MAX_FAILED_AUTH_PER_CLIENT } from '../../src/http/limits.js';
import { loadOrCreateToken } from '../../src/http/index.js';
import { openStore } from '../../src/store/index.js';
import { ORIGIN, TestClient, hello } from './helpers.js';
import { freePort, tempState, until } from '../relay/harness.js';

const PUBLIC = 'https://gw.example.com';

type Config = Parameters<typeof createApp>[0];
const config = (over: object, linkPort: number, httpPort: number) =>
  ({ linkPort, httpPort, logLevel: 'error', ...over }) as unknown as Config;

describe('server mode, whole app', () => {
  const apps: App[] = [];
  const clients: TestClient[] = [];
  const cleanups: (() => void)[] = [];
  afterEach(async () => {
    clients.splice(0).forEach((c) => c.ws.terminate());
    for (const a of apps.splice(0)) await a.stop();
    for (const c of cleanups.splice(0)) c();
  });

  async function boot(over: object = {}) {
    const state = tempState();
    cleanups.push(state.cleanup);
    const linkPort = await freePort();
    let httpPort = await freePort();
    while (httpPort === linkPort) httpPort = await freePort();
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    let out = '';
    stdout.on('data', (d: Buffer) => (out += d.toString()));
    const lines: string[] = [];
    const app = createApp(
      config({ publicUrl: PUBLIC, serverMode: true, ...over }, linkPort, httpPort),
      {
        version: '0.0.0-test',
        dbPath: state.db,
        stdin,
        stdout,
        writeStatus: (l) => lines.push(l),
        revocationSweepMs: 100,
      },
    );
    apps.push(app);
    await app.start();
    const connect = async (): Promise<TestClient> => {
      const c = await TestClient.connect(linkPort, ORIGIN, { host: 'gw.example.com' });
      clients.push(c);
      return c;
    };
    const withDb = <T>(fn: (s: ReturnType<typeof openStore>) => T): T => {
      const s = openStore(state.db);
      try {
        return fn(s);
      } finally {
        s.close();
      }
    };
    return { linkPort, httpPort, lines, out: () => out, connect, withDb };
  }

  it('issues no shared code, accepts an invite, and never shows the invite anywhere', async () => {
    const t = await boot();
    const { code } = t.withDb((s) => createInvite(s, { worldId: 'w1', userId: 'u1' }, Date.now()));
    const a = await t.connect();
    a.send(hello({ kind: 'pairingCode', code }));
    const welcome = await a.next();
    expect(welcome).toMatchObject({ type: 'welcome' });
    // A refused token and a refused code, to exercise the refusal lines.
    const b = await t.connect();
    b.send(hello({ kind: 'pairingToken', token: 'bogus' }));
    expect(await b.next()).toMatchObject({ code: 'PAIRING_INVALID' });
    const c = await t.connect();
    c.send(hello({ kind: 'pairingCode', code: 'AAAA-AAAA-AAAA' }, { userId: 'u\x1b[31m\nx' }));
    expect(await c.next()).toMatchObject({ code: 'PAIRING_INVALID' });
    await until(() => t.lines.some((l) => l.includes('no valid invite')));
    const status = await (
      await fetch(`http://127.0.0.1:${t.httpPort}/status`, { headers: { host: 'gw.example.com' } })
    ).text();
    const everything = [...t.lines, t.out(), status, JSON.stringify(welcome)].join('\n');
    expect(everything).not.toMatch(/Pairing code/i);
    expect(everything).not.toContain('Enter pairing code');
    expect(t.lines.join('\n')).not.toContain(code);
    expect(t.out()).not.toContain(code);
    expect(status).not.toContain(code);
    expect(t.lines.join('\n')).not.toMatch(/[\x00-\x09\x0b-\x1f]/);
    for (const l of t.lines.filter((x) => x.startsWith('rejected link connection')))
      expect(l).not.toMatch(/code is in this log/);
  });

  it('a revocation made by another process closes the live connection within the sweep', async () => {
    const t = await boot();
    const { code } = t.withDb((s) => createInvite(s, { worldId: 'w1', userId: 'u1' }, Date.now()));
    const a = await t.connect();
    a.send(hello({ kind: 'pairingCode', code }));
    const welcome = (await a.next()) as { pairingToken: string };
    t.withDb((s) => s.revokePairingsFor('w1', 'u1'));
    expect(await a.next()).toMatchObject({ type: 'reject', code: 'PAIRING_INVALID' });
    await a.untilClosed();
    const again = await t.connect();
    again.send(hello({ kind: 'pairingToken', token: welcome.pairingToken }));
    expect(await again.next()).toMatchObject({ type: 'reject', code: 'PAIRING_INVALID' });
  });
});

describe('server mode with --trust-proxy and no public URL', () => {
  const apps: App[] = [];
  const clients: TestClient[] = [];
  const cleanups: (() => void)[] = [];
  afterEach(async () => {
    clients.splice(0).forEach((c) => c.ws.terminate());
    for (const a of apps.splice(0)) await a.stop();
    for (const c of cleanups.splice(0)) c();
  });

  it('keys invite failures by X-Forwarded-For: one client is limited, another still redeems', async () => {
    const state = tempState();
    cleanups.push(state.cleanup);
    const linkPort = await freePort();
    let httpPort = await freePort();
    while (httpPort === linkPort) httpPort = await freePort();
    const app = createApp(config({ serverMode: true, trustProxy: true }, linkPort, httpPort), {
      version: '0.0.0-test',
      dbPath: state.db,
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      writeStatus: () => undefined,
    });
    apps.push(app);
    await app.start();
    const store = openStore(state.db);
    const { code } = createInvite(store, { worldId: 'w1', userId: 'u1' }, Date.now());
    store.close();
    const attempt = async (ip: string, c: string) => {
      const ws = new WebSocket(`ws://127.0.0.1:${linkPort}`, {
        origin: ORIGIN,
        headers: { 'x-forwarded-for': ip },
      });
      await new Promise<void>((res, rej) => {
        ws.once('open', () => res());
        ws.once('error', rej);
      });
      const tc = new TestClient(ws);
      clients.push(tc);
      tc.send(hello({ kind: 'pairingCode', code: c }));
      return tc.next();
    };
    for (let i = 0; i < MAX_FAILED_CODE_ATTEMPTS_PER_CLIENT; i++)
      expect(await attempt('203.0.113.9', 'ZZZZ-ZZZZ-ZZZZ')).toMatchObject({
        code: 'PAIRING_INVALID',
      });
    expect(await attempt('203.0.113.9', 'ZZZZ-ZZZZ-ZZZZ')).toMatchObject({ code: 'RATE_LIMITED' });
    expect(await attempt('203.0.113.10', code)).toMatchObject({ type: 'welcome' });
  });
});

describe('server mode HTTP with --trust-proxy and no public URL', () => {
  const apps: App[] = [];
  const cleanups: (() => void)[] = [];
  afterEach(async () => {
    for (const a of apps.splice(0)) await a.stop();
    for (const c of cleanups.splice(0)) c();
  });

  it('gives each forwarded client its own failed-auth bucket, and says when --trust-proxy is off', async () => {
    for (const trustProxy of [true, false]) {
      const state = tempState();
      cleanups.push(state.cleanup);
      const store = openStore(state.db);
      const token = loadOrCreateToken(store);
      const bearer = token.created!;
      token.commit();
      store.close();
      const linkPort = await freePort();
      let httpPort = await freePort();
      while (httpPort === linkPort) httpPort = await freePort();
      const lines: string[] = [];
      const app = createApp(config({ serverMode: true, trustProxy }, linkPort, httpPort), {
        version: '0.0.0-test',
        dbPath: state.db,
        stdin: new PassThrough(),
        stdout: new PassThrough(),
        writeStatus: (l) => lines.push(l),
      });
      apps.push(app);
      await app.start();
      expect(lines.some((l) => l.includes('--trust-proxy is off'))).toBe(!trustProxy);
      if (!trustProxy) continue;
      const mcp = (ip: string, auth: string) =>
        fetch(`http://127.0.0.1:${httpPort}/mcp`, {
          method: 'POST',
          headers: {
            'x-forwarded-for': ip,
            authorization: `Bearer ${auth}`,
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
          },
          body: '{}',
        });
      for (let i = 0; i < MAX_FAILED_AUTH_PER_CLIENT; i++)
        expect((await mcp('203.0.113.9', 'wrong')).status).toBe(401);
      expect((await mcp('203.0.113.9', 'wrong')).status).toBe(429);
      const other = await mcp('203.0.113.10', bearer);
      expect([401, 429]).not.toContain(other.status);
    }
  });
});

describe('server mode refusal-log cap', () => {
  const apps: App[] = [];
  const clients: TestClient[] = [];
  const cleanups: (() => void)[] = [];
  afterEach(async () => {
    clients.splice(0).forEach((c) => c.ws.terminate());
    for (const a of apps.splice(0)) await a.stop();
    for (const c of cleanups.splice(0)) c();
  });

  async function bootCapped() {
    const state = tempState();
    cleanups.push(state.cleanup);
    const linkPort = await freePort();
    let httpPort = await freePort();
    while (httpPort === linkPort) httpPort = await freePort();
    const clock = { t: 1_000_000 };
    const timers: (() => void)[] = [];
    const lines: string[] = [];
    const app = createApp(
      config({ publicUrl: PUBLIC, serverMode: true, trustProxy: true }, linkPort, httpPort),
      {
        version: '0.0.0-test',
        dbPath: state.db,
        stdin: new PassThrough(),
        stdout: new PassThrough(),
        writeStatus: (l) => lines.push(l),
        codeClock: { now: () => clock.t, setTimer: (fn) => timers.push(fn) },
      },
    );
    apps.push(app);
    await app.start();
    let n = 0;
    // Each refusal comes from a distinct origin, so no per-origin dedupe could hide the cap.
    const refuse = async (count = 1) => {
      for (let i = 0; i < count; i++) {
        const c = await TestClient.connect(linkPort, `https://o${n++}.example`, {
          host: 'gw.example.com',
        });
        clients.push(c);
        c.send(hello({ kind: 'pairingToken', token: 'bogus' }));
        await c.next();
      }
    };
    const refusalLines = () => lines.filter((l) => l.startsWith('rejected link connection'));
    const summaries = () => lines.filter((l) => /more refusals suppressed/.test(l));
    return { clock, timers, lines, refuse, refusalLines, summaries };
  }

  it('writes 20 lines a minute from 25 distinct origins, then one summary line', async () => {
    const t = await bootCapped();
    await t.refuse(25);
    expect(t.refusalLines()).toHaveLength(20);
    expect(t.summaries()).toEqual([]);
    t.clock.t += 60_000;
    t.timers.splice(0).forEach((f) => f());
    expect(t.summaries()).toEqual(['5 more refusals suppressed']);
    await t.refuse();
    expect(t.refusalLines()).toHaveLength(21);
    t.clock.t += 60_000;
    t.timers.splice(0).forEach((f) => f());
    expect(t.summaries()).toHaveLength(1);
  });

  it('a refusal after the window ends flushes the pending summary first', async () => {
    const t = await bootCapped();
    await t.refuse(25);
    t.clock.t += 60_000;
    await t.refuse();
    const summary = t.lines.indexOf('5 more refusals suppressed');
    expect(summary).toBeGreaterThanOrEqual(0);
    expect(t.lines.slice(summary + 1).some((l) => l.startsWith('rejected link connection'))).toBe(
      true,
    );
  });

  it('a late timer after an inline flush writes no second summary', async () => {
    const t = await bootCapped();
    await t.refuse(25);
    const stale = t.timers.splice(0);
    expect(stale).toHaveLength(1);
    t.clock.t += 60_000;
    // The inline flush starts a new window, which then also overflows.
    await t.refuse(26);
    expect(t.summaries()).toEqual(['5 more refusals suppressed']);
    stale.forEach((f) => f());
    expect(t.summaries()).toEqual(['5 more refusals suppressed']);
    // The new window's own timer still reports its suppressed refusals.
    t.timers.splice(0).forEach((f) => f());
    expect(t.summaries()).toEqual(['5 more refusals suppressed', '6 more refusals suppressed']);
  });
});
