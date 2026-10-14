import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadContext } from '../lib/context.js';
import { AMBIGUITY_CALLS } from './calls.js';
import { ambiguityProblems, countActivePairings } from './pairs.js';
import { recordResult } from './results.js';
import { RECONNECT_MS, Rig } from './rig.js';
import { waitFor } from './frames.js';

const ctx = loadContext();
const { gmUser, playerUser } = ctx.config;

describe('no --user with several paired identities', () => {
  let rig: Rig;
  let closes: { gm: number; player: number; gmOpens: number; playerOpens: number };
  beforeAll(async () => {
    expect(countActivePairings(ctx.paths.db), 'active pairings').toBeGreaterThanOrEqual(2);
    rig = new Rig(ctx);
    // Unbound gateway: --world test-world and no --user.
    // The MCP client connects only after both pages are welcomed (task 71 follow mode).
    await rig.openThenConnect(undefined, [gmUser, playerUser]);
    closes = {
      gm: rig.frames(gmUser).closes,
      player: rig.frames(playerUser).closes,
      gmOpens: rig.frames(gmUser).opens,
      playerOpens: rig.frames(playerUser).opens,
    };
  });
  afterAll(async () => {
    await rig?.close();
  });

  it.each(AMBIGUITY_CALLS)(
    '%s is refused with INVALID_ARGS naming both users',
    async (name, args) => {
      const r = await rig.gateway!.call(name, args);
      expect(r.isError, r.text).toBe(true);
      expect(ambiguityProblems(r.text, [gmUser, playerUser])).toEqual([]);
      if (name === 'world_info') {
        recordResult(ctx.paths.stateDir, {
          suite: 'ambiguity',
          label: 'refusal text',
          value: r.text,
        });
      }
    },
  );

  it('neither page received a call frame', async () => {
    await rig.settle();
    // Both links stayed open the whole time, so a count of 0 is meaningful.
    expect(rig.frames(gmUser).closes, `${gmUser} link closes`).toBe(closes.gm);
    expect(rig.frames(playerUser).closes, `${playerUser} link closes`).toBe(closes.player);
    expect(rig.frames(gmUser).opens, `${gmUser} link opens`).toBe(closes.gmOpens);
    expect(rig.frames(playerUser).opens, `${playerUser} link opens`).toBe(closes.playerOpens);
    const gm = rig.frames(gmUser).calls;
    const pl = rig.frames(playerUser).calls;
    recordResult(ctx.paths.stateDir, {
      suite: 'ambiguity',
      label: `call frames (${gmUser} / ${playerUser}) over ${AMBIGUITY_CALLS.length} calls`,
      value: `${gm} / ${pl}`,
    });
    expect(gm).toBe(0);
    expect(pl).toBe(0);
  });

  it('binds to the survivor once the other page leaves', async () => {
    const gmCallsBefore = rig.frames(gmUser).calls;
    const plCallsBefore = rig.frames(playerUser).calls;
    const player = rig.users.get(playerUser)!;
    const closesBefore = player.frames.closes;
    await player.browser.close();
    const closed = await waitFor(() => player.frames.closes > closesBefore, RECONNECT_MS);
    expect(closed, `${playerUser} link did not close`).toBeDefined();
    let last = '';
    const served = await waitFor(async () => {
      const r = await rig.gateway!.call('world_info');
      last = r.text;
      return !r.isError;
    }, RECONNECT_MS);
    expect(served, `world_info never succeeded: ${last}`).toBeDefined();
    expect(rig.frames(gmUser).calls).toBeGreaterThan(gmCallsBefore);
    expect(rig.frames(playerUser).calls).toBe(plCallsBefore);
  });
});
