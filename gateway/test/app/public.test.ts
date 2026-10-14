import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp, type App } from '../../src/app.js';
import { loadOrCreateToken } from '../../src/http/index.js';
import { openStore } from '../../src/store/index.js';
import { ORIGIN, TestClient, hello } from '../link/helpers.js';
import { freePort, tempState, until } from '../relay/harness.js';

const PUBLIC = 'https://gw.example.com';

type Config = Parameters<typeof createApp>[0];
const config = (over: object, linkPort: number, httpPort: number) =>
  ({ linkPort, httpPort, logLevel: 'error', ...over }) as unknown as Config;

const send = (stdin: PassThrough, msg: object) => stdin.write(`${JSON.stringify(msg)}\n`);
const initialize = (stdin: PassThrough) => {
  send(stdin, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 't', version: '0' },
    },
  });
  send(stdin, { jsonrpc: '2.0', method: 'notifications/initialized' });
};

describe('a public gateway', () => {
  const apps: App[] = [];
  const clients: TestClient[] = [];
  const cleanups: (() => void)[] = [];
  afterEach(async () => {
    clients.splice(0).forEach((c) => c.ws.terminate());
    for (const a of apps.splice(0)) await a.stop();
    for (const c of cleanups.splice(0)) c();
  });

  async function boot(over: object = {}, prepare?: (db: string) => void) {
    const state = tempState();
    cleanups.push(state.cleanup);
    prepare?.(state.db);
    const linkPort = await freePort();
    let httpPort = await freePort();
    while (httpPort === linkPort) httpPort = await freePort();
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    let out = '';
    stdout.on('data', (d: Buffer) => (out += d.toString()));
    const lines: string[] = [];
    const app = createApp(config({ publicUrl: PUBLIC, ...over }, linkPort, httpPort), {
      version: '0.0.0-test',
      dbPath: state.db,
      stdin,
      stdout,
      writeStatus: (l) => lines.push(l),
    });
    apps.push(app);
    await app.start();
    const codeLines = () => lines.filter((l) => l.startsWith('Pairing code: '));
    const codeOf = (line: string) => /Pairing code: (\S+)/.exec(line)![1]!;
    const pair = async (code: string, userId = 'u1') => {
      const c = await TestClient.connect(linkPort, ORIGIN, { host: 'gw.example.com' });
      clients.push(c);
      c.send(hello({ kind: 'pairingCode', code }, { userId }));
      return c;
    };
    const pairingNotices = () => out.split('\n').filter((l) => l.includes('"logger":"pairing"'));
    return {
      linkPort,
      httpPort,
      stdin,
      lines,
      out: () => out,
      codeLines,
      codeOf,
      pair,
      pairingNotices,
    };
  }

  it('keeps the code out of MCP and the status page, and refreshes it for the operator', async () => {
    const t = await boot();
    initialize(t.stdin);
    await until(() => t.out().includes('"id":1'));
    send(t.stdin, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'gateway_status', arguments: {} },
    });
    await until(() => t.out().includes('"id":2'));
    const reply = t
      .out()
      .split('\n')
      .find((l) => l.includes('"id":2'))!;
    expect(reply).not.toContain('pairingCode');
    expect(reply).not.toContain('codeExpiresInMin');
    expect(reply).toMatch(/operator/);
    const first = t.codeOf(t.codeLines()[0]!);
    expect(reply).not.toContain(first);

    const a = await t.pair(first, 'user-secret-id');
    expect((await a.next('welcome')).type).toBe('welcome');
    // The spent code is replaced for the operator at once.
    await until(() => t.codeLines().length === 2, 1000, 'a new code line');
    const second = t.codeOf(t.codeLines()[1]!);
    expect(second).not.toBe(first);
    const b = await t.pair(second, 'user-two');
    expect((await b.next('welcome')).type).toBe('welcome');
    await new Promise((r) => setTimeout(r, 100));
    expect(t.pairingNotices()).toEqual([]);

    const status = await fetch(`http://127.0.0.1:${t.httpPort}/status`, {
      headers: { host: 'gw.example.com' },
    });
    const body = await status.text();
    expect(status.status).toBe(200);
    expect(body).toContain('0.0.0-test');
    expect(body).not.toContain('user-secret-id');
    expect(body).not.toContain('w1');
  });

  it('turns the static bearer off', async () => {
    let tokenText = '';
    const t = await boot({}, (db) => {
      const store = openStore(db);
      const token = loadOrCreateToken(store);
      tokenText = token.created!;
      token.commit();
      store.close();
    });
    const r = await fetch(`http://127.0.0.1:${t.httpPort}/mcp`, {
      method: 'POST',
      headers: {
        host: 'gw.example.com',
        authorization: `Bearer ${tokenText}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: '{}',
    });
    expect(r.status).toBe(401);
    expect(
      t.lines.some((l) => l.includes('HTTP bearer token is off because --public-url is set')),
    ).toBe(true);
    expect(t.lines.some((l) => l.includes('HTTP bearer token (shown once'))).toBe(false);
  });

  it('warns once about the shared rate-limit bucket unless --trust-proxy is set', async () => {
    const warn = (l: string) => l.includes('--trust-proxy is off');
    const off = await boot();
    expect(off.lines.filter(warn)).toHaveLength(1);
    const on = await boot({ trustProxy: true });
    expect(on.lines.filter(warn)).toHaveLength(0);
  });

  it('says TLS is for a reverse proxy when it binds beyond loopback, and passes the hosts', async () => {
    const t = await boot({ httpHost: '0.0.0.0', linkHost: '0.0.0.0' });
    expect(
      t.lines.filter((l) => l.includes('TLS must be terminated by a reverse proxy')),
    ).toHaveLength(1);
    const c = await t.pair(t.codeOf(t.codeLines()[0]!));
    expect((await c.next('welcome')).type).toBe('welcome');
  });

  it('serves the status page in server mode with no stdio session', async () => {
    const t = await boot({ serverMode: true });
    const r = await fetch(`http://127.0.0.1:${t.httpPort}/status`, {
      headers: { host: 'gw.example.com' },
    });
    expect(r.status).toBe(200);
    initialize(t.stdin);
    await new Promise((res) => setTimeout(res, 200));
    expect(t.out()).toBe('');
  });
});
