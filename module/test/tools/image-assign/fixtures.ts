/* eslint-disable @typescript-eslint/no-explicit-any */
import { vi } from 'vitest';
import { installFoundry } from '../../stubs/foundry.js';

export const g = globalThis as any;
export const gm = { id: 'gm', isGM: true, can: () => true };
export const player = { id: 'p1', isGM: false, can: (p: string) => p === 'FILES_BROWSE' };
export const noBrowse = { id: 'p3', isGM: false, can: () => false };

/** A document whose `update` applies dotted keys and records the call order. */
function doc(
  name: string,
  id: string,
  uuid: string,
  data: any,
  owners: string[],
  events: string[],
) {
  const d: any = {
    ...data,
    id,
    uuid,
    documentName: name,
    owners: new Set(owners),
    testUserPermission: (u: any, level: string) =>
      u.isGM || (level === 'OWNER' && d.owners.has(u.id)),
    canUserModify: () => true,
    update: vi.fn(async (changes: any, options: any) => {
      events.push(`update:${uuid}`);
      for (const [k, v] of Object.entries(changes)) set(d, k, v);
      d.lastOptions = options;
      return d;
    }),
  };
  return d;
}
function set(o: any, path: string, v: unknown) {
  const keys = path.split('.');
  const last = keys.pop()!;
  for (const k of keys) o = o[k] ??= {};
  o[last] = v;
}

export function setup(generation: 13 | 14 = 14) {
  const stub = installFoundry(generation);
  const saved = { foundry: g.foundry, fromUuid: g.fromUuid, user: g.game.user };
  const events: string[] = [];
  const listings = new Map<string, any>([
    ['', { dirs: ['art'], files: ['x.png', 'notes.txt'] }],
    ['art', { dirs: [], files: ['art/a.png', 'art/b%20c.webp'] }],
  ]);
  const browse = vi.fn(async (_source: string, target: string) => {
    const l = listings.get(target);
    if (!l) throw new Error(`Directory ${target} does not exist`);
    return l;
  });
  g.foundry = {
    ...g.foundry,
    applications: { apps: { FilePicker: { implementation: { browse } } } },
  };
  const users = [gm, player, noBrowse, { id: 'p2', isGM: false, can: () => true }];
  g.game.users = { get: (id: string) => users.find((u) => u.id === id) };
  g.game.user = player;

  const actor = doc(
    'Actor',
    'a',
    'Actor.a',
    { img: 'old.png', prototypeToken: { texture: { src: 'old-t.png' } } },
    ['p1'],
    events,
  );
  const foreign = doc(
    'Actor',
    'f',
    'Actor.f',
    { img: 'f.png', prototypeToken: { texture: { src: 'f.png' } } },
    ['p2'],
    events,
  );
  const scene: any = doc(
    'Scene',
    's',
    'Scene.s',
    { background: { src: 'old-bg.png' } },
    [],
    events,
  );
  const mine = doc(
    'Token',
    't',
    'Scene.s.Token.t',
    { texture: { src: 'old-tok.png' } },
    ['p1'],
    events,
  );
  const theirs = doc(
    'Token',
    'u',
    'Scene.s.Token.u',
    { texture: { src: 'u.png' } },
    ['p2'],
    events,
  );
  const tile = doc(
    'Tile',
    'tl',
    'Scene.s.Tile.tl',
    { texture: { src: 'old-tile.png' } },
    [],
    events,
  );
  mine.parent = theirs.parent = tile.parent = scene;
  scene.tokens = new Map([
    ['t', mine],
    ['u', theirs],
  ]);
  scene.tiles = new Map([['tl', tile]]);
  // v14 keeps the background on a Level; scene.update is a no-op for it.
  const level = doc(
    'Level',
    'defaultLevel0000',
    'Scene.s.Level.defaultLevel0000',
    { background: { src: null } },
    [],
    events,
  );
  level.parent = scene;
  scene.levels = Object.assign(new Map([['defaultLevel0000', level]]), { contents: [level] });
  scene.updateEmbeddedDocuments = vi.fn(async (_n: string, rows: any[], options: any) => {
    events.push(`update:${level.uuid}`);
    for (const row of rows)
      for (const [k, v] of Object.entries(row)) if (k !== '_id') set(level, k, v);
    scene.background = { src: level.background.src };
    level.lastOptions = options;
    return [level];
  });
  g.game.actors = new Map([
    ['a', actor],
    ['f', foreign],
  ]);
  g.game.scenes = new Map([['s', scene]]);
  g.game.release = { generation };
  const all = new Map<string, any>(
    [actor, foreign, scene, mine, theirs, tile, level].map((d) => [d.uuid, d]),
  );
  g.fromUuid = vi.fn(async (uuid: string) => all.get(uuid) ?? null);
  const snapshots: string[] = [];
  const snapshot = vi.fn(async (uuid: string) => {
    events.push(`snapshot:${uuid}`);
    snapshots.push(uuid);
  });
  return {
    docs: { actor, foreign, scene, mine, theirs, tile, level },
    browse,
    listings,
    events,
    snapshot,
    restore() {
      g.foundry = saved.foundry;
      g.fromUuid = saved.fromUuid;
      g.game.user = saved.user;
      stub.uninstall();
    },
  };
}

export function ctxFor(user: any, args: unknown, snapshot: any) {
  g.game.user = user;
  return {
    tool: 'image_assign',
    args,
    user: { id: user.id, isGM: user.isGM },
    agent: { id: 'a', ownerUserId: user.id, headless: false },
    sessionId: 's',
    snapshot,
    intendCreate: vi.fn(),
    created: vi.fn(),
    callOptions: { agentGateway: { callId: 'call-1' } },
  } as any;
}
