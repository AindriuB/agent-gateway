/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CharacterBuildChange } from '@agent-gateway/protocol';
import { pf2eBuildHook } from '../../../src/adapters/pf2e/build.js';
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
beforeEach(() => {
  (globalThis as any).CONFIG = { PF2E: { skills: { acrobatics: {}, athletics: {} } } };
  resetEvents();
  actor = pf2eActor();
});

describe('build hook registry', () => {
  it('selects pf2e and falls back to unsupported', () => {
    expect(selectBuildHook('pf2e')).toBe(pf2eBuildHook);
    expect(selectBuildHook('dnd5e')).toBe(genericBuildHook);
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
    for (const doc of [actor, actor.ancestry, actor.background, actor.class, actor.feat])
      expect(doc.update).toHaveBeenCalledWith(expect.any(Object), callOptions);
    expect(actor.ancestry.lastPatch).toEqual({ 'system.boosts.0.selected': 'str' });
    expect(actor.class.lastPatch).toEqual({ 'system.keyAbility.selected': 'dex' });
    expect(actor.feat.lastPatch).toEqual({ 'system.location': 'class-1', 'system.level.taken': 1 });
    expect(actor.lastPatch).toEqual({
      'system.build.attributes.boosts.5': ['con'],
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
      actor.items = [...actor.itemList, item('granted', 'feat', {}, actor)];
    });
    const r: any = await apply([{ kind: 'key_attribute', attribute: 'dex' }]);
    expect(r.message).toMatch(/1 added, 0 removed/);
    expect(r.message).toMatch(/not undoable/);
  });
});
