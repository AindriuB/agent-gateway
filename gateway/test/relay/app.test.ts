import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, type App } from '../../src/app.js';
import { openStore } from '../../src/store/index.js';
import { freePort, tempState, until } from './harness.js';

const config = (linkPort: number) =>
  ({ linkPort, logLevel: 'error' }) as unknown as Parameters<typeof createApp>[0];

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
});
