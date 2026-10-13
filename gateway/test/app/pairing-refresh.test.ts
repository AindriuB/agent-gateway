import { createServer } from 'node:net';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp, type App } from '../../src/app.js';
import { PAIRING_CODE_TTL_MS } from '../../src/link/index.js';
import { ORIGIN, TestClient, hello } from '../link/helpers.js';
import { tempState, until } from '../relay/harness.js';

/** A free port in 17000-17999, so a test never goes near the real gateway's 7420. */
async function port17k(): Promise<number> {
  for (let p = 17000 + Math.floor(Math.random() * 900); p < 18000; p++) {
    const ok = await new Promise<boolean>((resolve) => {
      const s = createServer().once('error', () => resolve(false));
      s.listen(p, '127.0.0.1', () => s.close(() => resolve(true)));
    });
    if (ok) return p;
  }
  throw new Error('no free port');
}

const config = (linkPort: number) =>
  ({ linkPort, httpPort: 17999, logLevel: 'error' }) as unknown as Parameters<typeof createApp>[0];

/** Clock and timers the test drives by hand, so a "ten minute" wait takes no time. */
function manualClock() {
  let t = 1_000_000;
  const timers = new Map<number, { at: number; fn: () => void }>();
  let next = 1;
  return {
    now: () => t,
    setTimer: (fn: () => void, ms: number) => {
      const id = next++;
      timers.set(id, { at: t + ms, fn });
      return id;
    },
    clearTimer: (h: unknown) => void timers.delete(h as number),
    timers,
    advance(ms: number) {
      t += ms;
      for (const [id, v] of [...timers]) {
        if (v.at <= t) {
          timers.delete(id);
          v.fn();
        }
      }
    },
  };
}

const initialize = (stdin: PassThrough) => {
  stdin.write(
    `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '0' } } })}\n`,
  );
  stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
};

