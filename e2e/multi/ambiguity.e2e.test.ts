import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadContext } from '../lib/context.js';
import { AMBIGUITY_CALLS } from './calls.js';
import { ambiguityProblems, countActivePairings } from './pairs.js';
import { recordResult } from './results.js';
import { Rig } from './rig.js';

const ctx = loadContext();
const { gmUser, playerUser } = ctx.config;

describe('no --user with several paired identities', () => {
  let rig: Rig;
  beforeAll(async () => {
    expect(countActivePairings(ctx.paths.db), 'active pairings').toBeGreaterThanOrEqual(2);
    rig = new Rig(ctx);
    // Unbound gateway: --world test-world and no --user.
    await rig.open(undefined, [gmUser, playerUser]);
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
    },
  );

  it('neither page received a call frame', async () => {
    await rig.settle();
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
});
