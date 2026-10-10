import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadContext } from '../lib/context.js';
import { readActivePairings } from '../lib/state.js';
import { isWorldOffline } from './pairs.js';
import { waitFor } from './frames.js';
import { recordResult, seconds } from './results.js';
import { Rig } from './rig.js';

const ctx = loadContext();
const { gmUser, playerUser } = ctx.config;
const num = (key: string, fallback: number): number => {
  const n = Number(process.env[key]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
const RELOAD_S = num('AGENT_GATEWAY_E2E_RELOAD_S', 30);
const RESTART_S = 60;

describe('link recovery (bound to player1, dev-gm also connected)', () => {
  let rig: Rig;
  beforeAll(async () => {
    rig = new Rig(ctx);
    await rig.open(playerUser, [gmUser, playerUser]);
  });
  afterAll(async () => {
    await rig?.close();
  });

  const info = () => rig.gateway!.call('world_info');

  it(`a tab reload gives WORLD_OFFLINE, then a call succeeds within ${RELOAD_S} s`, async () => {
    expect((await info()).isError).toBe(false);
    const frames = rig.frames(playerUser);
    const closesBefore = frames.closes;
    const t0 = Date.now();
    const reloading = rig.users.get(playerUser)!.browser.page.reload();
    // The old link closes as the page unloads; the module needs seconds to load and reconnect.
    const closed = await waitFor(() => frames.closes > closesBefore, 20_000, 50);
    expect(closed, 'the old link did not close on reload').toBeDefined();
    const offline = await info();
    expect(isWorldOffline(offline.text), offline.text).toBe(true);
    await reloading.catch(() => undefined);
    const ms = await waitFor(async () => !(await info()).isError, RELOAD_S * 1000, 500);
    const total = Date.now() - t0;
    recordResult(ctx.paths.stateDir, {
      suite: 'resilience',
      label: 'tab reload recovery',
      value: ms === undefined ? `no recovery within ${RELOAD_S} s` : seconds(total),
    });
    expect(ms, `no successful call within ${RELOAD_S} s of the reload`).toBeDefined();
  });

  it(`a gateway restart recovers within ${RESTART_S} s with no new pairing`, async () => {
    const before = readActivePairings(ctx.paths.db).length;
    const oldPid = rig.gateway!.childPid;
    expect(oldPid).not.toBeNull();
    const welcomes = rig.frames(playerUser).welcomes;
    const t0 = Date.now();
    await rig.gateway!.stop();
    await rig.startGateway(playerUser);
    expect(rig.gateway!.childPid).not.toBe(oldPid);
    const ms = await waitFor(async () => !(await info()).isError, RESTART_S * 1000, 500);
    const total = Date.now() - t0;
    const after = readActivePairings(ctx.paths.db).length;
    recordResult(ctx.paths.stateDir, {
      suite: 'resilience',
      label: 'gateway restart recovery',
      value:
        ms === undefined
          ? `no recovery within ${RESTART_S} s`
          : `${seconds(total)}; active pairings ${before} -> ${after}`,
    });
    expect(ms, `no successful call within ${RESTART_S} s of the restart`).toBeDefined();
    expect(rig.frames(playerUser).welcomes).toBeGreaterThan(welcomes);
    expect(after, 'active pairings').toBe(before);
  });
});
