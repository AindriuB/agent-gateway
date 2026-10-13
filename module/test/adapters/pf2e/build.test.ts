/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CharacterBuildChange } from '@agent-gateway/protocol';
import { characterBuild } from '@agent-gateway/protocol';
import { boundedAdapterData } from '../../../src/tools/_adapters.js';
import {
  BUILD_LOCK_MAX_WAITING,
  BUILD_LOCK_WAIT_MS,
  pendingBuildLocks,
  pf2eBuildHook,
} from '../../../src/adapters/pf2e/build.js';
import { selectBuildHook } from '../../../src/adapters/build.js';
import { genericBuildHook } from '../../../src/adapters/generic/build.js';
import { AdapterUnsupportedError } from '../../../src/adapters/types.js';
import { events, pf2eActor, resetEvents, item } from '../../tools/character-build/fixtures.js';

let actor: any;
const callOptions = { agentGateway: { callId: 'call-1' } };
const context = () =>
  ({
    user: {},
    callOptions,
    snapshot: vi.fn(async (uuid: string) => void events.push(`snapshot:${uuid}`)),
    intendCreate: vi.fn(),
    created: vi.fn(),
  }) as any;
const apply = (changes: CharacterBuildChange[], ctx = context()) =>
  pf2eBuildHook.apply(actor, changes, ctx);
const listeners = new Map<number, [string, (...a: any[]) => void]>();
let hookId = 0;
const fire = (name: string, ...args: unknown[]) =>
  [...listeners.values()].filter(([n]) => n === name).forEach(([, fn]) => fn(...args));
beforeEach(() => {
  listeners.clear();
  (globalThis as any).Hooks = {
    on: (name: string, fn: (...a: any[]) => void) => (listeners.set(++hookId, [name, fn]), hookId),
    off: (_name: string, id: number) => listeners.delete(id),
  };
  (globalThis as any).CONFIG = { PF2E: { skills: { acrobatics: {}, athletics: {} } } };
  resetEvents();
  actor = pf2eActor();
});

describe('build hook registry', () => {
  it('selects pf2e and falls back to unsupported', () => {
    expect(selectBuildHook('pf2e')).toBe(pf2eBuildHook);
    expect(selectBuildHook('starfinder')).toBe(genericBuildHook);
    expect(genericBuildHook.describe({})).toMatchObject({ supported: false });
    expect(() => genericBuildHook.apply({}, [], context())).toThrow(AdapterUnsupportedError);
  });
});

describe('pf2e describe', () => {
  it('reports boosts, key attribute, skills and feat slots', () => {
    const r: any = pf2eBuildHook.describe(actor);
    expect(r.supported).toBe(true);
    expect(r.boosts).toContainEqual({ source: 'level', level: 1, attribute: 'str' });
    expect(r.boosts).toContainEqual({
      source: 'ancestry',
      slot: '0',
      allowed: ['str', 'dex'],
    });
    expect(r.keyAttribute).toEqual({ allowed: ['str', 'dex'] });
    expect(r.skills).toContainEqual({ skill: 'acrobatics', rank: 1 });
    expect(r.featSlots).toContainEqual({ group: 'class', slot: 'class-1', level: 1 });
    expect(r.featSlots).toContainEqual({
      group: 'class',
      slot: 'class-2',
      level: 2,
      itemUuid: 'Actor.a.Item.other',
      itemName: 'Taken',
    });
  });
  it('is unsupported for non-characters', () => {
    expect(pf2eBuildHook.describe({ type: 'npc' })).toMatchObject({ supported: false });
  });
});

