import { createConnection } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import {
  FakeModule,
  freePort,
  pairedPrimary,
  sleep,
  startCli,
  tempState,
  until,
  type Cli,
} from './harness.js';

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const reachable = (port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const s = createConnection({ port, host: '127.0.0.1' });
    s.once('connect', () => (s.destroy(), resolve(true)));
    s.once('error', () => resolve(false));
  });
const worldInfo = async (c: Cli): Promise<string> => {
  const r = await c.client.callTool({ name: 'world_info', arguments: {} });
  if (r.isError) throw new Error(JSON.stringify(r.content));
  return JSON.stringify(r.content);
};
/** Retry until a call succeeds: right after a handover the first calls may get RELAY_*. */
async function worldInfoEventually(c: Cli, ms = 30_000): Promise<string> {
  const end = Date.now() + ms;
  for (;;) {
    try {
      return await worldInfo(c);
    } catch (err) {
      if (Date.now() > end) throw err;
      await sleep(250);
    }
  }
}
const count = (text: string, needle: string): number => text.split(needle).length - 1;

describe('a stepped-down gateway stays alive', () => {
  const clis: Cli[] = [];
  const modules: FakeModule[] = [];
  const cleanups: (() => void)[] = [];
  afterEach(async () => {
    for (const m of modules.splice(0)) m.close();
    for (const c of clis.splice(0)) {
      await c.close();
      try {
        process.kill(c.pid, 'SIGKILL');
      } catch {
        // already gone
      }
    }
    for (const f of cleanups.splice(0)) f();
  });

  it('A relays to a newer --http B, then takes the link port back when B is killed', async () => {
    const state = tempState();
    cleanups.push(state.cleanup);
    const port = await freePort();
    const httpPort = await freePort();
    const { cli: a, module } = await pairedPrimary(port, state.db);
    clis.push(a);
    module.keepAlive();
    modules.push(module);
    expect(await worldInfo(a)).toContain('echo:');

    const b = await startCli(port, state.db, ['--http', '--http-port', String(httpPort)]);
    clis.push(b);
    await until(() => b.stderr().includes('MCP HTTP at'), 30_000, 'B serving HTTP');
    expect(a.stderr()).toContain('stepping down');

    // A is still there 10 s later and its stdio client, never reconnected, works through B.
    await sleep(10_000);
    expect(alive(a.pid)).toBe(true);
    expect(await worldInfoEventually(a, 20_000)).toContain('echo:');
    expect(b.stderr()).toMatch(/relay session \d+ opened/);

    process.kill(b.pid, 'SIGKILL');
    await until(() => count(a.stderr(), 'holds link port') >= 2, 30_000, 'A takes back over');
    await until(() => module.ready, 30_000, 'module reconnect');
    expect(await worldInfoEventually(a)).toContain('echo:');
    // A was not started with --http, so it does not serve HTTP after taking over.
    expect(await reachable(httpPort)).toBe(false);
  }, 120_000);
});
