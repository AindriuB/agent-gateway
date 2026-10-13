import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, type App } from '../../src/app.js';
import { openStore } from '../../src/store/index.js';
import { freePort, sleep, tempState, until } from './harness.js';

const config = (linkPort: number) =>
  ({ linkPort, httpPort: 7421, logLevel: 'error' }) as unknown as Parameters<typeof createApp>[0];

describe('relay mode in the app', () => {
  const apps: App[] = [];
  const cleanups: (() => void)[] = [];
  afterEach(async () => {
    for (const a of apps.splice(0)) await a.stop();
    for (const c of cleanups.splice(0)) c();
  });

  it('never opens the db in a secondary, and serves the full tool set through the relay', async () => {
    const state = tempState();
    cleanups.push(state.cleanup);
    const port = await freePort();
    const primaryOpen = vi.fn(openStore);
    const secondaryOpen = vi.fn(openStore);
    const mk = (open: typeof openStore) => {
      const stdin = new PassThrough();
      const stdout = new PassThrough();
      let out = '';
      stdout.on('data', (d: Buffer) => (out += d.toString()));
      const app = createApp(config(port), {
        version: '0.0.0-test',
        dbPath: state.db,
        stdin,
        stdout,
        openStore: open,
        writeStatus: () => undefined,
      });
      apps.push(app);
      return { app, stdin, out: () => out };
    };
    const primary = mk(primaryOpen);
    await primary.app.start();
    const secondary = mk(secondaryOpen);
    await secondary.app.start();
    secondary.stdin.write(
      `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '0' } } })}\n`,
    );
    secondary.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })}\n`);
    await until(() => secondary.out().includes('"id":2'), 10_000, 'tools/list reply');
    expect(secondary.out()).toContain('world_info');
    expect(primaryOpen).toHaveBeenCalledTimes(1);
    expect(secondaryOpen).not.toHaveBeenCalled();
  }, 30_000);

  it('describes the current reason after a start-up conflict, a takeover and a step-down', async () => {
    const state = tempState();
    cleanups.push(state.cleanup);
    const port = await freePort();
    const infos: string[] = [];
    const logger = {
      debug: () => undefined,
      info: (m: string) => void infos.push(m),
      warn: (m: string) => void infos.push(m),
      error: (m: string) => void infos.push(m),
    };
    const mk = (httpPort: number, over: object = {}) => {
      const app = createApp(
        { linkPort: port, httpPort, logLevel: 'error' } as unknown as Parameters<
          typeof createApp
        >[0],
        {
          version: '0.0.0-test',
          dbPath: state.db,
          stdin: new PassThrough(),
          stdout: new PassThrough(),
          writeStatus: () => undefined,
          ...over,
        },
      );
      apps.push(app);
      return app;
    };
    // X's first attempt at the store fails as if another gateway held the db; it then relays to P.
    let failed = false;
    const x = mk(17555, {
      logger,
      openStore: (path: string) => {
        if (!failed) {
          failed = true;
          throw Object.assign(new Error('database is locked'), { errcode: 5 });
        }
        return openStore(path);
      },
    });
    const starting = x.start();
    await until(() => failed, 10_000, 'X store conflict');
    await sleep(500); // X released the link port and is now looking for a relay
    const p = mk(17555);
    await p.start();
    await starting;
    expect(infos.join('\n')).toContain('holds the pairing database');
    // P goes away; X takes over. A newer instance with other settings then makes X step down.
    await p.stop();
    await sleep(3000);
    infos.length = 0;
    const n = mk(7500);
    await n.start();
    await until(() => infos.some((l) => l.includes('relays to it')), 30_000, 'X relays to N');
    expect(infos.join('\n')).toContain('holds link port');
    expect(infos.join('\n')).not.toContain('pairing database');
  }, 60_000);
});
