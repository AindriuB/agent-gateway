/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, expect, it, vi } from 'vitest';
import { task27NativeState } from './native-state.js';
import { task27Plan } from './native-plan.js';
afterEach(() => vi.unstubAllGlobals());
function setup() {
  const run = '123456789abc',
    gm = { id: 'gm', isGM: true, active: true },
    collections: any = {};
  for (const key of [
    'actors',
    'items',
    'journal',
    'scenes',
    'combats',
    'tables',
    'playlists',
    'macros',
    'messages',
  ])
    collections[key] = {
      contents: [] as any[],
      get(id: string) {
        return this.contents.find((d: any) => d.id === id);
      },
    };
  const source = { _id: 'a', name: 'Task27-NPC', type: 'npc', flags: { world: { task27: run } } };
  const actor: any = {
    ...source,
    id: 'a',
    uuid: 'Actor.a',
    documentName: 'Actor',
    items: { size: 0 },
    effects: { size: 0 },
    toObject: () => ({ ...source, name: actor.name }),
    delete: vi.fn(async () => {
      collections.actors.contents = [];
    }),
  };
  collections.actors.contents = [actor];
  const anchor = { value: 'audit', user: null, _stats: { lastModifiedBy: 'gm' } },
    audit = {
      id: 'audit',
      uuid: 'JournalEntry.audit',
      flags: { 'agent-gateway': { auditJournal: true } },
      ownership: { default: 0 },
      pages: { contents: [] },
    };
  collections.journal.contents = [audit];
  const baseline = {
    gm,
    worldTime: 0,
    policy: {},
    auditJournalId: 'audit',
    roots: Object.fromEntries(
      Object.keys(collections).map((key) => [key, key === 'journal' ? ['JournalEntry.audit'] : []]),
    ),
    sources: [],
  };
  const users = {
    get: (id: string) => (id === 'gm' ? gm : undefined),
    activeGM: gm,
    filter: (fn: any) => [gm].filter(fn),
    some: (fn: any) => [gm].some(fn),
  };
  const game = {
    ready: true,
    world: { id: 'test-world' },
    release: { generation: 14 },
    user: gm,
    users,
    time: { worldTime: 0 },
    ...collections,
    documentTypes: { JournalEntryPage: ['agent-gateway.audit'] },
    settings: {
      get: (_module: string, key: string) => (key === 'auditJournalId' ? 'audit' : {}),
      storage: { get: () => ({ getSetting: () => anchor }) },
    },
  };
  vi.stubGlobal('game', game);
  vi.stubGlobal('localStorage', { getItem: () => null });
  vi.stubGlobal(
    '__task27Pins',
    new Map([
      [
        run,
        {
          audit,
          anchor,
          anchorSource: JSON.stringify(anchor),
          documents: new Map([['Actor.a', { doc: actor, source: JSON.stringify(source) }]]),
        },
      ],
    ]),
  );
  const input = {
    op: 'cleanup',
    run,
    generation: 14,
    baseline,
    plan: { actor: { name: actor.name }, actorNames: [], scene: { name: 'unused' } },
    audits: [],
    expectedUUIDs: ['Actor.a'],
  };
  return { input, actor, gm, collections, game };
}
it('cleans only the exact returned native Actor and preserves baseline root identity', async () => {
  const s = setup();
  await expect(task27NativeState(s.input)).resolves.toMatchObject({
    absent: 1,
    auditsRetained: 0,
    rootsUnchanged: true,
  });
  expect(s.actor.delete).toHaveBeenCalledTimes(1);
});
it('refuses same-ID replacement and same-reference source drift before any deletion', async () => {
  const s = setup();
  s.collections.actors.contents = [{ ...s.actor }];
  await expect(task27NativeState(s.input)).rejects.toThrow('identity/source');
  expect(s.actor.delete).not.toHaveBeenCalled();
  s.collections.actors.contents = [s.actor];
  s.actor.name = 'changed externally';
  await expect(task27NativeState(s.input)).rejects.toThrow('identity/source');
  expect(s.actor.delete).not.toHaveBeenCalled();
});
it('refuses cleanup after GM demotion without invoking native delete', async () => {
  const s = setup();
  s.gm.isGM = false;
  await expect(task27NativeState(s.input)).rejects.toThrow('canonical native GM');
  expect(s.actor.delete).not.toHaveBeenCalled();
});

