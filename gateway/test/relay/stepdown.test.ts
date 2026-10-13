import { createConnection } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { ORIGIN } from '../conformance/fake-module.js';
import { STATUS_TOOL } from '../../src/mcp/status-tool.js';
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

  it('A differing only in allowed origins becomes a standby, then takes over when B is killed', async () => {
    const state = tempState();
    cleanups.push(state.cleanup);
    const port = await freePort();
    const { cli: a, module } = await pairedPrimary(port, state.db);
    clis.push(a);
    module.keepAlive();
    modules.push(module);

    const b = await startCli(port, state.db, [`--allow-origin=${ORIGIN}`]);
    clis.push(b);
    await until(() => count(b.stderr(), 'holds link port') >= 1, 30_000, 'B primary');
    await until(() => a.stderr().includes('is a standby and cannot pair'), 30_000, 'A standby');
    expect(alive(a.pid)).toBe(true);
    expect(a.stderr()).not.toContain('[error]');

    // The standby keeps its session: gateway_status says why, every other tool says so too.
    const status = await a.client.callTool({ name: STATUS_TOOL, arguments: {} });
    expect(status.isError).toBeFalsy();
    expect(JSON.stringify(status.content)).toContain('different settings');
    const refused = await a.client.callTool({ name: 'world_info', arguments: {} });
    expect(refused.isError).toBe(true);
    expect(JSON.stringify(refused.content)).toContain('another gateway is primary');

    process.kill(b.pid, 'SIGKILL');
    await until(() => count(a.stderr(), 'holds link port') >= 2, 30_000, 'A takes back over');
    await until(() => module.ready, 30_000, 'module reconnect');
    expect(await worldInfoEventually(a)).toContain('echo:');
  }, 120_000);

  it('A (oldest), B and C with different settings settle on C without a step-down cycle', async () => {
    const state = tempState();
    cleanups.push(state.cleanup);
    const port = await freePort();
    const httpPort = await freePort();
    const { cli: a, module } = await pairedPrimary(port, state.db);
    clis.push(a);
    module.keepAlive();
    modules.push(module);
    const holds = (c: Cli) => count(c.stderr(), 'holds link port');

    const b = await startCli(port, state.db, [`--allow-origin=${ORIGIN}`]);
    clis.push(b);
    await until(() => holds(b) >= 1, 30_000, 'B primary');
    await until(() => a.stderr().includes('is a standby and cannot pair'), 30_000, 'A standby');

    const c = await startCli(port, state.db, [
      `--allow-origin=${ORIGIN}`,
      '--allow-origin=https://c.invalid',
      '--http',
      '--http-port',
      String(httpPort),
    ]);
    clis.push(c);
    await until(() => c.stderr().includes('MCP HTTP at'), 40_000, 'C primary');
    await sleep(5_000); // let any bounce play out

    const steps = (x: Cli) => count(x.stderr(), 'stepping down:');
    // One step-down per instance per newer peer at most: A has two, B one and C none.
    expect(steps(a)).toBeLessThanOrEqual(2);
    expect(steps(b)).toBeLessThanOrEqual(1);
    expect(steps(c)).toBe(0);
    for (const x of [a, b, c]) expect(alive(x.pid)).toBe(true);
    expect(holds(c)).toBe(1);
    const status = await a.client.callTool({ name: STATUS_TOOL, arguments: {} });
    expect(JSON.stringify(status.content)).toContain('different settings');

    // Killing C leaves exactly one new primary among the survivors, and both stay alive.
    const [ha, hb] = [holds(a), holds(b)];
    process.kill(c.pid, 'SIGKILL');
    await until(() => holds(a) + holds(b) > ha + hb, 40_000, 'a survivor takes over');
    await sleep(4_000);
    expect(holds(a) + holds(b)).toBe(ha + hb + 1);
    const primary = holds(a) > ha ? a : b;
    await until(() => module.ready, 30_000, 'module reconnect');
    for (const x of [a, b]) expect(alive(x.pid)).toBe(true);
    // B's origins are the module's, A's are open: either way the new primary serves the module.
    expect(await worldInfoEventually(primary)).toContain('echo:');
  }, 180_000);
});
