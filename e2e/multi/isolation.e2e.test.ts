import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadContext } from '../lib/context.js';
import { worldInfoProblems } from '../lib/expect.js';
import { chatProblems, type ChatMsg } from '../lib/expect.js';
import { blindMessageId } from '../lib/context.js';
import { ISOLATION_TOOLS, leakCheckerFor, readFourTools } from './calls.js';
import { hasPairing, SKIP_PLAYER2 } from './pairs.js';
import { Rig } from './rig.js';
import { recordResult, seconds } from './results.js';

const ctx = loadContext();
const { gmUser, playerUser, player2User, world } = ctx.config;
const SUITE = 'isolation';

/** Bound to `bound`: every result is that user's, and only that user's page gets call frames. */
function boundSuite(rig: () => Rig, bound: string, other: string, role: 'gm' | 'player'): void {
  it(`--user ${bound}: four tools answer as ${bound}; ${other}'s page gets 0 call frames`, async () => {
    const r = rig();
    const t = await r.swap(bound);
    const boundFrames = r.frames(bound);
    const otherFrames = r.frames(other);
    const b0 = boundFrames.calls;
    const o0 = otherFrames.calls;
    const scan = role === 'player' ? leakCheckerFor(ctx) : undefined;
    const res = await readFourTools(r.gateway!, scan);
    await r.settle();
    for (const name of ISOLATION_TOOLS)
      expect(res[name]?.isError, `${name}: ${res[name]?.text}`).toBe(false);
    expect(
      worldInfoProblems(role, res.world_info?.structured ?? {}, { world, user: bound }),
    ).toEqual([]);
    const boundGot = boundFrames.calls - b0;
    const otherGot = otherFrames.calls - o0;
    recordResult(ctx.paths.stateDir, {
      suite: SUITE,
      label: `--user ${bound} call frames (${bound} / ${other})`,
      value: `${boundGot} / ${otherGot} (swap ${seconds(t)})`,
    });
    expect(boundGot, `${bound} call frames`).toBe(ISOLATION_TOOLS.length);
    expect(otherGot, `${other} call frames`).toBe(0);
  });
}

describe('bound isolation (dev-gm and player1 connected)', () => {
  let rig: Rig;
  beforeAll(async () => {
    rig = new Rig(ctx);
    await rig.open(playerUser, [gmUser, playerUser]);
  });
  afterAll(async () => {
    await rig?.close();
  });
  boundSuite(() => rig, playerUser, gmUser, 'player');
  boundSuite(() => rig, gmUser, playerUser, 'gm');
});

const player2Paired = hasPairing(ctx.paths.db, world, player2User);
if (!player2Paired) process.stdout.write(`${SKIP_PLAYER2}\n`);

describe.skipIf(!player2Paired)('cross-player isolation (player1 and player2 connected)', () => {
  let rig: Rig;
  beforeAll(async () => {
    rig = new Rig(ctx);
    await rig.open(player2User, [playerUser, player2User]);
  });
  afterAll(async () => {
    await rig?.close();
  });

  it("--user player2: chat_read excludes player1's whisper, no leaks, player1 gets 0 call frames", async () => {
    const p1 = rig.frames(playerUser);
    const p2 = rig.frames(player2User);
    const p1Before = p1.calls;
    const p2Before = p2.calls;
    const scan = leakCheckerFor(ctx);
    const msgs: ChatMsg[] = [];
    let before: string | undefined;
    for (let page = 0; page < 5; page++) {
      const args = { limit: 100, ...(before ? { before } : {}) };
      const r = await rig.gateway!.call('chat_read', args);
      scan.check('chat_read', args, r.raw);
      expect(r.isError, r.text).toBe(false);
      for (const m of (r.structured?.messages ?? []) as ChatMsg[]) msgs.push(m);
      before = r.structured?.nextBefore as string | undefined;
      if (!before) break;
    }
    await rig.settle();
    // chatProblems for a player rejects the GM whisper and the blind roll that player2 cannot see.
    expect(chatProblems('player', msgs, blindMessageId(ctx))).toEqual([]);
    expect(scan.summary().hits).toBe(0);
    recordResult(ctx.paths.stateDir, {
      suite: SUITE,
      label: `--user ${player2User} call frames (${player2User} / ${playerUser})`,
      value: `${p2.calls - p2Before} / ${p1.calls - p1Before}`,
    });
    expect(p1.calls - p1Before, 'player1 call frames').toBe(0);
    expect(p2.calls - p2Before).toBeGreaterThan(0);
  });
});