describe('pf2e validation refuses before any write', () => {
  const boost = (o: Partial<CharacterBuildChange>): CharacterBuildChange => ({
    kind: 'attribute_boost',
    ...o,
  });
  it.each([
    [
      'attribute not allowed in the slot',
      [boost({ source: 'ancestry', slot: '0', attribute: 'wis' })],
    ],
    [
      'duplicate within a source',
      [
        boost({ source: 'ancestry', slot: '0', attribute: 'str' }),
        boost({ source: 'ancestry', slot: '2', attribute: 'str' }),
      ],
    ],
    ['duplicate within a level', [boost({ source: 'level', level: 1, attribute: 'str' })]],
    [
      'level boost above the Actor level',
      [boost({ source: 'level', level: 10, attribute: 'dex' })],
    ],
    ['level boost not at 1/5/10/15/20', [boost({ source: 'level', level: 3, attribute: 'dex' })]],
    [
      'more than 4 boosts in one level',
      ['str', 'dex', 'con', 'int', 'wis'].map((attribute) =>
        boost({ source: 'level', level: 5, attribute }),
      ),
    ],
    ['unknown skill', [{ kind: 'skill_rank', skill: 'nonsense', rank: 1 }]],
    ['skill rank above the level-7 cap', [{ kind: 'skill_rank', skill: 'athletics', rank: 4 }]],
    [
      'feat not embedded in the Actor',
      [{ kind: 'feat_slot', slot: 'class-1', itemUuid: 'Actor.z.Item.f' }],
    ],
    ['non-feat item', [{ kind: 'feat_slot', slot: 'class-1', itemUuid: 'Actor.a.Item.cls' }]],
    ['unknown slot', [{ kind: 'feat_slot', slot: 'nope', itemUuid: 'Actor.a.Item.feat1' }]],
    ['occupied slot', [{ kind: 'feat_slot', slot: 'class-2', itemUuid: 'Actor.a.Item.feat1' }]],
    ['key attribute not allowed', [{ kind: 'key_attribute', attribute: 'wis' }]],
    ['unknown boost slot', [boost({ source: 'ancestry', slot: '__proto__', attribute: 'str' })]],
  ] as [string, CharacterBuildChange[]][])('%s', async (_name, changes) => {
    const ctx = context();
    await expect(apply(changes, ctx)).rejects.toMatchObject({ code: 'INVALID_ARGS' });
    expect(ctx.snapshot).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });
  it('a later invalid change aborts the whole batch with no write', async () => {
    const ctx = context();
    await expect(
      apply(
        [
          { kind: 'skill_rank', skill: 'athletics', rank: 2 },
          { kind: 'skill_rank', skill: 'nonsense', rank: 1 },
        ],
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_ARGS' });
    expect(events).toEqual([]);
  });
  it('accepts an untrained core skill absent from the sparse source data', async () => {
    expect(actor._source.system.skills.athletics).toBeUndefined();
    await apply([{ kind: 'skill_rank', skill: 'athletics', rank: 1 }]);
    expect(actor.lastPatch).toEqual({ 'system.skills.athletics.rank': 1 });
  });
  it('rejects a lore skill present in the prepared skills, with no write', async () => {
    actor.system.skills['esoteric-lore'] = { rank: 1, lore: true, itemId: 'lore1' };
    const ctx = context();
    await expect(
      apply([{ kind: 'skill_rank', skill: 'esoteric-lore', rank: 2 }], ctx),
    ).rejects.toMatchObject({ code: 'INVALID_ARGS' });
    expect(ctx.snapshot).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });
  it('rejects a feat whose category the slot group does not accept, with no write', async () => {
    actor.feats[0].isFeatValid = () => false;
    const ctx = context();
    await expect(
      apply([{ kind: 'feat_slot', slot: 'class-1', itemUuid: 'Actor.a.Item.feat1' }], ctx),
    ).rejects.toMatchObject({ code: 'INVALID_ARGS', message: 'This feat cannot fill that slot' });
    expect(events).toEqual([]);
  });
  it('allows rank 3 at level 7 and rank 4 at level 15', async () => {
    await apply([{ kind: 'skill_rank', skill: 'athletics', rank: 3 }]);
    actor = pf2eActor(15);
    await apply([{ kind: 'skill_rank', skill: 'athletics', rank: 4 }]);
  });
});

describe('pf2e apply', () => {
  const all: CharacterBuildChange[] = [
    { kind: 'attribute_boost', source: 'ancestry', slot: '0', attribute: 'str' },
    { kind: 'attribute_boost', source: 'background', slot: '1', attribute: 'int' },
    { kind: 'key_attribute', attribute: 'dex' },
    { kind: 'attribute_boost', source: 'level', level: 5, attribute: 'con' },
    { kind: 'skill_rank', skill: 'athletics', rank: 2 },
    { kind: 'feat_slot', slot: 'class-1', itemUuid: 'Actor.a.Item.feat1' },
  ];
  it('snapshots every target before the first write and tags every update with callId', async () => {
    const result: any = await apply(all);
    const firstUpdate = events.findIndex((e) => e.startsWith('update:'));
    expect(events.slice(0, firstUpdate).every((e) => e.startsWith('snapshot:'))).toBe(true);
    expect(events.filter((e) => e.startsWith('snapshot:')).sort()).toEqual(
      [
        'snapshot:Actor.a',
        'snapshot:Actor.a.Item.anc',
        'snapshot:Actor.a.Item.bg',
        'snapshot:Actor.a.Item.cls',
        'snapshot:Actor.a.Item.feat1',
      ].sort(),
    );
    expect(events.filter((e) => e.startsWith('update:'))).toHaveLength(5);
    for (const doc of [actor, actor.ancestry, actor.background, actor.class, actor.feat]) {
      expect(doc.update).toHaveBeenCalledTimes(1);
      expect(doc.lastOptions).toEqual({ agentGateway: { callId: 'call-1' } });
    }
    expect(actor.ancestry.lastPatch).toEqual({ 'system.boosts.0.selected': 'str' });
    expect(actor.class.lastPatch).toEqual({ 'system.keyAbility.selected': 'dex' });
    expect(actor.feat.lastPatch).toEqual({ 'system.location': 'class-1', 'system.level.taken': 1 });
    expect(actor.lastPatch).toEqual({
      'system.build': { attributes: { boosts: { 5: ['con'] } } },
      'system.skills.athletics.rank': 2,
    });
    expect(result.supported).toBe(true);
    expect(result.message).toBeUndefined();
  });
  it('writes the key attribute to the Actor in manual mode', async () => {
    actor.system.build.attributes.manual = true;
    await apply([{ kind: 'key_attribute', attribute: 'wis' }]);
    expect(actor.lastPatch).toEqual({ 'system.details.keyability.value': 'wis' });
    expect(actor.class.update).not.toHaveBeenCalled();
  });
  it('discloses uncorrelated native Item changes only when they happen', async () => {
    const plain: any = await apply([{ kind: 'skill_rank', skill: 'athletics', rank: 1 }]);
    expect(plain.message).toBeUndefined();
    actor.class.update = vi.fn(async () => {
      fire('createItem', item('granted', 'feat', {}, actor), {}, 'u');
    });
    const r: any = await apply([{ kind: 'key_attribute', attribute: 'dex' }]);
    expect(r.message).toMatch(/1 added, 0 updated, 0 removed/);
    expect(r.message).toMatch(/not undoable here.*concurrent writes by others/);
  });
});

describe('post-write result is always reportable', () => {
  const passes = (r: unknown) =>
    characterBuild.output.parse({
      ...(boundedAdapterData(r) as object),
      actorUuid: 'Actor.a',
      systemId: 'pf2e',
    });
  it('a full real-shaped result passes bounding and the output schema', async () => {
    actor.system.skills = Object.fromEntries(
      ['acrobatics', 'arcana', 'athletics', 'crafting', 'deception', 'diplomacy'].map((k) => [
        k,
        { rank: 1, lore: false, label: 'x'.repeat(300), modifiers: [{ a: 1 }] },
      ]),
    );
    passes(await apply([{ kind: 'key_attribute', attribute: 'dex' }]));
  });
  it('reports a failed update instead of throwing, keeping the other writes', async () => {
    actor.update = vi.fn(async () => {
      throw new Error('x'.repeat(5000));
    });
    const r: any = await apply([
      { kind: 'key_attribute', attribute: 'dex' },
      { kind: 'skill_rank', skill: 'athletics', rank: 1 },
    ]);
    expect(actor.class.update).toHaveBeenCalled();
    expect(r.message).toMatch(/Update of Hero failed/);
    expect(r.message.length).toBeLessThanOrEqual(2000);
    passes(r);
  });
  it('drops malformed fields rather than losing the result', async () => {
    actor.system.skills = { athletics: { rank: 2 }, bad: { rank: 9 } };
    actor.feats[0].slots['class-1'].level = 'one';
    actor.feats[0].slots['class-3'] = { id: 'class-3', level: 3, feat: { uuid: {}, name: 5 } };
    actor.class.system.keyAbility.selected = { weird: true };
    const r: any = await apply([{ kind: 'skill_rank', skill: 'athletics', rank: 1 }]);
    passes(r);
    passes(pf2eBuildHook.describe(actor));
  });
  it('replaces a field that cannot satisfy the schema with an empty list and says so', async () => {
    actor.system.build.attributes.boosts[1] = ['str'];
    const huge = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`s${i}`, { rank: 1 }]));
    actor.system.skills = huge;
    const r: any = await apply([{ kind: 'key_attribute', attribute: 'dex' }]);
    expect(r.skills.length).toBeLessThanOrEqual(128);
    passes(r);
  });
});

