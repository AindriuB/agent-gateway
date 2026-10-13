import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp, type App } from '../../src/app.js';
import { createServer } from 'node:net';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openStore } from '../../src/store/index.js';
import { freePort, tempState, until } from '../relay/harness.js';

const config = (linkPort: number, httpPort: number) =>
  ({ linkPort, httpPort, logLevel: 'error' }) as unknown as Parameters<typeof createApp>[0];

const reachable = async (port: number): Promise<boolean> =>
  fetch(`http://127.0.0.1:${port}/status`).then(
    (r) => r.status === 200,
    () => false,
  );

describe('--http in the app', () => {
  const apps: App[] = [];
  const cleanups: (() => void)[] = [];
  afterEach(async () => {
    for (const a of apps.splice(0)) await a.stop();
    for (const c of cleanups.splice(0)) c();
  });

  function mk(linkPort: number, httpPort: number, dbPath: string, http: boolean) {
    const lines: string[] = [];
    const app = createApp(config(linkPort, httpPort), {
      version: '0.0.0-test',
      dbPath,
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      writeStatus: (l) => lines.push(l),
      ...(http ? { http: true } : {}),
    });
    apps.push(app);
    return { app, lines };
  }

  it('only the primary serves HTTP; a secondary says so, and takes over when the primary stops', async () => {
    const state = tempState();
    cleanups.push(state.cleanup);
    const link = await freePort();
    let portA = await freePort();
    while (portA === link) portA = await freePort();
    const primary = mk(link, portA, state.db, true);
    await primary.app.start();
    expect(await reachable(portA)).toBe(true);
    expect(primary.lines.filter((l) => l.startsWith('HTTP bearer token'))).toHaveLength(1);

    const secondary = mk(link, portA, state.db, true);
    await secondary.app.start();
    expect(
      secondary.lines.filter((l) => l.includes('HTTP is served only by the primary')),
    ).toHaveLength(1);
    // A second listener on the same port would fail; the secondary must not even try.
    expect(secondary.lines.some((l) => l.includes('/mcp'))).toBe(false);

    await primary.app.stop();
    await until(() => secondary.lines.some((l) => l.includes('/mcp')), 20_000, 'takeover');
    expect(await reachable(portA)).toBe(true);
    // The token was created once; the successor reuses the stored hash.
    expect(secondary.lines.filter((l) => l.startsWith('HTTP bearer token'))).toHaveLength(0);
  }, 40_000);

  it('leaves no token behind when the HTTP port is taken, and prints one on the next run', async () => {
    const state = tempState();
    cleanups.push(state.cleanup);
    const link = await freePort();
    let port = await freePort();
    while (port === link) port = await freePort();
    const blocker = createServer().listen(port, '127.0.0.1');
    await new Promise((r) => blocker.once('listening', r));
    const failing = mk(link, port, state.db, true);
    await expect(failing.app.start()).rejects.toThrow(/EADDRINUSE/);
    expect(failing.lines.some((l) => l.startsWith('HTTP bearer token'))).toBe(false);
    const check = openStore(state.db);
    expect(check.getHttpTokenHash()).toBeUndefined();
    check.close();
    await new Promise((r) => blocker.close(r));
    const retry = mk(link, port, state.db, true);
    await retry.app.start();
    const line = retry.lines.find((l) => l.startsWith('HTTP bearer token')) ?? '';
    const tok = line.split(': ')[1] ?? '';
    expect(tok).toMatch(/^[0-9a-f]{64}$/);
    expect(await status(port, tok)).toBe(200);
  }, 20_000);

  it('--http-rotate-token takes effect in a running primary', async () => {
    const state = tempState();
    cleanups.push(state.cleanup);
    const link = await freePort();
    let port = await freePort();
    while (port === link) port = await freePort();
    const primary = mk(link, port, state.db, true);
    await primary.app.start();
    const oldTok = (primary.lines.find((l) => l.startsWith('HTTP bearer token')) ?? '').split(
      ': ',
    )[1]!;
    expect(await status(port, oldTok)).toBe(200);
    const r = spawnSync(process.execPath, [cli, '--http-rotate-token', '--db', state.db], {
      encoding: 'utf8',
      timeout: 15_000,
    });
    expect(r.status).toBe(0);
    const newTok = /: ([0-9a-f]{64})/.exec(r.stderr)?.[1];
    expect(newTok).toBeTruthy();
    expect(newTok).not.toBe(oldTok);
    expect(await status(port, oldTok)).toBe(401);
    expect(await status(port, newTok!)).toBe(200);
    const check = openStore(state.db);
    expect(check.getHttpTokenHash()).toBe(createHash('sha256').update(newTok!).digest('hex'));
    check.close();
  }, 30_000);

  it('--http-rotate-token refuses :memory: with a non-zero exit', () => {
    const r = spawnSync(process.execPath, [cli, '--http-rotate-token', '--db', ':memory:'], {
      encoding: 'utf8',
      timeout: 10_000,
    });
    expect(r.status).toBe(2);
  });
});

const cli = fileURLToPath(new URL('../../dist/bin/cli.js', import.meta.url));

/** Status of an authenticated MCP request: 401 for a bad token, anything else means it passed. */
async function status(port: number, tok: string): Promise<number> {
  const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${tok}`,
    },
    body: '{',
  });
  return res.status === 401 ? 401 : 200;
}
