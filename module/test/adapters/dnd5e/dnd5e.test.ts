/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dnd5eAdapter } from '../../../src/adapters/dnd5e/index.js';
import { selectAdapter } from '../../../src/adapters/index.js';
import type { AdapterExecutionContext } from '../../../src/adapters/types.js';
import { adapterContract } from '../contract.js';

const chatCreate = vi.fn();
const toggle = vi.fn();
const use = vi.fn();
const rollAttack = vi.fn();
const rollDamage = vi.fn();
const coll = (rows: any[]) =>
  Object.assign(rows, { get: (id: string) => rows.find((r) => r.id === id) });
const act = (id: string, name: string, type = 'attack') => ({
  id,
  name,
  type,
  use,
  rollAttack,
  rollDamage,
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
    method: 'spell',
    canPrepare: true,
    prepared: 1,
    activities: coll([act('a2', 'Fireball', 'save')]),
  },
};
const unprepared: any = {
  ...fireball,
  id: 's3',
  name: 'Wish',
  system: { ...fireball.system, prepared: 0 },
};
const rage: any = {
  id: 'f1',
  uuid: 'Actor.a.Item.f1',
  name: 'Rage',
  type: 'feat',
  system: { uses: { value: 2, max: 3 }, activities: coll([act('a3', 'Rage', 'utility')]) },
};
const ring: any = {
  id: 'r1',
  uuid: 'Actor.a.Item.r1',
  name: 'Ring',
  type: 'equipment',
  system: { quantity: 1, equipped: true, attuned: true, attunement: 'required' },
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
  system: {
    attributes: {
      hp: { value: 30, max: 40, temp: 2 },
      ac: { value: 18 },
      prof: 3,
      movement: { speeds: { walk: 30 }, units: 'ft' },
      encumbrance: { value: 40, thresholds: { maximum: 150 } },
      attunement: { value: 1, max: 3 },
    },
    details: { level: 5 },
    abilities: { str: { value: 16, mod: 3 }, dex: { value: 10, mod: 0 } },
    spells: { spell3: { value: 2, max: 3, level: 3, type: 'spell' } },
    currency: { gp: 12 },
  },
};
const hooks = new Map<string, (...a: any[]) => void>();
(globalThis as any).Hooks = {
  on: (name: string, fn: any) => (hooks.set(name, fn), name),
  off: (name: string) => hooks.delete(name),
};
(globalThis as any).CONFIG = {
  DND5E: { conditionTypes: { poisoned: {}, exhaustion: { levels: 6 } } },
  statusEffects: {
    poisoned: { id: 'poisoned', name: 'Poisoned' },
    exhaustion: { id: 'exhaustion', name: 'Exhaustion' },
    dead: { id: 'dead', name: 'Dead' },
  },
};
(globalThis as any).ChatMessage = { create: chatCreate };
const callOptions = { agentGateway: { callId: 'call1' } };
const intendCreate = vi.fn(async () => {});
const created = vi.fn(async () => {});
const snapshot = vi.fn(async () => {});
const ctx = { intendCreate, created, snapshot, callOptions } as unknown as AdapterExecutionContext;

adapterContract(dnd5eAdapter, { actor, actorUuid: 'Actor.a', systemId: 'dnd5e' });

