/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { characterBuildOutput } from '@agent-gateway/protocol';
import { dnd5eEmbedHook } from '../../../src/adapters/dnd5e/embed.js';
import { dnd5eBuildHook } from '../../../src/adapters/dnd5e/build.js';
import { embedHookFor } from '../../../src/adapters/embed.js';
import { selectBuildHook } from '../../../src/adapters/build.js';
import { AdapterUnsupportedError } from '../../../src/adapters/types.js';

const listeners = new Map<number, [string, (...a: any[]) => void]>();
let hookId = 0;
const update = vi.fn(async () => {});
const snapshot = vi.fn(async () => {});
const callOptions = { agentGateway: { callId: 'call1' } };
const ctx = { callOptions, snapshot, intendCreate: vi.fn(), created: vi.fn() } as any;
const actor = (): any => ({
  uuid: 'Actor.a',
  type: 'character',
  items: [],
  update,
  toObject: () => ({ system: { skills: { acr: { value: 0 }, ath: { value: 1 } } } }),
  system: { skills: { acr: { value: 0 }, ath: { value: 1 }, ins: { value: 0.5 } } },
});
const input = (source: any, overrides: any = {}, extra: any = {}) =>
  ({ systemId: 'dnd5e', actor: { system: {} }, entry: {}, source, overrides, ...extra }) as any;

beforeEach(() => {
  vi.clearAllMocks();
  listeners.clear();
  (globalThis as any).Hooks = {
    on: (name: string, fn: any) => (listeners.set(++hookId, [name, fn]), hookId),
    off: (_n: string, id: number) => listeners.delete(id),
  };
  (globalThis as any).CONFIG = { DND5E: { skills: { acr: {}, ath: {}, ins: {} } } };
});

describe('dnd5e embed hook', () => {
  it('is registered', () => expect(embedHookFor('dnd5e')).toBe(dnd5eEmbedHook));
  it('passes a physical item and applies quantity and equipped', () => {
    const src = { type: 'weapon', name: 'Sword', system: { equipped: false, quantity: 1 } };
    const out: any = dnd5eEmbedHook.prepare(input(src, { quantity: 3, equipped: true }));
    expect(out.system).toMatchObject({ quantity: 3, equipped: true });
  });
  it('refuses overrides that do not fit, choices, slots and unknown types', () => {
    const feat = { type: 'feat', system: {} };
    expect(() => dnd5eEmbedHook.prepare(input(feat, { quantity: 2 }))).toThrow();
    expect(() => dnd5eEmbedHook.prepare(input(feat, { slot: 'x' }))).toThrow();
    expect(() =>
      dnd5eEmbedHook.prepare(input(feat, {}, { choices: [{ flag: 'a', value: 'b' }] })),
    ).toThrow();
    expect(() => dnd5eEmbedHook.prepare(input({ type: 'facility', system: {} }))).toThrow();
    expect(() =>
      dnd5eEmbedHook.prepare(input({ type: 'loot', system: {} }, { equipped: true })),
    ).toThrow();
  });
  it('refuses non-physical items on a group and oversized sources', () => {
    const group = { system: { isGroup: true } };
    expect(() =>
      dnd5eEmbedHook.prepare(input({ type: 'feat', system: {} }, {}, { actor: group })),
    ).toThrow();
    const big = {
      type: 'feat',
      system: {
        activities: Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`k${i}`, {}])),
      },
    };
    expect(() => dnd5eEmbedHook.prepare(input(big))).toThrow();
  });
  it('notes that advancements were not applied, with fixed text only', () => {
    const cls = {
      type: 'class',
      name: '<img src=x onerror=alert(1)>',
      system: { advancement: [{}] },
    };
    const note = dnd5eEmbedHook.note!(cls);
    expect(note).toContain('NOT applied');
    expect(note).not.toContain('<img');
    expect(dnd5eEmbedHook.note!({ type: 'weapon', system: {} })).toBeUndefined();
    expect(dnd5eEmbedHook.note!({ type: 'class', system: { advancement: [] } })).toBeUndefined();
  });
  it('counts uncorrelated writes and always unhooks', () => {
    const a = actor();
    const watch = dnd5eEmbedHook.observe!(a);
    const fire = (n: string, ...args: unknown[]) =>
      [...listeners.values()].filter(([x]) => x === n).forEach(([, f]) => f(...args));
    fire('updateActor', a, {}, {});
    fire('updateActor', a, {}, callOptions);
    fire('updateItem', { parent: a }, {}, {});
    expect(watch.finish()).toBe(2);
    expect(listeners.size).toBe(0);
  });
});