describe('item and actor updates in one batch', () => {
  it('lands both when item updates mutate the options they are handed', async () => {
    const r: any = await apply([
      { kind: 'key_attribute', attribute: 'dex' },
      { kind: 'attribute_boost', source: 'level', level: 5, attribute: 'con' },
      { kind: 'skill_rank', skill: 'athletics', rank: 2 },
    ]);
    expect(r.message).toBeUndefined();
    expect(actor.class.lastPatch).toEqual({ 'system.keyAbility.selected': 'dex' });
    expect(actor.lastPatch['system.skills.athletics.rank']).toBe(2);
    expect(actor.lastPatch['system.build']).toBeDefined();
    expect(actor.lastOptions).toEqual({ agentGateway: { callId: 'call-1' } });
    expect(callOptions).toEqual({ agentGateway: { callId: 'call-1' } });
  });
});

describe('update failures', () => {
  it('throws, carrying the first failure, when every update fails', async () => {
    actor.class.update = vi.fn(async () => {
      throw new Error('boom');
    });
    await expect(apply([{ kind: 'key_attribute', attribute: 'dex' }])).rejects.toMatchObject({
      code: 'INVALID_ARGS',
      message: expect.stringMatching(/No build change was written\..*boom/),
    });
  });
  it('leads the message with failures on a partial failure', async () => {
    actor.update = vi.fn(async () => {
      throw new Error('actor boom');
    });
    actor.ancestry.update = vi.fn(async () => {
      fire('deleteItem', item('gone', 'feat', {}, actor), {}, 'u');
    });
    const r: any = await apply([
      { kind: 'attribute_boost', source: 'ancestry', slot: '0', attribute: 'str' },
      { kind: 'skill_rank', skill: 'athletics', rank: 1 },
    ]);
    expect(r.message.startsWith('Update of Hero failed: actor boom')).toBe(true);
    expect(r.message).toMatch(/1 removed/);
  });
});

