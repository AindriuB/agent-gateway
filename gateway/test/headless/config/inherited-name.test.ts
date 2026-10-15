import { afterEach, describe, expect, it } from 'vitest';
import type { App } from '../../../src/app.js';
import { sleep, freePort, tempState } from '../../relay/harness.js';
import { MultiLauncher, seedAgents, startGateway } from './harness.js';

const apps: App[] = [];
const cleanups: (() => void)[] = [];
afterEach(async () => {
  for (const a of apps.splice(0)) await a.stop();
  for (const c of cleanups.splice(0)) c();
});

describe('inherited object keys as agent names', () => {
  it('an agent named constructor with no password is not started, with one log line', async () => {
    const state = tempState();
    cleanups.push(state.cleanup);
    const linkPort = await freePort();
    const multi = new MultiLauncher(state.dir, () => linkPort);
    seedAgents(state.db, [{ name: 'constructor', userId: 'uc' }]);
    const g = await startGateway({ state, linkPort, agents: [], multi, sweepMs: 100 });
    apps.push(g.app);
    await sleep(500);
    expect(multi.launches).toHaveLength(0);
    expect(g.lines.filter((l) => l.includes('agent constructor has no password'))).toHaveLength(1);
  }, 30_000);
});