describe('dnd5e build hook', () => {
  it('is registered', () => expect(selectBuildHook('dnd5e')).toBe(dnd5eBuildHook));
  it('describes skill ranks, omitting half proficiency, within the output schema', () => {
    const out: any = dnd5eBuildHook.describe(actor());
    expect(out.skills).toEqual([
      { skill: 'acr', rank: 0 },
      { skill: 'ath', rank: 1 },
    ]);
    expect(out.message).toContain('half proficiency');
    expect(characterBuildOutput.safeParse({ ...out, systemId: 'dnd5e' }).success).toBe(true);
    expect(dnd5eBuildHook.describe({ type: 'npc' })).toMatchObject({ supported: false });
  });
  it('applies a validated batch in one correlated update after snapshotting', async () => {
    const a = actor();
    await dnd5eBuildHook.apply(
      a,
      [
        { kind: 'skill_rank', skill: 'acr', rank: 2 },
        { kind: 'skill_rank', skill: 'ath', rank: 0 },
      ],
      ctx,
    );
    expect(snapshot).toHaveBeenCalledWith('Actor.a');
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(
      { 'system.skills.acr.value': 2, 'system.skills.ath.value': 0 },
      { agentGateway: { callId: 'call1' } },
    );
  });
  it('refuses the whole batch before any write when one change is bad', async () => {
    const bad: any[][] = [
      [{ kind: 'skill_rank', skill: 'acr', rank: 3 }],
      [{ kind: 'skill_rank', skill: 'nope', rank: 1 }],
      [{ kind: 'skill_rank', skill: 'acr' }],
      [
        { kind: 'skill_rank', skill: 'acr', rank: 1 },
        { kind: 'skill_rank', skill: 'acr', rank: 2 },
      ],
      [
        { kind: 'skill_rank', skill: 'acr', rank: 1 },
        { kind: 'attribute_boost', source: 'level', level: 4, attribute: 'str' },
      ],
      [{ kind: 'key_attribute', attribute: 'str' }],
      [{ kind: 'feat_slot', slot: 's', itemUuid: 'x' }],
    ];
    for (const changes of bad)
      await expect(dnd5eBuildHook.apply(actor(), changes, ctx)).rejects.toBeDefined();
    expect(snapshot).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
  it('refuses an overlapping build on the same Actor and releases afterwards', async () => {
    const a = actor();
    let release!: () => void;
    update.mockImplementationOnce(() => new Promise<void>((r) => (release = r)));
    const first = dnd5eBuildHook.apply(a, [{ kind: 'skill_rank', skill: 'acr', rank: 1 }], ctx);
    await vi.waitFor(() => expect(update).toHaveBeenCalled());
    await expect(
      dnd5eBuildHook.apply(a, [{ kind: 'skill_rank', skill: 'acr', rank: 2 }], ctx),
    ).rejects.toBeDefined();
    release();
    await first;
    await expect(
      dnd5eBuildHook.apply(a, [{ kind: 'skill_rank', skill: 'acr', rank: 2 }], ctx),
    ).resolves.toBeDefined();
  });
  it('refuses non-characters and lists unapplied advancements', async () => {
    await expect(dnd5eBuildHook.apply({ type: 'npc' }, [], ctx)).rejects.toBeInstanceOf(
      AdapterUnsupportedError,
    );
    const r = await dnd5eBuildHook.listChoices!(
      { type: 'class', system: { advancement: [{}, {}] } },
      'u',
    );
    expect(r.choices).toEqual([]);
    expect(r.message).toContain('2 advancement');
  });
});