describe('uncorrelated native Item writes', () => {
  const run = () => apply([{ kind: 'key_attribute', attribute: 'dex' }]);
  it('discloses an uncorrelated updateItem on an existing Item', async () => {
    actor.class.update = vi.fn(async () => {
      fire('updateItem', actor.feat, { flags: {} }, {}, 'u');
    });
    const r: any = await run();
    expect(r.message).toMatch(/0 added, 1 updated, 0 removed/);
    expect(r.message).toMatch(/not undoable here.*concurrent writes by others/);
  });
  it('does not disclose a correlated update, or another Actor\u2019s Item', async () => {
    actor.class.update = vi.fn(async () => {
      fire('updateItem', actor.feat, {}, { agentGateway: { callId: 'call-1' } }, 'u');
      fire('updateItem', item('x', 'feat', {}, {}), {}, {}, 'u');
    });
    expect(((await run()) as any).message).toBeUndefined();
  });
  it('removes its listeners after the call, including on throw', async () => {
    await run();
    expect(listeners.size).toBe(0);
    actor.class.update = vi.fn(async () => {
      throw new Error('boom');
    });
    await expect(run()).rejects.toBeDefined();
    expect(listeners.size).toBe(0);
  });
});

describe('aggregate result budget', () => {
  const crowd = (n: number) => {
    const slots: Record<string, any> = {};
    for (let i = 0; i < n; i++)
      slots[`class-${i}`] = {
        id: `class-${i}`,
        level: (i % 20) + 1,
        feat: {
          uuid: `Actor.aaaaaaaaaaaaaaaa.Item.${String(i).padStart(16, 'x')}`,
          name: 'N'.repeat(200),
        },
      };
    actor.feats = [{ id: 'class', slotted: true, slots, isFeatValid: () => true }];
  };
  const wire = (r: unknown) =>
    characterBuild.output.parse({
      ...(boundedAdapterData(r) as object),
      actorUuid: 'Actor.a',
      systemId: 'pf2e',
    });
  it('trims an oversize state on both the write and describe paths', async () => {
    crowd(80);
    const written: any = await apply([{ kind: 'skill_rank', skill: 'athletics', rank: 1 }]);
    const read: any = pf2eBuildHook.describe(actor);
    for (const r of [written, read]) {
      wire(r);
      expect(new TextEncoder().encode(JSON.stringify(r)).length).toBeLessThanOrEqual(65536);
      expect(r.message).toMatch(/truncated/);
      expect(r.featSlots.length).toBeGreaterThan(0);
    }
    expect(written.featSlots.every((f: any) => f.itemName === undefined)).toBe(true);
  });
  it('does not trim a normal build', async () => {
    const r: any = await apply([{ kind: 'skill_rank', skill: 'athletics', rank: 1 }]);
    expect(r.message).toBeUndefined();
    expect(r.featSlots.find((f: any) => f.itemName)).toBeDefined();
  });
});