function setupCreate(generation: 13 | 14) {
  const s = setup();
  s.game.release.generation = generation;
  s.collections.actors.contents = [];
  const plan = task27Plan(s.input.run, generation);
  const raw: any = { _id: 's', ...plan.scene, tokens: [] };
  const tokens: any = {
    contents: [],
    get size() {
      return this.contents.length;
    },
    get(id: string) {
      return this.contents.find((t: any) => t.id === id);
    },
    [Symbol.iterator]() {
      return this.contents[Symbol.iterator]();
    },
  };
  const levels: any = {
    contents: [],
    get size() {
      return this.contents.length;
    },
    get(id: string) {
      return this.contents.find((l: any) => l.id === id);
    },
    [Symbol.iterator]() {
      return this.contents[Symbol.iterator]();
    },
  };
  const scene: any = {
    id: 's',
    uuid: 'Scene.s',
    documentName: 'Scene',
    name: plan.scene.name,
    flags: plan.scene.flags,
    active: false,
    tokens,
    levels,
    toObject: () => structuredClone(raw),
    createEmbeddedDocuments: vi.fn(async (_type: string, data: any[]) => {
      tokens.contents = data.map((d: any, i: number) => {
        const id = `t${i}`,
          delta =
            generation === 13
              ? {
                  _id: id,
                  system: {},
                  flags: {},
                  name: null,
                  type: null,
                  img: null,
                  items: [],
                  effects: [],
                  ownership: null,
                }
              : null;
        const source = { _id: id, ...d, delta };
        return {
          ...source,
          id,
          uuid: `Scene.s.Token.${id}`,
          documentName: 'Token',
          parent: scene,
          actor: s.actor,
          _source: source,
          toObject: () => ({ ...structuredClone(source), delta: null }),
        };
      });
      raw.tokens = tokens.contents.map((t: any) => structuredClone(t._source));
      return tokens.contents;
    }),
  };
  if (generation === 14) {
    const level = {
      id: 'task27ground0001',
      uuid: 'Scene.s.Level.task27ground0001',
      parent: scene,
      toObject: () => structuredClone(raw.levels[0]),
    };
    levels.contents = [level];
    scene.initialLevel = level;
  }
  vi.stubGlobal('CONFIG', {
    Actor: {
      documentClass: {
        create: vi.fn(async () => {
          s.collections.actors.contents = [s.actor];
          return s.actor;
        }),
      },
    },
    Scene: {
      documentClass: {
        create: vi.fn(async () => {
          s.collections.scenes.contents = [scene];
          return scene;
        }),
      },
    },
  });
  const input = { ...s.input, op: 'create', generation, plan };
  return { ...s, input, scene, raw, tokens };
}
it.each([13, 14] as const)(
  'pins canonical native generation %i raw Scene children independently from linked Token exports',
  async (generation) => {
    const s = setupCreate(generation);
    await expect(task27NativeState(s.input)).resolves.toMatchObject({
      actor: s.actor.uuid,
      scene: s.scene.uuid,
      tokens: ['Scene.s.Token.t0', 'Scene.s.Token.t1'],
    });
    const pins = (globalThis as any).__task27Pins.get(s.input.run).documents;
    expect(JSON.parse(pins.get('Scene.s').source).tokens[0].delta).toEqual(null);
    expect(JSON.parse(pins.get('Scene.s.Token.t0').source).delta).toBeNull();
    s.raw.tokens[0].delta = { _id: 't0', system: { injected: true } };
    await expect(task27NativeState({ ...s.input, op: 'facts' })).rejects.toThrow('identity/source');
  },
);
it('refuses foreign canonical child replacement and unrelated Scene drift during create', async () => {
  const s = setupCreate(13),
    create = s.scene.createEmbeddedDocuments;
  s.scene.createEmbeddedDocuments = async (...args: any[]) => {
    const made = [...(await create(...args))];
    s.tokens.contents[0] = { ...made[0] };
    return made;
  };
  await expect(task27NativeState(s.input)).rejects.toThrow('exact native children');
  const other = setupCreate(13),
    nativeCreate = other.scene.createEmbeddedDocuments;
  other.scene.createEmbeddedDocuments = async (...args: any[]) => {
    const made = await nativeCreate(...args);
    other.raw.active = true;
    return made;
  };
  await expect(task27NativeState(other.input)).rejects.toThrow('Token creation side effect');
});

it('accepts only the three exact empty linked delta representations across native lazy preparation', async () => {
  for (const shape of ['null', 'id', 'full']) {
    const s = setupCreate(13),
      create = s.scene.createEmbeddedDocuments;
    s.scene.createEmbeddedDocuments = async (...args: any[]) => {
      const made = await create(...args);
      for (const t of made) {
        const delta = shape === 'null' ? null : shape === 'id' ? { _id: t.id } : t._source.delta;
        t._source.delta = delta;
        s.raw.tokens.find((r: any) => r._id === t.id).delta = structuredClone(delta);
      }
      return made;
    };
    await task27NativeState(s.input);
    for (const t of s.tokens.contents) {
      const delta = {
        _id: t.id,
        system: {},
        flags: {},
        name: null,
        type: null,
        img: null,
        items: [],
        effects: [],
        ownership: null,
      };
      t._source.delta = delta;
      s.raw.tokens.find((r: any) => r._id === t.id).delta = structuredClone(delta);
    }
    await expect(task27NativeState({ ...s.input, op: 'facts' })).resolves.toHaveProperty(
      'actor.name',
    );
  }
});
it.each(['nonempty', 'unknown', 'foreign-id'])(
  'retains %s delta drift in the complete Scene pin',
  async (kind) => {
    const s = setupCreate(13);
    await task27NativeState(s.input);
    const delta = s.raw.tokens[0].delta;
    if (kind === 'nonempty') delta.system = { injected: true };
    if (kind === 'unknown') delta.extra = null;
    if (kind === 'foreign-id') delta._id = 'other';
    await expect(task27NativeState({ ...s.input, op: 'facts' })).rejects.toThrow('identity/source');
  },
);

it('keeps the full fixture pinned through native view preparation and the two approved Actor renames', async () => {
  const s = setupCreate(13);
  await task27NativeState(s.input);
  for (const t of s.tokens.contents) {
    t._source.delta = { _id: t.id };
    s.raw.tokens.find((r: any) => r._id === t.id).delta = { _id: t.id };
  }
  s.actor.update = vi.fn(async (patch: any) => {
    s.actor.name = patch.name;
    for (const t of s.tokens.contents) {
      const delta = {
        _id: t.id,
        system: {},
        flags: {},
        name: null,
        type: null,
        img: null,
        items: [],
        effects: [],
        ownership: null,
      };
      t._source.delta = delta;
      s.raw.tokens.find((r: any) => r._id === t.id).delta = structuredClone(delta);
    }
  });
  await expect(
    task27NativeState({ ...s.input, op: 'update', phase: 'coalesce' }),
  ).resolves.toMatchObject({ name: s.input.plan.actorNames[1] });
  expect(s.actor.update).toHaveBeenCalledTimes(2);
});
