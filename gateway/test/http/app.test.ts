import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp, type App } from '../../src/app.js';
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
    expect(secondary.lines.filter((l) => l.includes('HTTP is served by the primary'))).toHaveLength(
      1,
    );
    // A second listener on the same port would fail; the secondary must not even try.
    expect(secondary.lines.some((l) => l.includes('/mcp'))).toBe(false);

    await primary.app.stop();
    await until(() => secondary.lines.some((l) => l.includes('/mcp')), 20_000, 'takeover');
    expect(await reachable(portA)).toBe(true);
    // The token was created once; the successor reuses the stored hash.
    expect(secondary.lines.filter((l) => l.startsWith('HTTP bearer token'))).toHaveLength(0);
  }, 40_000);
});