describe('concurrent builds on one Actor', () => {
  let source: any;
  const live = () => {
    source = { build: { attributes: { boosts: { 1: [], 5: [] } } }, skills: {} };
    actor.toObject = () => ({ system: structuredClone(source) });
    actor.update = vi.fn(async (patch: any) => {
      await new Promise((r) => setTimeout(r, 5));
      if (patch['system.build']) {
        source.build = structuredClone(patch['system.build']);
        actor.system.build.attributes.boosts = structuredClone(
          patch['system.build'].attributes.boosts,
        );
      }
    });
  };
  const level5 = (attribute: string) =>
    apply([{ kind: 'attribute_boost', source: 'level', level: 5, attribute }]);
  it('serialises overlapping calls so both level-5 boosts land', async () => {
    live();
    await Promise.all([level5('str'), level5('dex')]);
    expect(source.build.attributes.boosts[5]).toEqual(['str', 'dex']);
  });
  it('releases the lock after a throw', async () => {
    live();
    await expect(apply([{ kind: 'skill_rank', skill: 'nonsense', rank: 1 }])).rejects.toBeDefined();
    actor.class.update = vi.fn(async () => {
      throw new Error('boom');
    });
    await expect(apply([{ kind: 'key_attribute', attribute: 'dex' }])).rejects.toBeDefined();
    await level5('con');
    expect(source.build.attributes.boosts[5]).toEqual(['con']);
  });
  it('rejects, listing earlier writes, when system.build changed since the plan', async () => {
    live();
    const ctx = context();
    ctx.snapshot = vi.fn(async () => {
      source.build.attributes.boosts[5] = ['wis'];
    });
    await expect(
      apply(
        [
          { kind: 'key_attribute', attribute: 'dex' },
          { kind: 'attribute_boost', source: 'level', level: 5, attribute: 'str' },
        ],
        ctx,
      ),
    ).rejects.toMatchObject({
      code: 'INVALID_ARGS',
      message: expect.stringMatching(/changed during this call; read it again and retry/),
    });
    expect(actor.class.update).not.toHaveBeenCalled();
    expect(actor.update).not.toHaveBeenCalled();
  });
  it('lists Item updates already applied when the build changes after them', async () => {
    live();
    actor.class.update = vi.fn(async () => {
      source.build.attributes.boosts[5] = ['wis'];
    });
    await expect(
      apply([
        { kind: 'key_attribute', attribute: 'dex' },
        { kind: 'attribute_boost', source: 'level', level: 5, attribute: 'str' },
      ]),
    ).rejects.toMatchObject({ message: expect.stringMatching(/Already applied: cls/) });
    expect(actor.update).not.toHaveBeenCalled();
  });
});

describe('lock timeout', () => {
  afterEach(() => vi.useRealTimers());
  it('refuses a waiter without running it, and later calls get the lock after the holder ends', async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    actor.class.update = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const holder = apply([{ kind: 'key_attribute', attribute: 'dex' }]);
    await vi.advanceTimersByTimeAsync(0);
    const waiter = apply([{ kind: 'skill_rank', skill: 'athletics', rank: 1 }]);
    const refused = expect(waiter).rejects.toMatchObject({
      code: 'INVALID_ARGS',
      message: expect.stringMatching(/Another build is still running/),
    });
    const queued = expect(
      apply([{ kind: 'skill_rank', skill: 'athletics', rank: 2 }]),
    ).rejects.toMatchObject({ code: 'INVALID_ARGS' });
    await vi.advanceTimersByTimeAsync(BUILD_LOCK_WAIT_MS + 1);
    await refused;
    await queued;
    expect(actor.update).not.toHaveBeenCalled();
    finish();
    await holder;
    expect(actor.update).not.toHaveBeenCalled();
    await apply([{ kind: 'skill_rank', skill: 'athletics', rank: 2 }]);
    expect(actor.update).toHaveBeenCalledTimes(1);
  });
});

