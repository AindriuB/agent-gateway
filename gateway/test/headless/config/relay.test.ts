import { afterEach, describe, expect, it } from 'vitest';
import type { App } from '../../../src/app.js';
import { freePort, sleep, tempState, until } from '../../relay/harness.js';
import { MultiLauncher, seedAgents, startGateway } from './harness.js';

const apps: App[] = [];
const cleanups: (() => void)[] = [];
afterEach(async () => {
  for (const a of apps.splice(0)) await a.stop();
  for (const c of cleanups.splice(0)) c();
});

async function shared() {
  const state = tempState();
  cleanups.push(state.cleanup);
  const linkPort = await freePort();
  return { state, linkPort, multi: new MultiLauncher(state.dir, () => linkPort) };
}

const agent = { name: 'a1', userId: 'ua1', password: 'p1' };

describe('stored agents and the relay takeover', () => {
  it('two gateways with the same passwords relay after a headless add between their starts', async () => {
    const s = await shared();
    s.multi.forUser('ua1');
    const a = await startGateway({ ...s, agents: [agent], sweepMs: 100 });
    apps.push(a.app);
    // `headless add` runs in another process, after A started and before B starts.
    seedAgents(s.state.db, [agent]);
    await until(() => s.multi.launches.length === 1, 5_000, 'A starts the new agent');
    const bMulti = new MultiLauncher(s.state.dir, () => s.linkPort);
    bMulti.forUser('ua1');
    const b = await startGateway({
      ...s,
      multi: bMulti,
      agents: [agent],
      sweepMs: 100,
      // Same HTTP port: the ports are compared too, and only the headless part is under test.
      httpPort: a.httpPort,
    });
    apps.push(b.app);
    await sleep(1_500);
    expect(a.lines.some((l) => l.startsWith('stepping down'))).toBe(false);
    expect(bMulti.launches).toHaveLength(0);
    expect(s.multi.launches).toHaveLength(1);
  }, 30_000);

  it('a newer plain gateway relays to a primary holding only a stored password', async () => {
    const s = await shared();
    s.multi.forUser('ua1');
    seedAgents(s.state.db, [agent]);
    const a = await startGateway({ ...s, agents: [agent], sweepMs: 100 });
    apps.push(a.app);
    await until(() => s.multi.launches.length === 1, 5_000, 'A starts its agent');
    await sleep(10);
    const bMulti = new MultiLauncher(s.state.dir, () => s.linkPort);
    const b = await startGateway({ ...s, multi: bMulti, sweepMs: 100, httpPort: a.httpPort });
    apps.push(b.app);
    await sleep(1_500);
    expect(a.lines.some((l) => l.startsWith('stepping down'))).toBe(false);
    expect(s.multi.launches).toHaveLength(1);
    expect(s.multi.launches[0]).toBeDefined();
    expect(bMulti.launches).toHaveLength(0);
  }, 30_000);

  it('a different stored password takes over, as a different flag/env password does', async () => {
    const s = await shared();
    s.multi.forUser('ua1');
    seedAgents(s.state.db, [agent]);
    const a = await startGateway({ ...s, agents: [agent], sweepMs: 100 });
    apps.push(a.app);
    await until(() => s.multi.launches.length === 1, 5_000, 'A starts its agent');
    await sleep(10);
    const bMulti = new MultiLauncher(s.state.dir, () => s.linkPort);
    bMulti.forUser('ua1');
    const b = await startGateway({
      ...s,
      multi: bMulti,
      agents: [{ ...agent, password: 'other' }],
      sweepMs: 100,
      httpPort: a.httpPort,
    });
    apps.push(b.app);
    await until(() => bMulti.launches.length > 0, 15_000, 'B starts its agent');
  }, 40_000);
});
