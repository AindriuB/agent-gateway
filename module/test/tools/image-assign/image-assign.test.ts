/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { imageAssignHandler } from '../../../src/tools/image-assign.js';
import { ctxFor, gm, noBrowse, player, setup } from './fixtures.js';

let f: ReturnType<typeof setup>;
beforeEach(() => {
  f = setup(14);
});
afterEach(() => f.restore());
const run = (user: any, args: unknown) => imageAssignHandler(ctxFor(user, args, f.snapshot)) as any;
const set = (user: any, over: Record<string, unknown>) =>
  run(user, {
    action: 'set',
    path: 'art/a.png',
    target: 'actor_portrait',
    uuid: 'Actor.a',
    ...over,
  });

describe('image_assign list', () => {
  it('lists the Data root with an omitted or empty dir', async () => {
    for (const args of [{ action: 'list' }, { action: 'list', dir: '' }]) {
      const r = await run(gm, args);
      expect(r.structured).toEqual({
        dirs: [{ path: 'art', name: 'art' }],
        files: [{ path: 'x.png', name: 'x.png' }],
        truncated: false,
      });
    }
  });
  it('rejects / and . as INVALID_ARGS and refuses a player without FILES_BROWSE', async () => {
    for (const dir of ['/', '.'])
      expect(await run(gm, { action: 'list', dir })).toMatchObject({
        error: { code: 'INVALID_ARGS' },
      });
    expect(await run(noBrowse, { action: 'list' })).toMatchObject({ error: { code: 'FORBIDDEN' } });
  });
  it('honours limit and reports truncation', async () => {
    const r = await run(gm, { action: 'list', dir: 'art', limit: 1 });
    expect(r.structured).toMatchObject({ truncated: true });
    expect(r.structured.files).toHaveLength(1);
  });
});

describe('image_assign set validation (no update on failure)', () => {
  it.each([['../x.png'], ['x.svg'], ['https://example.com/x.png'], ['art/missing.png']])(
    'rejects %s',
    async (path) => {
      expect(await set(gm, { path })).toMatchObject({ error: { code: 'INVALID_ARGS' } });
      expect(f.docs.actor.update).not.toHaveBeenCalled();
      expect(f.snapshot).not.toHaveBeenCalled();
    },
  );
  it('rejects an Actor uuid sent with target tile', async () => {
    expect(await set(gm, { target: 'tile' })).toMatchObject({ error: { code: 'INVALID_ARGS' } });
    expect(f.docs.actor.update).not.toHaveBeenCalled();
  });
  it('rejects fields that do not belong to the action', async () => {
    expect(await set(gm, { dir: 'art' })).toMatchObject({ error: { code: 'INVALID_ARGS' } });
  });
  it('sets a root-level image (parent is the Data root)', async () => {
    const r = await set(gm, { path: 'x.png' });
    expect(r.structured).toEqual({ path: 'x.png', target: 'actor_portrait', uuid: 'Actor.a' });
    expect(f.browse).toHaveBeenCalledWith('data', '');
    expect(f.docs.actor.img).toBe('x.png');
  });
  it('accepts the raw form of an encoded path and writes Foundry canonical string', async () => {
    await set(gm, { path: 'art/b c.webp' });
    expect(f.docs.actor.img).toBe('art/b%20c.webp');
  });
});

describe('image_assign permissions', () => {
  it('refuses set for a player without FILES_BROWSE', async () => {
    expect(await set(noBrowse, {})).toMatchObject({ error: { code: 'FORBIDDEN' } });
    expect(f.docs.actor.update).not.toHaveBeenCalled();
  });
  it('refuses a player on a non-owned Actor and on another user token', async () => {
    expect(await set(player, { uuid: 'Actor.f' })).toMatchObject({ error: { code: 'FORBIDDEN' } });
    expect(await set(player, { target: 'token', uuid: 'Scene.s.Token.u' })).toMatchObject({
      error: { code: 'FORBIDDEN' },
    });
    expect(f.docs.foreign.update).not.toHaveBeenCalled();
    expect(f.docs.theirs.update).not.toHaveBeenCalled();
  });
  it('refuses a player on scene_background and tile', async () => {
    expect(await set(player, { target: 'scene_background', uuid: 'Scene.s' })).toMatchObject({
      error: { code: 'FORBIDDEN' },
    });
    expect(await set(player, { target: 'tile', uuid: 'Scene.s.Tile.tl' })).toMatchObject({
      error: { code: 'FORBIDDEN' },
    });
    expect(f.docs.tile.update).not.toHaveBeenCalled();
    expect(f.docs.scene.updateEmbeddedDocuments).not.toHaveBeenCalled();
  });
  it('maps a native permission refusal to FORBIDDEN', async () => {
    f.docs.actor.update.mockRejectedValueOnce(new Error('User lacks permission to update Actor'));
    expect(await set(player, {})).toMatchObject({ error: { code: 'FORBIDDEN' } });
  });
  it('lets a player set the portrait, prototype token art and an owned token', async () => {
    await set(player, {});
    await set(player, { target: 'actor_token' });
    await set(player, { target: 'token', uuid: 'Scene.s.Token.t' });
    expect(f.docs.actor.img).toBe('art/a.png');
    expect(f.docs.actor.prototypeToken.texture.src).toBe('art/a.png');
    expect(f.docs.mine.texture.src).toBe('art/a.png');
  });
});

