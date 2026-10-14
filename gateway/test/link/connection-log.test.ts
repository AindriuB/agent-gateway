import { afterEach, describe, expect, it } from 'vitest';
import { createInvite } from '../../src/link/invites.js';
import type { LinkEvent } from '../../src/link/index.js';
import { hashToken } from '../../src/link/index.js';
import { PassThrough } from 'node:stream';
import { createApp, type App } from '../../src/app.js';
import { freePort, tempState } from '../relay/harness.js';
import { until } from '../routing/harness.js';
import { ORIGIN, TestClient, hello, startServer, type Harness } from './helpers.js';
import { HEARTBEAT_INTERVAL_MS } from '../../src/link/index.js';
import { vi } from 'vitest';

let h: Harness | undefined;
const clients: TestClient[] = [];
afterEach(async () => {
  vi.useRealTimers();
  clients.splice(0).forEach((c) => c.ws.terminate());
  await h?.server.close();
  h?.store.close();
  h = undefined;
});

const clock = { t: 1_000 };
async function boot(): Promise<LinkEvent[]> {
  const events: LinkEvent[] = [];
  clock.t = 1_000;
  h = await startServer({
    serverMode: true,
    now: () => clock.t,
    onLinkEvent: (e) => events.push(e),
  });
  return events;
}
async function pair(userId = 'u1', name = 'U') {
  const { code } = createInvite(h!.store, { worldId: 'w1', userId }, clock.t);
  const tc = await TestClient.connect(h!.port, ORIGIN);
  clients.push(tc);
  const frame = hello({ kind: 'pairingCode', code }, { userId });
  frame.user.name = name;
  tc.send(frame);
  const w = await tc.next('welcome');
  if (w.type !== 'welcome' || !w.pairingToken) throw new Error('not paired');
  return { tc, code, token: w.pairingToken, connectionId: w.connectionId };
}

describe('onLinkEvent', () => {
  it('reports connect after welcome and disconnect with code, reason and duration', async () => {
    const events = await boot();
    const { tc, connectionId } = await pair();
    expect(events).toEqual([{ kind: 'connected', worldId: 'w1', userName: 'U', connectionId }]);
    clock.t += 42_000;
    tc.ws.close(1000, 'bye');
    await until(() => events.length === 2);
    expect(events[1]).toEqual({
      kind: 'disconnected',
      worldId: 'w1',
      userName: 'U',
      connectionId,
      code: 1000,
      reason: 'bye',
      durationMs: 42_000,
    });
  });

  it('does not report rejected handshakes', async () => {
    const events = await boot();
    const tc = await TestClient.connect(h!.port, ORIGIN);
    clients.push(tc);
    tc.send(hello({ kind: 'pairingToken', token: 'nope' }));
    await tc.next('reject');
    await tc.untilClosed();
    expect(events).toEqual([]);
  });

  it('logs 1000 replaced when the same user reconnects', async () => {
    const events = await boot();
    const first = await pair();
    const second = await pair();
    await until(() => events.some((e) => e.kind === 'disconnected'));
    const d = events.find((e) => e.kind === 'disconnected')!;
    expect(d).toMatchObject({ connectionId: first.connectionId, code: 1000, reason: 'replaced' });
    expect(second.connectionId).not.toBe(first.connectionId);
  });

  it('logs 1008 PAIRING_INVALID when the pairing is revoked', async () => {
    const events = await boot();
    const { connectionId } = await pair();
    h!.server.dropConnection(h!.registry.get('w1', 'u1')!);
    await until(() => events.length === 2);
    expect(events[1]).toMatchObject({ connectionId, code: 1008, reason: 'PAIRING_INVALID' });
  });

  it('logs 1006 when a heartbeat terminates the socket', async () => {
    const events = await boot();
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const { tc } = await pair();
    // Stay silent: no pongs.
    for (let i = 0; i < 4; i++) vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
    await tc.untilClosed();
    vi.useRealTimers();
    await until(() => events.length === 2);
    expect(events[1]).toMatchObject({ kind: 'disconnected', code: 1006 });
  });
});

describe('the gateway log lines', () => {
  const apps: App[] = [];
  const cleanups: (() => void)[] = [];
  const ws: TestClient[] = [];
  afterEach(async () => {
    ws.splice(0).forEach((c) => c.ws.terminate());
    for (const a of apps.splice(0)) await a.stop();
    for (const c of cleanups.splice(0)) c();
  });

  async function bootApp() {
    const state = tempState();
    cleanups.push(state.cleanup);
    const linkPort = await freePort();
    let httpPort = await freePort();
    while (httpPort === linkPort) httpPort = await freePort();
    const lines: string[] = [];
    const app = createApp(
      {
        linkPort,
        httpPort,
        logLevel: 'error',
        serverMode: true,
        publicUrl: 'https://gw.example.com',
      } as never,
      {
        version: '0.0.0-test',
        dbPath: state.db,
        stdin: new PassThrough(),
        stdout: new PassThrough(),
        writeStatus: (l) => lines.push(l),
        revocationSweepMs: 100,
      },
    );
    apps.push(app);
    await app.start();
    return { linkPort, lines, dbPath: state.db };
  }

  it('writes one line per event, sanitised, with no code, token or hash', async () => {
    const t = await bootApp();
    const { openStore } = await import('../../src/store/index.js');
    const s = openStore(t.dbPath);
    const { code } = createInvite(s, { worldId: 'w1', userId: 'u1' }, Date.now());
    s.close();
    const tc = await TestClient.connect(t.linkPort, ORIGIN, { host: 'gw.example.com' });
    ws.push(tc);
    const frame = hello({ kind: 'pairingCode', code });
    frame.user.name = 'Ann\x1b[31m\nforged line';
    tc.send(frame);
    const w = await tc.next('welcome');
    if (w.type !== 'welcome' || !w.pairingToken) throw new Error('not paired');
    await until(() => t.lines.some((l) => l.startsWith('link connected: ')));
    tc.ws.close(1000, `bad\n\x1b[2Jreason${'x'.repeat(100)}`);
    await until(() => t.lines.some((l) => l.startsWith('link disconnected: ')));
    const connected = t.lines.find((l) => l.startsWith('link connected: '))!;
    const gone = t.lines.find((l) => l.startsWith('link disconnected: '))!;
    expect(connected).toMatch(/^link connected: world w1 \/ user Ann/);
    expect(gone).toMatch(/^link disconnected: world w1 \/ user Ann.* after \d+s \(code 1000, bad/);
    for (const l of [connected, gone]) {
      expect(l).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
      expect(l).not.toContain('\x1b');
    }
    // The reason is cut at 64 characters.
    expect(gone.match(/code 1000, (.*)\)$/)![1]!.length).toBeLessThanOrEqual(64);
    const all = t.lines.join('\n');
    for (const secret of [code, w.pairingToken, hashToken(w.pairingToken)])
      expect(all).not.toContain(secret);
  });
});
