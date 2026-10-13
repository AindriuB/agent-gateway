/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dnd5eAdapter } from '../../../src/adapters/dnd5e/index.js';
import { selectAdapter } from '../../../src/adapters/index.js';
import type { AdapterExecutionContext } from '../../../src/adapters/types.js';
import { adapterContract } from '../contract.js';

const chatCreate = vi.fn();
const toggle = vi.fn();
const actorUpdate = vi.fn();
const use = vi.fn();
const coll = (rows: any[]) =>
  Object.assign(rows, { get: (id: string) => rows.find((r) => r.id === id) });
const act = (id: string, name: string) => ({
  id,
  name,
  type: 'attack',
  use,
  activation: { type: 'action' },
});
const sword: any = {
  id: 'w1',
  uuid: 'Actor.a.Item.w1',
  name: 'Longsword',
  type: 'weapon',
  system: {
    equipped: true,
    quantity: 1,
    weight: { value: 3, units: 'lb' },
    activities: coll([act('a1', 'Longsword')]),
  },
};
const fireball: any = {
  id: 's1',
  uuid: 'Actor.a.Item.s1',
  name: 'Fireball',
  type: 'spell',
  system: {
    level: 3,
    preparation: { mode: 'prepared', prepared: true },
    activities: coll([act('a2', 'Fireball')]),
  },
};
const unprepared: any = {
  ...fireball,
  id: 's3',
  name: 'Wish',
  system: { ...fireball.system, preparation: { mode: 'prepared', prepared: false } },
};
const rage: any = {
  id: 'f1',
  uuid: 'Actor.a.Item.f1',
  name: 'Rage',
  type: 'feat',
  system: { uses: { value: 2, max: 3 }, activities: coll([act('a3', 'Rage')]) },
};
const ring: any = {
  id: 'r1',
  uuid: 'Actor.a.Item.r1',
  name: 'Ring',
  type: 'equipment',
  system: { quantity: 1, equipped: true, attuned: true },
};
const poisoned = { uuid: 'Actor.a.ActiveEffect.e1', statuses: new Set(['poisoned']) };
const actor: any = {
  id: 'a',
  uuid: 'Actor.a',
  name: 'Seelah',
  img: 'i.webp',
  type: 'character',
  statuses: new Set(['poisoned']),
  effects: [poisoned],
  items: coll([sword, fireball, unprepared, rage, ring]),
  toggleStatusEffect: toggle,
  update: actorUpdate,
  system: {
    attributes: {
      hp: { value: 30, max: 40, temp: 2 },
      ac: { value: 18 },
      prof: 3,
      movement: { walk: 30, units: 'ft' },
      encumbrance: { value: 40, max: 150 },
      exhaustion: 0,
    },
    details: { level: 5 },
    abilities: { str: { value: 16, mod: 3 }, dex: { value: 10, mod: 0 } },
    spells: { spell3: { value: 2, max: 3 } },
    currency: { gp: 12 },
  },
};
(globalThis as any).game = { i18n: { localize: (s: string) => s } };
(globalThis as any).CONFIG = {
  DND5E: { conditionTypes: { poisoned: {}, exhaustion: {} } },
  statusEffects: [
    { id: 'poisoned', name: 'Poisoned' },
    { id: 'exhaustion', name: 'Exhaustion' },
    { id: 'dead', name: 'Dead' },
  ],
};
(globalThis as any).ChatMessage = { create: chatCreate };
const callOptions = { agentGateway: { callId: 'call1' } };
const intendCreate = vi.fn(async () => {});
const created = vi.fn(async () => {});
const snapshot = vi.fn(async () => {});
const ctx = { intendCreate, created, snapshot, callOptions } as unknown as AdapterExecutionContext;

adapterContract(dnd5eAdapter, { actor, actorUuid: 'Actor.a', systemId: 'dnd5e' });