describe('lock chain after the last waiter times out', () => {
  afterEach(() => vi.useRealTimers());
  it('keeps the holder registered so a retry waits for it', async () => {
    vi.useFakeTimers();
    const order: string[] = [];
    let finish!: () => void;
    actor.class.update = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          order.push('holder:start');
          finish = () => {
            order.push('holder:end');
            resolve();
          };
        }),
    );
    actor.update = vi.fn(async () => void order.push('retry:write'));
    const holder = apply([{ kind: 'key_attribute', attribute: 'dex' }]);
    await vi.advanceTimersByTimeAsync(0);
    const a = expect(
      apply([{ kind: 'skill_rank', skill: 'athletics', rank: 1 }]),
    ).rejects.toMatchObject({ message: expect.stringMatching(/Another build is still running/) });
    await vi.advanceTimersByTimeAsync(BUILD_LOCK_WAIT_MS + 1);
    await a;
    await vi.advanceTimersByTimeAsync(0);
    expect(pendingBuildLocks()).toBe(1);
    const b = apply([{ kind: 'skill_rank', skill: 'athletics', rank: 2 }]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(order).toEqual(['holder:start']);
    finish();
    await holder;
    await b;
    expect(order).toEqual(['holder:start', 'holder:end', 'retry:write']);
    await vi.advanceTimersByTimeAsync(0);
    expect(pendingBuildLocks()).toBe(0);
  });
});

describe('wedged holder', () => {
  afterEach(() => vi.useRealTimers());
  it('bounds the queue and refuses extra callers immediately', async () => {
    vi.useFakeTimers();
    actor.uuid = 'Actor.wedged'; // its holder never settles, so keep it off the shared key
    actor.class.update = vi.fn(() => new Promise<void>(() => {}));
    void apply([{ kind: 'key_attribute', attribute: 'dex' }]);
    await vi.advanceTimersByTimeAsync(0);
    const change: CharacterBuildChange = { kind: 'skill_rank', skill: 'athletics', rank: 1 };
    const queued = Array.from({ length: BUILD_LOCK_MAX_WAITING }, () =>
      expect(apply([change])).rejects.toMatchObject({ code: 'INVALID_ARGS' }),
    );
    for (let i = 0; i < 10; i++)
      await expect(apply([change])).rejects.toMatchObject({
        message: expect.stringMatching(/Another build is still running/),
      });
    expect(pendingBuildLocks()).toBe(1);
    await vi.advanceTimersByTimeAsync(BUILD_LOCK_WAIT_MS + 1);
    await Promise.all(queued);
    for (let i = 0; i < 10; i++) {
      const retry = expect(apply([change])).rejects.toMatchObject({ code: 'INVALID_ARGS' });
      await vi.advanceTimersByTimeAsync(BUILD_LOCK_WAIT_MS + 1);
      await retry;
    }
    expect(pendingBuildLocks()).toBe(1);
  });
});

describe('staleness covers everything the plan read', () => {
  it('rejects an item-only batch whose target slot is filled during the snapshots', async () => {
    const ctx = context();
    ctx.snapshot = vi.fn(async () => {
      const other = item('rival', 'feat', { location: 'class-1' }, actor);
      actor.items = [...actor.itemList, other];
    });
    await expect(
      apply([{ kind: 'feat_slot', slot: 'class-1', itemUuid: 'Actor.a.Item.feat1' }], ctx),
    ).rejects.toMatchObject({
      code: 'INVALID_ARGS',
      message: expect.stringMatching(/changed during this call/),
    });
    expect(actor.feat.update).not.toHaveBeenCalled();
  });
  it('rejects a rank-3 write when the level drops during the snapshots', async () => {
    const source = { details: { level: { value: 7 } } };
    actor.toObject = () => ({ system: structuredClone(source) });
    const ctx = context();
    ctx.snapshot = vi.fn(async () => {
      source.details.level.value = 5;
    });
    await expect(
      apply([{ kind: 'skill_rank', skill: 'athletics', rank: 3 }], ctx),
    ).rejects.toMatchObject({ message: expect.stringMatching(/changed during this call/) });
    expect(actor.update).not.toHaveBeenCalled();
  });
  it('rejects when a targeted boost slot is selected during the snapshots', async () => {
    const ctx = context();
    ctx.snapshot = vi.fn(async () => {
      actor.ancestry.system.boosts[0].selected = 'dex';
    });
    await expect(
      apply([{ kind: 'attribute_boost', source: 'ancestry', slot: '0', attribute: 'str' }], ctx),
    ).rejects.toMatchObject({ message: expect.stringMatching(/changed during this call/) });
    expect(actor.ancestry.update).not.toHaveBeenCalled();
  });
});

