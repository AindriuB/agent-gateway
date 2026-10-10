import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadContext } from '../lib/context.js';
import { activePairingIds, judgeReloadProbe } from './pairs.js';
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
// Longer than the slowest wait inside any test here plus its calls.
const TEST_TIMEOUT_MS = 180_000;

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

  it(
    `a tab reload gives WORLD_OFFLINE, then a call succeeds within ${RELOAD_S} s`,
    async () => {
      expect((await info()).isError).toBe(false);
      const page = rig.users.get(playerUser)!.browser.page;
      let navigated = false;
      page.on('framenavigated', (f) => {
        if (f === page.mainFrame()) navigated = true;
      });
      const t0 = Date.now();
      const reloading = page.reload().catch(() => undefined);
      // Playwright may not fire a WebSocket `close` on a reload, so poll the calls instead.
      let sawOffline = false;
      let verdict: 'continue' | 'recovered' | 'failed' = 'continue';
      let reason = `no successful call within ${RELOAD_S} s of the reload`;
      while (Date.now() - t0 < RELOAD_S * 1000) {
        const j = judgeReloadProbe(await info(), { sawOffline, navigated });
        sawOffline = j.sawOffline;
        verdict = j.verdict;
        if (j.reason) reason = j.reason;
        if (verdict !== 'continue') break;
        await new Promise((res) => setTimeout(res, 100));
      }
      await reloading;
      const total = Date.now() - t0;
      const ms = verdict === 'recovered' ? total : undefined;
      recordResult(ctx.paths.stateDir, {
        suite: 'resilience',
        label: 'tab reload recovery',
        value: ms === undefined ? `no recovery within ${RELOAD_S} s` : seconds(total),
      });
      expect(ms, reason).toBeDefined();
      expect(total, 'reload recovery (ms)').toBeLessThanOrEqual(RELOAD_S * 1000);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    `a gateway restart recovers within ${RESTART_S} s with no new pairing`,
    async () => {
      const before = activePairingIds(ctx.paths.db);
      const oldPid = rig.gateway!.childPid;
      expect(oldPid).not.toBeNull();
      const welcomes = rig.frames(playerUser).welcomes;
      const t0 = Date.now();
      await rig.gateway!.stop();
      await rig.startGateway(playerUser);
      expect(rig.gateway!.childPid).not.toBe(oldPid);
      const ms = await waitFor(async () => !(await info()).isError, RESTART_S * 1000, 500);
      const total = Date.now() - t0;
      const after = activePairingIds(ctx.paths.db);
      recordResult(ctx.paths.stateDir, {
        suite: 'resilience',
        label: 'gateway restart recovery',
        value:
          ms === undefined
            ? `no recovery within ${RESTART_S} s`
            : `${seconds(total)}; active pairings ${before.length} -> ${after.length}`,
      });
      expect(ms, `no successful call within ${RESTART_S} s of the restart`).toBeDefined();
      expect(rig.frames(playerUser).welcomes).toBeGreaterThan(welcomes);
      expect(after, 'active pairing ids').toEqual(before);
    },
    TEST_TIMEOUT_MS,
  );
});