describe('dnd5e adapter', () => {
  beforeEach(() => vi.clearAllMocks());
  it('is registered', () => expect(selectAdapter('dnd5e')).toBe(dnd5eAdapter));
  it('summarises HP, AC, level, ability mods and speed', () => {
    const a = Object.fromEntries(
      dnd5eAdapter.actorSummary(actor) instanceof Promise
        ? []
        : (dnd5eAdapter.actorSummary(actor) as any).attributes.map((x: any) => [x.key, x.value]),
    );
    expect(a).toMatchObject({
      hp: '30/40 (+2 temp)',
      ac: '18',
      level: '5',
      str: '+3 (16)',
      speed: '30 ft',
    });
  });
  it('lists weapons, spells by level with slots, features with uses; skips unprepared', async () => {
    const { actions } = (await dnd5eAdapter.listActions(actor)) as any;
    expect(actions.map((x: any) => x.id)).toEqual([
      'activity:w1:a1',
      'activity:s1:a2',
      'activity:f1:a3',
    ]);
    expect(actions[1]).toMatchObject({ group: 'Level 3 spells', uses: '2/3 slots' });
    expect(actions[2]).toMatchObject({ group: 'Features', uses: '2/3 uses' });
  });
  it('performs through Activity#use and creates the message with callOptions', async () => {
    use.mockResolvedValue({ message: { toObject: () => ({ content: 'x' }) } });
    chatCreate.mockResolvedValue({ uuid: 'ChatMessage.m' });
    const r = await dnd5eAdapter.performAction(actor, 'activity:s1:a2', { level: 4 }, ctx);
    expect(use).toHaveBeenCalledWith(
      { spell: { slot: 'spell4' } },
      { configure: false },
      { create: false },
    );
    expect(chatCreate).toHaveBeenCalledWith({ content: 'x' }, { ...callOptions });
    expect(created).toHaveBeenCalledWith('ChatMessage.m');
    expect(snapshot).toHaveBeenCalledWith('Actor.a.Item.s1');
    expect((r as any).completed).toBe(true);
  });
  it('rejects unknown ids and a slot below the spell level', async () => {
    await expect(
      dnd5eAdapter.performAction(actor, 'activity:zz:a2', {}, ctx),
    ).rejects.toBeDefined();
    await expect(
      dnd5eAdapter.performAction(actor, 'activity:s1:a2', { level: 2 }, ctx),
    ).rejects.toBeDefined();
    expect(use).not.toHaveBeenCalled();
  });
  it('reports a thrown use without hiding the spend', async () => {
    use.mockRejectedValue(new Error('boom'));
    const r = (await dnd5eAdapter.performAction(actor, 'activity:f1:a3', {}, ctx)) as any;
    expect(r.completed).toBe(false);
    expect(r.message).toContain('cannot be undone');
  });
  it('reports attunement and weight in the inventory', async () => {
    const inv = (await dnd5eAdapter.inventorySemantics(actor)) as any;
    expect(inv.items.find((i: any) => i.name === 'Ring')).toMatchObject({
      equipped: true,
      invested: true,
    });
    expect(inv.items.find((i: any) => i.name === 'Longsword').weight).toBe('3 lb');
  });
  it('reads conditions and toggles through toggleStatusEffect', async () => {
    expect(((await dnd5eAdapter.conditions(actor)) as any).conditions).toEqual([
      { id: 'poisoned', name: 'Poisoned' },
    ]);
    await dnd5eAdapter.conditions(actor, { id: 'poisoned', active: false }, ctx);
    expect(snapshot).toHaveBeenCalledWith('Actor.a.ActiveEffect.e1');
    expect(toggle).toHaveBeenCalledWith('poisoned', { active: false });
    await expect(
      dnd5eAdapter.conditions(actor, { id: 'dead', active: true }, ctx),
    ).rejects.toBeDefined();
  });
  it('sets exhaustion with callOptions', async () => {
    await dnd5eAdapter.conditions(actor, { id: 'exhaustion', active: true, value: 2 }, ctx);
    expect(actorUpdate).toHaveBeenCalledWith(
      { 'system.attributes.exhaustion': 2 },
      { ...callOptions },
    );
  });
});
