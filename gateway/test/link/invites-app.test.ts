import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp, type App } from '../../src/app.js';
import { createInvite } from '../../src/link/invites.js';
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
