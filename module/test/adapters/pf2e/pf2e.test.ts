/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pf2eAdapter } from '../../../src/adapters/pf2e/index.js';
import { selectAdapter } from '../../../src/adapters/index.js';
import type { AdapterExecutionContext } from '../../../src/adapters/types.js';
import { adapterContract } from '../contract.js';

const roll = vi.fn();
const cast = vi.fn();
const consume = vi.fn();
const toMessage = vi.fn();
const spellMessage = vi.fn();
const spell: any = {
  id: 's1',
  uuid: 'Actor.a.Item.s1',
  toMessage: spellMessage,
  name: 'Fireball',
  rank: 3,
  baseRank: 3,
  system: { location: { value: 'e1' }, time: { value: '2' } },
};
const cantrip = {
  id: 's2',
  toMessage: spellMessage,
  name: 'Light',
  rank: 1,
  isCantrip: true,
  system: { location: { value: 'e1' }, time: { value: '2' } },
};
const frightened = {
  id: 'c1',
  slug: 'frightened',
  name: 'Frightened',
  active: true,
  value: 2,
  system: { value: { value: 2 } },
};
const actor: any = {
  id: 'act1',
  name: 'Valeros',
  img: 'icons/v.webp',
  type: 'character',
  level: 5,
  perception: { mod: 10 },
  saves: { fortitude: { mod: 11 }, reflex: { mod: 9 }, will: { mod: 7 } },
  system: {
    attributes: { hp: { value: 50, max: 62, temp: 5 }, ac: { value: 24 } },
    perception: { slug: 'perception', value: 10, totalModifier: 10, dc: 20, rank: 1 },
    movement: { speeds: { land: { value: 25 } } },
    resources: { heroPoints: { value: 1, max: 3 } },
    actions: [
      {
        type: 'strike',
        slug: 'longsword',
        label: 'Longsword',
        item: { id: 'w1', uuid: 'Actor.a.Item.w1', name: 'Longsword', isMelee: true },
        variants: [
          { label: '+14', roll },
          { label: 'MAP -5 (+9)', roll },
          { label: 'MAP -10 (+4)', roll },
        ],
      },
    ],
  },
  itemTypes: {
    action: [
      { id: 'a1', name: 'Shield Block', actionCost: { type: 'reaction', value: null }, toMessage },
      { id: 'a2', name: 'Power Attack', actionCost: { type: 'action', value: 2 }, toMessage },
      { id: 'a3', name: 'Toughness', actionCost: null, toMessage },
    ],
    spell: [spell, cantrip],
    condition: [
      frightened,
      {
        id: 'c2',
        slug: 'off-guard',
        name: 'Off-Guard',
        active: true,
        system: { value: { value: null } },
      },
    ],
  },
  items: { get: (id: string) => (id === 'e1' ? { id: 'e1', cast, consume } : undefined) },
  inventory: Object.assign(
    [
      {
        uuid: 'Actor.a.Item.i1',
        name: 'Rope',
        type: 'equipment',
        quantity: 2,
        isEquipped: false,
        isInvested: null,
        system: { quantity: 2, bulk: { value: 0.1 }, equipped: { carryType: 'worn' } },
      },
      {
        uuid: 'Actor.a.Item.i2',
        name: 'Cloak',
        type: 'equipment',
        quantity: 1,
        isEquipped: true,
        isInvested: true,
        system: {
          quantity: 1,
          bulk: { value: 1 },
          equipped: { carryType: 'worn', invested: true },
        },
      },
    ],
    { bulk: { value: { normal: 1, light: 2 }, encumberedAfter: 8, max: 13 } },
  ),
  increaseCondition: vi.fn(),
  decreaseCondition: vi.fn(),
};
const updateConditionValue = vi.fn();
const intendCreate = vi.fn(async () => {});
const created = vi.fn(async () => {});
const ctx = { intendCreate, created } as unknown as AdapterExecutionContext;
let createHooks: ((m: any) => void)[] = [];
beforeEach(() => {
  vi.clearAllMocks();
  createHooks = [];
  consume.mockResolvedValue(true);
  spellMessage.mockResolvedValue({ uuid: 'ChatMessage.spell' });
  toMessage.mockResolvedValue({ uuid: 'ChatMessage.action' });
  roll.mockImplementation(async (p: any) => {
    p.callback?.({}, 'success', { id: 'm1', uuid: 'ChatMessage.m1' }, p.event);
    return { total: 15 };
  });
  (globalThis as any).Hooks = {
    on: (_n: string, h: (m: any) => void) => createHooks.push(h),
    off: vi.fn(),
  };
  (globalThis as any).game = {
    user: { id: 'u1' },
    pf2e: {
      ConditionManager: {
        getCondition: (s: string) =>
          ['frightened', 'off-guard', 'sickened'].includes(s) ? {} : null,
        updateConditionValue,
      },
    },
  };
});

