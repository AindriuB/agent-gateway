/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { imageAssignHandler } from '../../../src/tools/image-assign.js';
import { ctxFor, g, gm, player, setup } from './fixtures.js';

let f: ReturnType<typeof setup>;
beforeEach(() => {
  f = setup(14);
});
afterEach(() => f.restore());

const allow = (playerAgents: string[], gmAgents: string[]) =>
  g.game.settings.set('agent-gateway', 'folderAllowlist', { playerAgents, gmAgents });
const run = (user: any, args: unknown) => imageAssignHandler(ctxFor(user, args, f.snapshot)) as any;

const cases: Array<{
  target: string;
  uuid: string;
  missing: string;
  root: string;
  gmOnly: boolean;
}> = [
  { target: 'actor_portrait', uuid: 'Actor.a', missing: 'Actor.zz', root: 'actor', gmOnly: false },
  { target: 'actor_token', uuid: 'Actor.a', missing: 'Actor.zz', root: 'actor', gmOnly: false },
  { target: 'scene_background', uuid: 'Scene.s', missing: 'Scene.zz', root: 'scene', gmOnly: true },
  {
    target: 'token',
    uuid: 'Scene.s.Token.t',
    missing: 'Scene.s.Token.zz',
    root: 'scene',
    gmOnly: false,
  },
  {
    target: 'tile',
    uuid: 'Scene.s.Tile.tl',
    missing: 'Scene.s.Tile.zz',
    root: 'scene',
    gmOnly: true,
  },
];
const set = (user: any, c: (typeof cases)[number]) =>
  run(user, { action: 'set', path: 'art/a.png', target: c.target, uuid: c.uuid });
const rootDoc = (c: (typeof cases)[number]) => (c.root === 'actor' ? f.docs.actor : f.docs.scene);
const nothingWritten = () => {
  expect(f.events.filter((e) => e.startsWith('update:'))).toEqual([]);
  expect(f.snapshot).not.toHaveBeenCalled();
};

describe('image_assign set folder allowlist', () => {
  for (const [label, user] of [
    ['player agent', player],
    ['GM agent', gm],
  ] as const) {
    const lists = (ids: string[]) => (user.isGM ? allow([], ids) : allow(ids, []));
    for (const c of cases.filter((c) => user.isGM || !c.gmOnly)) {
      it(`refuses an excluded ${c.target} like a missing uuid (${label})`, async () => {
        rootDoc(c).folder = { id: 'out' };
        lists(['in']);
        const refused = await set(user, c);
        nothingWritten();
        const missing = await run(user, {
          action: 'set',
          path: 'art/a.png',
          target: c.target,
          uuid: c.missing,
        });
        expect(refused.error.code).toBe('INVALID_ARGS');
        expect(refused.error).toEqual(missing.error);
      });
      it(`allows ${c.target} in a listed ancestor folder (${label})`, async () => {
        rootDoc(c).folder = { id: 'child', folder: { id: 'in' } };
        lists(['in']);
        const r = await set(user, c);
        expect(r.error).toBeUndefined();
        expect(f.events.some((e) => e.startsWith('update:'))).toBe(true);
      });
      it(`imposes no restriction with an empty allowlist for ${c.target} (${label})`, async () => {
        rootDoc(c).folder = { id: 'out' };
        lists([]);
        const r = await set(user, c);
        expect(r.error).toBeUndefined();
      });
    }
  }
});