describe('mixed Item and Actor batches', () => {
  it('succeeds and writes both when no rival writes', async () => {
    const r: any = await apply([
      { kind: 'attribute_boost', source: 'background', slot: '0', attribute: 'str' },
      { kind: 'key_attribute', attribute: 'dex' },
      { kind: 'feat_slot', slot: 'class-1', itemUuid: 'Actor.a.Item.feat1' },
      { kind: 'skill_rank', skill: 'athletics', rank: 1 },
    ]);
    expect(r.message).toBeUndefined();
    expect(actor.background.update).toHaveBeenCalled();
    expect(actor.class.update).toHaveBeenCalled();
    expect(actor.feat.update).toHaveBeenCalled();
    expect(actor.update).toHaveBeenCalledWith(
      { 'system.skills.athletics.rank': 1 },
      expect.anything(),
    );
  });
  it('rejects a rival selecting a non-targeted slot of the same background to the same attribute', async () => {
    const ctx = context();
    ctx.snapshot = vi.fn(async () => {
      actor.background.system.boosts[2].selected = 'str';
    });
    await expect(
      apply([{ kind: 'attribute_boost', source: 'background', slot: '0', attribute: 'str' }], ctx),
    ).rejects.toMatchObject({ message: expect.stringMatching(/changed during this call/) });
    expect(actor.background.update).not.toHaveBeenCalled();
  });
});

describe('staleness before every document write', () => {
  it('rejects a later Item when a rival fills its slot during an earlier Item update', async () => {
    const realUpdate = actor.background.update;
    actor.background.update = vi.fn(async (patch: any, options: any) => {
      await realUpdate(patch, options);
      actor.items = [...actor.itemList, item('rival', 'feat', { location: 'class-1' }, actor)];
    });
    await expect(
      apply([
        { kind: 'attribute_boost', source: 'background', slot: '0', attribute: 'str' },
        { kind: 'feat_slot', slot: 'class-1', itemUuid: 'Actor.a.Item.feat1' },
      ]),
    ).rejects.toMatchObject({
      code: 'INVALID_ARGS',
      message: expect.stringMatching(/changed during this call.*Already applied: bg/),
    });
    expect(actor.background.update).toHaveBeenCalledTimes(1);
    expect(actor.feat.update).not.toHaveBeenCalled();
  });
});

describe('level boosts as pf2e stores them', () => {
  it('merges into the source system.build and keeps its other data', async () => {
    // pf2e 8.6.0 prepared data derives boosts from source (pf2e.mjs:35267-35280).
    const source = {
      attributes: { manual: false, boosts: { 1: ['str'], 5: [] }, keyOptions: ['str'] },
      languages: { value: 0 },
    };
    actor.toObject = () => ({ system: { build: source } });
    actor.update = vi.fn(async (patch: any) => {
      const b = patch['system.build'];
      actor.system.build.attributes.boosts = {
        1: b.attributes.boosts[1].slice(0, 4),
        5: b.attributes.boosts[5].slice(0, 4),
        10: [],
        15: [],
        20: [],
        ancestry: [],
        class: null,
      };
    });
    const r: any = await apply([
      { kind: 'attribute_boost', source: 'level', level: 1, attribute: 'dex' },
      { kind: 'attribute_boost', source: 'level', level: 5, attribute: 'wis' },
    ]);
    const sent = actor.update.mock.calls[0][0]['system.build'];
    expect(sent.languages).toEqual({ value: 0 });
    expect(sent.attributes.boosts).toEqual({ 1: ['str', 'dex'], 5: ['wis'] });
    expect(source.attributes.boosts[1]).toEqual(['str']);
    expect(r.boosts).toContainEqual({ source: 'level', level: 1, attribute: 'dex' });
    expect(r.boosts).toContainEqual({ source: 'level', level: 5, attribute: 'wis' });
  });
});