describe('image_assign snapshot and undo data', () => {
  const cases: [string, string, (d: any) => unknown, string, string, (d: any) => any][] = [
    ['actor_portrait', 'Actor.a', (d) => d.actor.img, 'Actor.a', 'old.png', (d) => d.actor],
    [
      'actor_token',
      'Actor.a',
      (d) => d.actor.prototypeToken.texture.src,
      'Actor.a',
      'old-t.png',
      (d) => d.actor,
    ],
    [
      'token',
      'Scene.s.Token.t',
      (d) => d.mine.texture.src,
      'Scene.s.Token.t',
      'old-tok.png',
      (d) => d.mine,
    ],
    [
      'tile',
      'Scene.s.Tile.tl',
      (d) => d.tile.texture.src,
      'Scene.s.Tile.tl',
      'old-tile.png',
      (d) => d.tile,
    ],
  ];
  it.each(cases)(
    '%s: snapshot precedes the update and carries callOptions',
    async (target, uuid, read, snap, old, owner) => {
      let before: unknown;
      f.snapshot.mockImplementationOnce(async (u: string) => {
        f.events.push(`snapshot:${u}`);
        before = read(f.docs);
      });
      const ctx = ctxFor(gm, { action: 'set', path: 'art/a.png', target, uuid }, f.snapshot);
      await imageAssignHandler(ctx);
      expect(before).toBe(old);
      expect(read(f.docs)).toBe('art/a.png');
      expect(f.events).toEqual([`snapshot:${snap}`, `update:${snap}`]);
      expect(ctx.callOptions.agentGateway.callId).toBe('call-1');
      expect(owner(f.docs).lastOptions).toBe(ctx.callOptions);
    },
  );
  it('scene_background on v14 snapshots and updates the Level', async () => {
    const ctx = ctxFor(
      gm,
      { action: 'set', path: 'art/a.png', target: 'scene_background', uuid: 'Scene.s' },
      f.snapshot,
    );
    const r: any = await imageAssignHandler(ctx);
    expect(r.structured.uuid).toBe('Scene.s');
    expect(f.events).toEqual([
      'snapshot:Scene.s.Level.defaultLevel0000',
      'update:Scene.s.Level.defaultLevel0000',
    ]);
    expect(f.docs.scene.update).not.toHaveBeenCalled();
    expect(f.docs.scene.updateEmbeddedDocuments).toHaveBeenCalledWith(
      'Level',
      [{ _id: 'defaultLevel0000', 'background.src': 'art/a.png' }],
      ctx.callOptions,
    );
    expect(f.docs.level.background.src).toBe('art/a.png');
    expect(f.docs.scene.background.src).toBe('old-bg.png');
  });
  it('scene_background on v14 reads back the initialLevel, not the first Level', async () => {
    const init: any = { ...f.docs.level, id: 'init', uuid: 'Scene.s.Level.init', background: {} };
    init.update = f.docs.level.update;
    const scene = f.docs.scene;
    scene.levels = Object.assign(
      new Map([
        ['defaultLevel0000', f.docs.level],
        ['init', init],
      ]),
      { contents: [f.docs.level, init] },
    );
    scene.initialLevel = init;
    scene.updateEmbeddedDocuments = vi.fn(async (_n: string, rows: any[]) => {
      init.background.src = rows[0]['background.src'];
      return [init];
    });
    const ctx = ctxFor(
      gm,
      { action: 'set', path: 'art/a.png', target: 'scene_background', uuid: 'Scene.s' },
      f.snapshot,
    );
    await imageAssignHandler(ctx);
    expect(scene.updateEmbeddedDocuments).toHaveBeenCalledWith(
      'Level',
      [{ _id: 'init', 'background.src': 'art/a.png' }],
      ctx.callOptions,
    );
    expect(f.docs.level.background.src).toBeNull();
  });
  it('scene_background on v13 updates the Scene', async () => {
    f.restore();
    f = setup(13);
    const ctx = ctxFor(
      gm,
      { action: 'set', path: 'art/a.png', target: 'scene_background', uuid: 'Scene.s' },
      f.snapshot,
    );
    await imageAssignHandler(ctx);
    expect(f.events).toEqual(['snapshot:Scene.s', 'update:Scene.s']);
    expect(f.docs.scene.background.src).toBe('art/a.png');
  });
  it('fails (not silently) when Foundry did not store the path', async () => {
    f.docs.actor.update.mockImplementationOnce(async () => undefined);
    await expect(set(gm, {})).rejects.toThrow(/did not store/);
  });
});