adapterContract(pf2eAdapter, { actor, actorUuid: 'Actor.a', systemId: 'pf2e' });

describe('pf2e adapter', () => {
  it('is selected for pf2e only', () => {
    expect(selectAdapter('pf2e')).toBe(pf2eAdapter);
    expect(selectAdapter('dnd5e')).not.toBe(pf2eAdapter);
  });
  it('summarises core statistics', () => {
    const map = Object.fromEntries(
      pf2eAdapter.actorSummary(actor) &&
        (pf2eAdapter.actorSummary(actor) as any).attributes.map((a: any) => [a.key, a.value]),
    );
    expect(map).toMatchObject({
      hp: '50/62 (+5 temp)',
      ac: '24',
      level: '5',
      fortitude: '+11',
      reflex: '+9',
      will: '+7',
      perception: '+10',
      speed: '25 ft',
      heroPoints: '1/3',
    });
  });
  it('lists strikes with MAP variants, costed actions and spells by rank', async () => {
    const { actions } = (await pf2eAdapter.listActions(actor)) as any;
    expect(actions.filter((a: any) => a.group === 'Strikes')).toHaveLength(3);
    expect(actions.find((a: any) => a.name === 'Shield Block').cost).toBe('reaction');
    expect(actions.find((a: any) => a.name === 'Power Attack').cost).toBe('2 actions');
    expect(actions.find((a: any) => a.name === 'Toughness')).toBeUndefined();
    expect(actions.find((a: any) => a.name === 'Fireball').group).toBe('Rank 3 spells');
    expect(actions.find((a: any) => a.name === 'Light').group).toBe('Cantrips');
  });
  it('performs through native strike, action and spell APIs', async () => {
    await pf2eAdapter.performAction(actor, 'strike:w1:longsword:1', {}, ctx);
    expect(roll).toHaveBeenCalledTimes(1);
    await pf2eAdapter.performAction(actor, 'action:a2', {}, ctx);
    expect(toMessage).toHaveBeenCalledTimes(1);
    await pf2eAdapter.performAction(actor, 'spell:e1:s1', { rank: 4 }, ctx);
    expect(consume).toHaveBeenCalledWith(spell, 4);
    expect(spellMessage).toHaveBeenCalledWith(null, { actualCast: true, data: { castRank: 4 } });
    expect(cast).not.toHaveBeenCalled();
  });
  it('reports a strike that pf2e did not roll as not completed', async () => {
    roll.mockResolvedValueOnce(null);
    const r = (await pf2eAdapter.performAction(actor, 'strike:w1:longsword:0', {}, ctx)) as any;
    expect(r.completed).toBe(false);
  });
  it('rejects unknown ids and bad ranks without side effects', async () => {
    await expect(pf2eAdapter.performAction(actor, 'strike:x:y:0', {}, ctx)).rejects.toThrow();
    await expect(
      pf2eAdapter.performAction(actor, 'spell:e1:s1', { rank: 99 }, ctx),
    ).rejects.toThrow();
    await expect(pf2eAdapter.performAction(actor, 'nope', {}, ctx)).rejects.toThrow();
    await expect(
      pf2eAdapter.performAction(actor, 'spell:e1:s1', { rank: 2 }, ctx),
    ).rejects.toThrow();
    await expect(pf2eAdapter.performAction(actor, 'spell:other:s1', {}, ctx)).rejects.toThrow();
    expect(cast).not.toHaveBeenCalled();
    expect(consume).not.toHaveBeenCalled();
  });
  it('declares and records created chat messages', async () => {
    await pf2eAdapter.performAction(actor, 'strike:w1:longsword:0', {}, ctx);
    expect(intendCreate).toHaveBeenCalledTimes(1);
    expect(created).toHaveBeenCalledWith('ChatMessage.m1');
  });
  it('records only the messages returned by action and spell calls', async () => {
    await pf2eAdapter.performAction(actor, 'action:a2', {}, ctx);
    expect(created).toHaveBeenCalledWith('ChatMessage.action');
    await pf2eAdapter.performAction(actor, 'spell:e1:s1', {}, ctx);
    expect(created).toHaveBeenCalledWith('ChatMessage.spell');
    expect(createHooks).toHaveLength(0);
  });
  it('asks for a rank when the native consume reports no slot given', async () => {
    consume.mockRejectedValue(new Error('Slot not given'));
    await expect(pf2eAdapter.performAction(actor, 'spell:e1:s1', {}, ctx)).rejects.toThrow(/rank/);
    consume.mockRejectedValue(new Error('No spell slots left'));
    await expect(pf2eAdapter.performAction(actor, 'spell:e1:s1', {}, ctx)).rejects.toThrow(
      /No spell slots left/,
    );
  });
  it('records only the message handed to each of two concurrent same-weapon strikes', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let n = 0;
    roll.mockImplementation(async (p: any) => {
      const mine = `ChatMessage.mine${++n}`;
      await gate;
      p.callback({}, 'success', { id: `id${n}`, uuid: mine }, p.event);
      return { total: 15 };
    });
    const mk = () => {
      const c = vi.fn(async () => {});
      return {
        c,
        context: {
          intendCreate: vi.fn(async () => {}),
          created: c,
        } as unknown as AdapterExecutionContext,
      };
    };
    const one = mk();
    const two = mk();
    const first = pf2eAdapter.performAction(actor, 'strike:w1:longsword:0', {}, one.context);
    await new Promise((r) => setTimeout(r, 0));
    const second = pf2eAdapter.performAction(actor, 'strike:w1:longsword:0', {}, two.context);
    await new Promise((r) => setTimeout(r, 0));
    release();
    await Promise.all([first, second]);
    expect(one.c.mock.calls.map((x: any[]) => x[0])).toEqual(['ChatMessage.mine1']);
    expect(two.c.mock.calls.map((x: any[]) => x[0])).toEqual(['ChatMessage.mine2']);
    expect(createHooks).toHaveLength(0);
  });
  it('says an unaudited strike cannot be undone when the callback never fires', async () => {
    roll.mockImplementation(async () => ({ total: 15 }));
    const r = (await pf2eAdapter.performAction(actor, 'strike:w1:longsword:0', {}, ctx)) as any;
    expect(r.completed).toBe(true);
    expect(r.message).toMatch(/not audited and cannot be undone/);
    expect(created).not.toHaveBeenCalled();
  });
  it('ignores a callback message without an id (cancelled create)', async () => {
    roll.mockImplementation(async (p: any) => {
      p.callback({}, 'success', { uuid: 'ChatMessage.ghost' }, p.event);
      return { total: 15 };
    });
    const r = (await pf2eAdapter.performAction(actor, 'strike:w1:longsword:0', {}, ctx)) as any;
    expect(created).not.toHaveBeenCalled();
    expect(r.message).toMatch(/No attack message was created/);
    expect(r.message).not.toMatch(/posted/);
  });
  it.each([true, false])(
    'never opens a check dialog when showCheckDialogs is %s',
    async (setting) => {
      (globalThis as any).game.user.settings = { showCheckDialogs: setting };
      let skipDialog: boolean | undefined;
      // Mirrors pf2e's eventToRollParams (pf2e.mjs:13768-13773) as applied by Check.roll.
      roll.mockImplementation(async (p: any) => {
        const r = !setting;
        skipDialog = p.event.shiftKey ? !r : r;
      });
      await pf2eAdapter.performAction(actor, 'strike:w1:longsword:2', {}, ctx);
      expect(skipDialog).toBe(true);
    },
  );
  it('says the slot was spent when the cast throws after consumption', async () => {
    spellMessage.mockRejectedValueOnce(new Error('boom'));
    await expect(pf2eAdapter.performAction(actor, 'spell:e1:s1', {}, ctx)).rejects.toThrow(
      /after its slot or focus point was spent/,
    );
  });
  it('reports a failed spell consumption as not completed', async () => {
    consume.mockResolvedValue(false);
    const r = (await pf2eAdapter.performAction(actor, 'spell:e1:s1', {}, ctx)) as any;
    expect(r.completed).toBe(false);
    expect(spellMessage).not.toHaveBeenCalled();
  });
  it('rejects persistent damage changes', async () => {
    await expect(
      pf2eAdapter.conditions(actor, { id: 'persistent-damage', active: true }),
    ).rejects.toThrow();
  });
  it('reports bulk, equipped and invested state', async () => {
    const r = (await pf2eAdapter.inventorySemantics(actor)) as any;
    expect(r.items[0]).toMatchObject({ weight: 'L', equipped: false, quantity: 2 });
    expect(r.items[1]).toMatchObject({ weight: '1', equipped: true, invested: true });
    expect(r.totals.find((t: any) => t.key === 'bulk').value).toBe('1 + 2L');
  });
  it('reads valued conditions', async () => {
    const r = (await pf2eAdapter.conditions(actor)) as any;
    expect(r.conditions).toEqual([
      { id: 'frightened', name: 'Frightened', value: 2 },
      { id: 'off-guard', name: 'Off-Guard' },
    ]);
  });
  it('changes conditions through the system condition API', async () => {
    await pf2eAdapter.conditions(actor, { id: 'sickened', active: true, value: 3 });
    expect(actor.increaseCondition).toHaveBeenCalledWith('sickened', { value: 3 });
    await pf2eAdapter.conditions(actor, { id: 'frightened', active: true, value: 1 });
    expect(updateConditionValue).toHaveBeenCalledWith('c1', actor, 1);
    await pf2eAdapter.conditions(actor, { id: 'frightened', active: false });
    expect(actor.decreaseCondition).toHaveBeenCalledWith('frightened', { forceRemove: true });
    await expect(pf2eAdapter.conditions(actor, { id: 'bogus', active: true })).rejects.toThrow();
  });
});