describe('dnd5e adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hooks.clear();
    poisoned.statuses = new Set(['poisoned']);
    actor.statuses = new Set(['poisoned']);
    actor.effects = [poisoned];
  });
  it('is registered', () => expect(selectAdapter('dnd5e')).toBe(dnd5eAdapter));
  it('summarises HP, AC, level, ability mods and speed', async () => {
    const out: any = await dnd5eAdapter.actorSummary(actor);
    const a = Object.fromEntries(out.attributes.map((x: any) => [x.key, x.value]));
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
      'use:w1:a1',
      'attack:w1:a1',
      'damage:w1:a1',
      'use:s1:a2',
      'damage:s1:a2',
      'use:f1:a3',
    ]);
    expect(actions.find((x: any) => x.id === 'use:s1:a2')).toMatchObject({
      group: 'Level 3 spells',
      uses: '2/3 slots',
    });
    expect(actions.find((x: any) => x.id === 'use:f1:a3')).toMatchObject({
      group: 'Features',
      uses: '2/3 uses',
    });
  });
  it('uses an activity headlessly and creates the card with callOptions', async () => {
    use.mockResolvedValue({ message: { type: 'usage' } });
    chatCreate.mockResolvedValue({ uuid: 'ChatMessage.m' });
    const r: any = await dnd5eAdapter.performAction(actor, 'use:s1:a2', { level: 3 }, ctx);
    expect(use).toHaveBeenCalledWith(
      {
        subsequentActions: false,
        create: { measuredTemplate: false, summons: false },
        spell: { slot: 'spell3' },
      },
      { configure: false },
      { create: false },
    );
    expect(chatCreate).toHaveBeenCalledWith({ type: 'usage' }, { ...callOptions });
    expect(created).toHaveBeenCalledWith('ChatMessage.m');
    expect(snapshot).toHaveBeenCalledWith('Actor.a.Item.s1');
    expect(r.completed).toBe(true);
  });
  it('rolls an attack without a dialog and posts the captured message with callOptions', async () => {
    rollAttack.mockImplementation(async (_c: any, _d: any, m: any) => {
      const config = { data: { type: 'attack' }, create: m.create };
      hooks.get('dnd5e.preRollV2')?.({ subject: sword.system.activities[0] }, {}, config);
      return [{ total: 17 }];
    });
    chatCreate.mockResolvedValue({ uuid: 'ChatMessage.r' });
    const r: any = await dnd5eAdapter.performAction(actor, 'attack:w1:a1', {}, ctx);
    expect(rollAttack).toHaveBeenCalledWith({}, { configure: false }, { create: false });
    expect(chatCreate).toHaveBeenCalledWith({ type: 'attack' }, { ...callOptions });
    expect(r.message).toContain('total 17');
    expect(hooks.size).toBe(0);
  });
  it('rejects unknown ids and a slot below the spell level', async () => {
    await expect(dnd5eAdapter.performAction(actor, 'use:zz:a2', {}, ctx)).rejects.toBeDefined();
    await expect(
      dnd5eAdapter.performAction(actor, 'use:s1:a2', { level: 2 }, ctx),
    ).rejects.toBeDefined();
    await expect(dnd5eAdapter.performAction(actor, 'attack:s1:a2', {}, ctx)).rejects.toBeDefined();
    expect(use).not.toHaveBeenCalled();
  });
  it('reports a thrown use without hiding the spend', async () => {
    use.mockRejectedValue(new Error('boom'));
    const r = (await dnd5eAdapter.performAction(actor, 'use:f1:a3', {}, ctx)) as any;
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
    expect(inv.totals[0]).toMatchObject({ key: 'weight', value: '40/150' });
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
  it('moves leveled conditions by a level delta', async () => {
    actor.statuses = new Set(['exhaustion']);
    actor.effects = [
      { uuid: 'Actor.a.ActiveEffect.x', statuses: new Set(['exhaustion']), system: { level: 2 } },
    ];
    await dnd5eAdapter.conditions(actor, { id: 'exhaustion', active: true, value: 4 }, ctx);
    expect(toggle).toHaveBeenCalledWith('exhaustion', { levels: 2 });
    toggle.mockClear();
    await dnd5eAdapter.conditions(actor, { id: 'exhaustion', active: false }, ctx);
    expect(toggle).toHaveBeenCalledWith('exhaustion', { levels: -2 });
    await expect(
      dnd5eAdapter.conditions(actor, { id: 'poisoned', active: true, value: 2 }, ctx),
    ).rejects.toBeDefined();
  });

  describe('headless safety', () => {
    const withActs = (acts: any[]) => {
      const it: any = {
        id: 'x1',
        uuid: 'Actor.a.Item.x1',
        name: 'Thing',
        type: 'feat',
        system: { activities: coll(acts) },
      };
      return { ...actor, items: coll([it]), concentration: undefined } as any;
    };
    const base = (id: string, type: string, extra: any = {}) => ({
      id,
      name: 'Thing',
      type,
      use,
      ...extra,
    });
    it('refuses cast and order, and transform that opens a compendium browser', async () => {
      for (const [type, extra] of [
        ['cast', {}],
        ['order', {}],
        ['transform', { transform: { mode: 'cr' } }],
        ['mystery', {}],
      ] as const) {
        const a = withActs([base('q1', type, extra)]);
        expect(((await dnd5eAdapter.listActions(a)) as any).actions).toEqual([]);
        await expect(dnd5eAdapter.performAction(a, 'use:x1:q1', {}, ctx)).rejects.toBeDefined();
      }
      expect(use).not.toHaveBeenCalled();
    });
    it('allows form and empty-mode transform, and neutralises summons', async () => {
      use.mockResolvedValue({ message: { type: 'usage' } });
      chatCreate.mockResolvedValue({ uuid: 'ChatMessage.m' });
      for (const mode of ['form', '']) {
        const a = withActs([base('q1', 'transform', { transform: { mode } })]);
        await dnd5eAdapter.performAction(a, 'use:x1:q1', {}, ctx);
      }
      await dnd5eAdapter.performAction(withActs([base('q2', 'summon')]), 'use:x1:q2', {}, ctx);
      expect(use).toHaveBeenCalledTimes(3);
      expect(use.mock.calls[2]![0].create).toEqual({ measuredTemplate: false, summons: false });
    });
    it('checks the target of a forward activity', async () => {
      const cast = base('c1', 'cast');
      const ok = base('u1', 'utility');
      const a = withActs([
        cast,
        ok,
        base('f1', 'forward', { activity: { id: 'c1' } }),
        base('f2', 'forward', { activity: { id: 'u1' } }),
      ]);
      await expect(dnd5eAdapter.performAction(a, 'use:x1:f1', {}, ctx)).rejects.toBeDefined();
      use.mockResolvedValue({ message: { type: 'usage' } });
      chatCreate.mockResolvedValue({ uuid: 'ChatMessage.m' });
      await expect(dnd5eAdapter.performAction(a, 'use:x1:f2', {}, ctx)).resolves.toBeDefined();
    });
    const conc = (name: string, activityId: string) => ({
      uuid: 'Actor.a.ActiveEffect.c1',
      name: 'Concentrating',
      flags: { dnd5e: { item: { id: 'zz', data: { name, _id: activityId } } } },
    });
    const spellWithConc = () => {
      const a = withActs([base('q1', 'utility', { requiresConcentration: true })]);
      a.system = {
        ...actor.system,
        attributes: { ...actor.system.attributes, concentration: { limit: 1 } },
      };
      return a;
    };
    it('refuses to end a different concentration, naming it escaped', async () => {
      const a = spellWithConc();
      a.concentration = { effects: new Set([conc('<b>Hold</b>', 'other')]) };
      const err: any = await dnd5eAdapter.performAction(a, 'use:x1:q1', {}, ctx).catch((e) => e);
      expect(String(err.message ?? JSON.stringify(err))).toContain('&#60;b&#62;Hold');
      expect(use).not.toHaveBeenCalled();
    });
    it('snapshots and discloses replacing its own concentration', async () => {
      const a = spellWithConc();
      a.concentration = { effects: new Set([conc('Bless', 'q1')]) };
      use.mockResolvedValue({ message: { type: 'usage' } });
      chatCreate.mockResolvedValue({ uuid: 'ChatMessage.m' });
      const r: any = await dnd5eAdapter.performAction(a, 'use:x1:q1', {}, ctx);
      expect(snapshot).toHaveBeenCalledWith('Actor.a.ActiveEffect.c1');
      expect(r.message).toContain('concentration on Bless ended');
    });
    it('serialises roll actions per actor so captures cannot cross', async () => {
      const order: string[] = [];
      let release!: () => void;
      rollAttack.mockImplementationOnce(async (_c: any, _d: any, m: any) => {
        order.push('a:start');
        hooks.get('dnd5e.preRollV2')?.(
          { subject: sword.system.activities[0] },
          {},
          { data: { n: 'A' }, create: m.create },
        );
        await new Promise<void>((r) => (release = r));
        order.push('a:end');
        return [{ total: 1 }];
      });
      rollAttack.mockImplementationOnce(async (_c: any, _d: any, m: any) => {
        order.push('b:start');
        hooks.get('dnd5e.preRollV2')?.(
          { subject: sword.system.activities[0] },
          {},
          { data: { n: 'B' }, create: m.create },
        );
        return [{ total: 2 }];
      });
      chatCreate.mockResolvedValue({ uuid: 'ChatMessage.r' });
      const first = dnd5eAdapter.performAction(actor, 'attack:w1:a1', {}, ctx);
      const second = dnd5eAdapter.performAction(actor, 'attack:w1:a1', {}, ctx);
      await vi.waitFor(() => expect(order).toEqual(['a:start']));
      await new Promise((r) => setTimeout(r, 10));
      expect(order).toEqual(['a:start']);
      release();
      await Promise.all([first, second]);
      expect(order).toEqual(['a:start', 'a:end', 'b:start']);
      expect(chatCreate.mock.calls.map((c) => c[0].n)).toEqual(['A', 'B']);
      expect(hooks.size).toBe(0);
    });
  });
});