describe('pairing code lifecycle in the app', () => {
  const apps: App[] = [];
  const clients: TestClient[] = [];
  const cleanups: (() => void)[] = [];
  afterEach(async () => {
    clients.splice(0).forEach((c) => c.ws.terminate());
    for (const a of apps.splice(0)) await a.stop();
    for (const c of cleanups.splice(0)) c();
  });

  async function boot() {
    const state = tempState();
    cleanups.push(state.cleanup);
    const port = await port17k();
    const clock = manualClock();
    const mk = (withClock: boolean) => {
      const stdin = new PassThrough();
      const stdout = new PassThrough();
      let out = '';
      stdout.on('data', (d: Buffer) => (out += d.toString()));
      const lines: string[] = [];
      const app = createApp(config(port), {
        version: '0.0.0-test',
        dbPath: state.db,
        stdin,
        stdout,
        writeStatus: (l) => lines.push(l),
        ...(withClock ? { codeClock: clock } : {}),
      });
      apps.push(app);
      const pairingNotices = () =>
        out
          .split('\n')
          .filter((l) => l.includes('"logger":"pairing"'))
          .map((l) => (JSON.parse(l) as { params: { data: string } }).params.data);
      return { app, stdin, lines, pairingNotices };
    };
    const primary = mk(true);
    await primary.app.start();
    const secondary = mk(false);
    await secondary.app.start();
    const codeLines = () => primary.lines.filter((l) => l.startsWith('Pairing code: '));
    const codeOf = (line: string) => /Pairing code: (\S+)/.exec(line)![1]!;
    const connect = async (auth: Parameters<typeof hello>[0]) => {
      const c = await TestClient.connect(port, ORIGIN);
      clients.push(c);
      c.send(hello(auth));
      return c;
    };
    return { port, clock, primary, secondary, codeLines, codeOf, connect };
  }

  it('prints a new code and link line on expiry, sends it to the stdio and the relayed session, and retires the old one', async () => {
    const t = await boot();
    initialize(t.primary.stdin);
    initialize(t.secondary.stdin);
    await until(() => t.primary.pairingNotices().length === 1);
    await until(() => t.secondary.pairingNotices().length === 1);
    expect(t.clock.timers.size).toBe(1);
    const [first] = t.codeLines();
    expect(first).toMatch(/^Pairing code: [A-Z2-9]{4}-[A-Z2-9]{4} \(expires in 10 min\)$/);
    const old = t.codeOf(first!);

    t.clock.advance(PAIRING_CODE_TTL_MS);
    expect(t.codeLines()).toHaveLength(2);
    const fresh = t.codeOf(t.codeLines()[1]!);
    expect(fresh).not.toBe(old);
    const at = t.primary.lines.indexOf(t.codeLines()[1]!);
    expect(t.primary.lines[at + 1]).toMatch(
      new RegExp(
        `^Link URL: ws://localhost:${t.port} \\(pid ${process.pid} holds link port ${t.port}\\)$`,
      ),
    );
    expect(t.clock.timers.size).toBe(1);
    await until(() => t.primary.pairingNotices().length === 2);
    await until(() => t.secondary.pairingNotices().length === 2);
    for (const notices of [t.primary.pairingNotices(), t.secondary.pairingNotices()])
      expect(notices.at(-1)).toContain(fresh);

    const stale = await t.connect({ kind: 'pairingCode', code: old });
    await stale.untilClosed();
    expect(stale.messages.some((m) => m.type === 'welcome')).toBe(false);
    const good = await t.connect({ kind: 'pairingCode', code: fresh });
    expect((await good.next()).type).toBe('welcome');
  }, 30_000);

  it('an uninitialized session gets no notice, and the current code once it initializes', async () => {
    const t = await boot();
    t.clock.advance(PAIRING_CODE_TTL_MS);
    await new Promise((r) => setTimeout(r, 100));
    expect(t.secondary.pairingNotices()).toEqual([]);
    initialize(t.secondary.stdin);
    await until(() => t.secondary.pairingNotices().length === 1);
    expect(t.secondary.pairingNotices()[0]).toContain(t.codeOf(t.codeLines().at(-1)!));
  }, 30_000);

  it('does not refresh after a successful pairing', async () => {
    const t = await boot();
    const c = await t.connect({ kind: 'pairingCode', code: t.codeOf(t.codeLines()[0]!) });
    expect((await c.next()).type).toBe('welcome');
    expect(t.clock.timers.size).toBe(0);
    t.clock.advance(3 * PAIRING_CODE_TTL_MS);
    expect(t.codeLines()).toHaveLength(1);
    expect(t.clock.timers.size).toBe(0);
  }, 30_000);

  it('a refused token issues one code, a wrong code issues none', async () => {
    const t = await boot();
    const paired = await t.connect({ kind: 'pairingCode', code: t.codeOf(t.codeLines()[0]!) });
    expect((await paired.next()).type).toBe('welcome');
    expect(t.codeLines()).toHaveLength(1);

    const wrong = await t.connect({ kind: 'pairingCode', code: 'AAAA-AAAA' });
    await wrong.untilClosed();
    expect(t.codeLines()).toHaveLength(1);
    expect(t.clock.timers.size).toBe(0);

    const refused = await t.connect({ kind: 'pairingToken', token: 'revoked-token' });
    await refused.untilClosed();
    expect(t.codeLines()).toHaveLength(2);
    const refusal = t.primary.lines.find((l) => l.includes('pairing token is unknown'))!;
    const code = t.codeOf(t.codeLines()[1]!);
    expect(refusal).toContain(
      `Enter pairing code ${code} (expires in 10 min) in the Agent Gateway pairing prompt`,
    );
    expect(t.clock.timers.size).toBe(1);

    const again = await t.connect({ kind: 'pairingToken', token: 'another-bad-token' });
    await again.untilClosed();
    expect(t.codeLines()).toHaveLength(2);
    expect(t.clock.timers.size).toBe(1);
  }, 30_000);
});
