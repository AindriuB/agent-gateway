import { afterEach, describe, expect, it } from 'vitest';
import {
  freePort,
  pairingCode,
  RealModule,
  sleep,
  startCli,
  statusCount,
  tempState,
  until,
  type Cli,
} from './harness.js';

const count = (text: string, needle: string): number => text.split(needle).length - 1;

/** Within 30 s the module is connected to the gateway behind `httpPort`, and it lists exactly one. */
async function connectedTo(httpPort: number, module: RealModule, what: string): Promise<void> {
  const end = Date.now() + 30_000;
  while (!((await statusCount(httpPort)) === 1 && module.connected)) {
    if (Date.now() > end) throw new Error(`module did not connect to ${what} within 30 s`);
    await sleep(250);
  }
  // Still exactly one a moment later: no duplicate link from a stale socket.
  await sleep(1500);
  expect(await statusCount(httpPort)).toBe(1);
}

describe('the module LinkClient follows the gateway through handovers (module code unchanged)', () => {
  const clis: Cli[] = [];
  const modules: RealModule[] = [];
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

  async function rig() {
    const state = tempState();
    cleanups.push(state.cleanup);
    const port = await freePort();
    const httpA = await freePort();
    const httpB = await freePort();
    const a = await startCli(port, state.db, ['--http', '--http-port', String(httpA)]);
    clis.push(a);
    await until(() => /Pairing code: /.test(a.stderr()), 10_000, 'A pairing code');
    const module = new RealModule(port);
    modules.push(module);
    module.pair(pairingCode(a));
    await connectedTo(httpA, module, 'A');
    return { state, port, httpA, httpB, a, module };
  }

  it('baseline: A is primary, B takes over, and the client reconnects to B with one connection', async () => {
    const { state, port, httpB, module } = await rig();
    const b = await startCli(port, state.db, ['--http', '--http-port', String(httpB)]);
    clis.push(b);
    await connectedTo(httpB, module, 'B');
  }, 120_000);

  it('full sequence: A, then B, then A again after B is killed, one connection at each handover', async () => {
    const { state, port, httpA, httpB, a, module } = await rig();
    const b = await startCli(port, state.db, ['--http', '--http-port', String(httpB)]);
    clis.push(b);
    await connectedTo(httpB, module, 'B');
    expect(await statusCount(httpA)).toBeUndefined(); // A released its HTTP listener

    process.kill(b.pid, 'SIGKILL');
    await until(() => count(a.stderr(), 'holds link port') >= 2, 30_000, 'A takes back over');
    await connectedTo(httpA, module, 'A again');
    // A's stdio client reaches the module through the new link.
    const r = await a.client.callTool({ name: 'world_info', arguments: {} });
    expect(r.isError).toBeFalsy();
    expect(module.calls.some((c) => c.startsWith('world_info'))).toBe(true);
  }, 180_000);
});
