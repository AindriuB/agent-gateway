/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pf2eAdapter } from '../../../src/adapters/pf2e/index.js';
import { selectAdapter } from '../../../src/adapters/index.js';
import type { AdapterExecutionContext } from '../../../src/adapters/types.js';
import { adapterContract } from '../contract.js';
import { actionPerform } from '@agent-gateway/protocol';
import { boundedAdapterData } from '../../../src/tools/_adapters.js';

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
const unsaved = (uuid: string, extra: Record<string, unknown> = {}) => ({
  toObject: () => ({ marker: uuid, ...extra }),
});
const chatCreate = vi.fn();
const condUpdate = vi.fn();
const frightened = {
  id: 'c1',
  uuid: 'Actor.a.Item.c1',
  update: condUpdate,
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
  items: {
    get: (id: string) =>
      id === 'e1' ? { id: 'e1', uuid: 'Actor.a.Item.e1', cast, consume } : undefined,
  },
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
  createEmbeddedDocuments: vi.fn(),
  deleteEmbeddedDocuments: vi.fn(),
};
const callOptions = { agentGateway: { callId: 'call1' } };
const intendCreate = vi.fn(async () => {});
const created = vi.fn(async () => {});
const snapshot = vi.fn(async () => {});
const ctx = { intendCreate, created, snapshot, callOptions } as unknown as AdapterExecutionContext;
let createHooks: ((m: any) => void)[] = [];
beforeEach(() => {
  vi.clearAllMocks();
  createHooks = [];
  consume.mockResolvedValue(true);
  chatCreate.mockImplementation(async (d: any) => ({
    id: d.marker,
    uuid: `ChatMessage.${d.marker}`,
  }));
  spellMessage.mockResolvedValue(unsaved('spell'));
  toMessage.mockResolvedValue(unsaved('action'));
  roll.mockImplementation(async (p: any) => {
    await p.callback?.({}, 'success', unsaved('m1'), p.event);
    return { total: 15 };
  });
  (globalThis as any).ChatMessage = { create: chatCreate };
  (globalThis as any).Hooks = {
    on: (_n: string, h: (m: any) => void) => createHooks.push(h),
    off: vi.fn(),
  };
  (globalThis as any).game = {
    user: { id: 'u1' },
    pf2e: {
      ConditionManager: {
        getCondition: (s: string) =>
          ['frightened', 'off-guard', 'sickened'].includes(s)
            ? { toObject: () => ({ type: 'condition', system: { value: { value: 1 } } }) }
            : null,
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
    expect(spellMessage).toHaveBeenCalledWith(null, {
      actualCast: true,
      create: false,
      data: { castRank: 4 },
    });
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
    expect(roll.mock.calls[0]![0].createMessage).toBe(false);
    expect(chatCreate).toHaveBeenCalledWith({ marker: 'm1' }, { ...callOptions });
  });
  it('records only the messages returned by action and spell calls', async () => {
    await pf2eAdapter.performAction(actor, 'action:a2', {}, ctx);
    expect(created).toHaveBeenCalledWith('ChatMessage.action');
    expect(toMessage).toHaveBeenCalledWith(undefined, { create: false });
    expect(chatCreate).toHaveBeenCalledWith(
      { marker: 'action' },
      { renderSheet: false, ...callOptions },
    );
    await pf2eAdapter.performAction(actor, 'spell:e1:s1', {}, ctx);
    expect(created).toHaveBeenCalledWith('ChatMessage.spell');
    expect(chatCreate).toHaveBeenCalledWith(
      { marker: 'spell' },
      { renderSheet: false, ...callOptions },
    );
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
      const mine = ++n;
      await gate;
      await p.callback({}, 'success', unsaved(`mine${mine}`), p.event);
      return { total: 15 };
    });
    const mk = () => {
      const c = vi.fn(async () => {});
      return {
        c,
        context: {
          intendCreate: vi.fn(async () => {}),
          snapshot: vi.fn(async () => {}),
          created: c,
          callOptions,
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
  it('says an NPC strike is not audited and cannot be undone, and keeps native creation', async () => {
    roll.mockImplementation(async () => ({ total: 15 }));
    const npc = { ...actor, type: 'npc' };
    const r = (await pf2eAdapter.performAction(npc, 'strike:w1:longsword:0', {}, ctx)) as any;
    expect(r.completed).toBe(true);
    expect(r.message).toMatch(/not audited and cannot be undone/);
    expect(roll.mock.calls[0]![0].createMessage).toBeUndefined();
    expect(roll.mock.calls[0]![0].callback).toBeUndefined();
    expect(created).not.toHaveBeenCalled();
  });
  it('says no message was created when a character strike callback never fires', async () => {
    roll.mockImplementation(async () => ({ total: 15 }));
    const r = (await pf2eAdapter.performAction(actor, 'strike:w1:longsword:0', {}, ctx)) as any;
    expect(r.message).toMatch(/No attack message was created/);
    expect(created).not.toHaveBeenCalled();
  });
  it('records nothing when the creation is cancelled', async () => {
    chatCreate.mockResolvedValue(undefined);
    const r = (await pf2eAdapter.performAction(actor, 'strike:w1:longsword:0', {}, ctx)) as any;
    expect(created).not.toHaveBeenCalled();
    expect(r.message).toMatch(/No attack message was created/);
  });
  it('forwards the message mode of the roll to the created strike message', async () => {
    roll.mockImplementation(async (p: any) => {
      await p.callback(
        {},
        'success',
        { ...unsaved('gm1'), flags: { pf2e: { context: { messageMode: 'gm' } } } },
        p.event,
      );
      return { total: 15 };
    });
    await pf2eAdapter.performAction(actor, 'strike:w1:longsword:0', {}, ctx);
    expect(chatCreate).toHaveBeenCalledWith(
      { marker: 'gm1' },
      { messageMode: 'gm', ...callOptions },
    );
  });
  it('snapshots the consumable weapon and ammunition a character strike spends', async () => {
    const strike = actor.system.actions[0];
    const original = strike.item;
    strike.item = {
      ...original,
      type: 'weapon',
      quantity: 2,
      traits: new Set(['consumable']),
      system: { expend: 1 },
      ammo: { uuid: 'Actor.a.Item.ammo1' },
    };
    try {
      await pf2eAdapter.performAction(actor, 'strike:w1:longsword:0', {}, ctx);
    } finally {
      strike.item = original;
    }
    expect(snapshot.mock.calls.map((c: any[]) => c[0])).toEqual([
      'Actor.a.Item.w1',
      'Actor.a.Item.ammo1',
    ]);
  });
  it('snapshots the owning weapon, not the synthetic subitem, for loaded ammunition', async () => {
    const strike = actor.system.actions[0];
    const original = strike.item;
    const owner = { uuid: 'Actor.a.Item.w1' };
    strike.item = {
      ...original,
      system: { expend: 1 },
      ammo: { uuid: 'Actor.a.Item.w1.Item.mag1', parentItem: owner },
    };
    try {
      await pf2eAdapter.performAction(actor, 'strike:w1:longsword:0', {}, ctx);
    } finally {
      strike.item = original;
    }
    expect(snapshot.mock.calls.map((c: any[]) => c[0])).toEqual(['Actor.a.Item.w1']);
  });
  it('snapshots nothing for a strike that spends no embedded document', async () => {
    await pf2eAdapter.performAction(actor, 'strike:w1:longsword:0', {}, ctx);
    expect(snapshot).not.toHaveBeenCalled();
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
  it('returns the spend disclosure, valid for the tool wrapper, when a cast fails after consumption', async () => {
    spellMessage.mockRejectedValueOnce(new Error('boom'));
    const r = (await pf2eAdapter.performAction(actor, 'spell:e1:s1', {}, ctx)) as any;
    expect(r).toEqual({
      completed: false,
      message: expect.stringMatching(/after its spell slot was spent and cannot be undone: boom/),
    });
    // The same checks invokeAdapter applies to an adapter result.
    const bounded = boundedAdapterData(r) as object;
    expect(
      actionPerform.output.parse({ ...bounded, actorUuid: 'Actor.a', systemId: 'pf2e' }),
    ).toMatchObject({ completed: false });
  });
  it('returns a disclosure when a strike roll throws after ammunition may be spent', async () => {
    const strike = actor.system.actions[0];
    const original = strike.item;
    strike.item = { ...original, system: { expend: 1 }, ammo: { uuid: 'Actor.a.Item.ammo1' } };
    roll.mockRejectedValueOnce(new Error('kaput'));
    let r: any;
    try {
      r = await pf2eAdapter.performAction(actor, 'strike:w1:longsword:0', {}, ctx);
    } finally {
      strike.item = original;
    }
    expect(r.completed).toBe(false);
    expect(r.message).toMatch(/may have been spent and that cannot be undone: kaput/);
    roll.mockRejectedValueOnce(new Error('kaput'));
    await expect(
      pf2eAdapter.performAction(actor, 'strike:w1:longsword:0', {}, ctx),
    ).rejects.toThrow(/kaput/);
  });
  it('neither lists nor performs suppressed actions or feats', async () => {
    const cost = { type: 'action', value: 1 };
    const sup = {
      ...actor,
      itemTypes: {
        ...actor.itemTypes,
        action: [
          { id: 'sa', name: 'Hidden Action', actionCost: cost, suppressed: true, toMessage },
        ],
        feat: [{ id: 'sf', name: 'Hidden Feat', actionCost: cost, suppressed: true, toMessage }],
      },
    };
    const { actions } = (await pf2eAdapter.listActions(sup)) as any;
    expect(actions.some((a: any) => /Hidden/.test(a.name))).toBe(false);
    for (const id of ['action:sa', 'action:sf'])
      await expect(pf2eAdapter.performAction(sup, id, {}, ctx)).rejects.toThrow(/Unknown action/);
    expect(toMessage).not.toHaveBeenCalled();
  });
  it('lists and performs costed feats, and ignores passive ones', async () => {
    const feat = (id: string, name: string, actionCost: unknown) => ({
      id,
      name,
      actionCost,
      toMessage,
    });
    const withFeats = {
      ...actor,
      itemTypes: {
        ...actor.itemTypes,
        feat: [
          feat('f1', 'Reactive Shield', { type: 'reaction', value: null }),
          feat('f2', 'Sudden Charge', { type: 'action', value: 2 }),
          feat('f3', 'Quick Draw', { type: 'free', value: null }),
          feat('f4', 'Toughness', null),
        ],
      },
    };
    const { actions } = (await pf2eAdapter.listActions(withFeats)) as any;
    const byName = (n: string) => actions.find((a: any) => a.name === n);
    expect(byName('Reactive Shield')).toMatchObject({ id: 'action:f1', cost: 'reaction' });
    expect(byName('Sudden Charge').cost).toBe('2 actions');
    expect(byName('Quick Draw').cost).toBe('free action');
    expect(byName('Toughness')).toBeUndefined();
    const r = (await pf2eAdapter.performAction(withFeats, 'action:f2', {}, ctx)) as any;
    expect(r.message).toBe('Performed Sudden Charge');
    expect(toMessage).toHaveBeenCalledWith(undefined, { create: false });
    await expect(pf2eAdapter.performAction(withFeats, 'action:f4', {}, ctx)).rejects.toThrow();
  });
  it('snapshots the spellcasting entry before a slot spell consumes it', async () => {
    const entry = actor.items.get('e1');
    const order: string[] = [];
    snapshot.mockImplementation(async (u: string) => void order.push(`snap:${u}`));
    consume.mockImplementation(async () => void order.push('consume'));
    await pf2eAdapter.performAction(actor, 'spell:e1:s1', { rank: 3 }, ctx);
    expect(entry.uuid).toBe('Actor.a.Item.e1');
    expect(order).toEqual(['snap:Actor.a.Item.e1', 'consume']);
  });
  it('snapshots the spell for innate casting, and nothing for cantrips or focus spells', async () => {
    const entry = { id: 'e1', uuid: 'Actor.a.Item.e1', isInnate: true, consume, cast };
    const innateActor = { ...actor, items: { get: () => entry } };
    await pf2eAdapter.performAction(innateActor, 'spell:e1:s1', { rank: 3 }, ctx);
    expect(snapshot.mock.calls.map((c: any[]) => c[0])).toEqual(['Actor.a.Item.s1']);
    snapshot.mockClear();
    await pf2eAdapter.performAction(actor, 'spell:e1:s2', {}, ctx);
    expect(snapshot).not.toHaveBeenCalled();
    const focus = { ...spell, uuid: 'x', system: { ...spell.system, cast: { focusPoints: 1 } } };
    const focusActor = { ...actor, itemTypes: { ...actor.itemTypes, spell: [focus] } };
    await pf2eAdapter.performAction(focusActor, 'spell:e1:s1', { rank: 3 }, ctx);
    expect(snapshot).not.toHaveBeenCalled();
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
  it('requires the audit context to change a condition', async () => {
    await expect(
      pf2eAdapter.conditions(actor, { id: 'sickened', active: true, value: 3 }),
    ).rejects.toThrow(/Audit context/);
  });
  it('creates a missing condition through increaseCondition', async () => {
    const increase = vi.fn(async () => ({}));
    await pf2eAdapter.conditions(
      { ...actor, increaseCondition: increase },
      { id: 'sickened', active: true, value: 3 },
      ctx,
    );
    expect(increase).toHaveBeenCalledWith('sickened', { value: 3 });
    expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
    expect(intendCreate).not.toHaveBeenCalled();
  });
  it('updates a valued condition natively after snapshotting it', async () => {
    const update = vi.fn(async () => {});
    (globalThis as any).game.pf2e.ConditionManager.updateConditionValue = update;
    await pf2eAdapter.conditions(actor, { id: 'frightened', active: true, value: 1 }, ctx);
    expect(snapshot).toHaveBeenCalledExactlyOnceWith('Actor.a.Item.c1');
    expect(update).toHaveBeenCalledWith('c1', actor, 1);
    expect(condUpdate).not.toHaveBeenCalled();
    expect(intendCreate).not.toHaveBeenCalled();
  });
  it('removes a condition natively, snapshotting it and its cascade-deleted grants', async () => {
    const decrease = vi.fn(async () => {});
    const granted = {
      id: 'g1',
      uuid: 'Actor.a.Item.g1',
      flags: { pf2e: { grantedBy: { id: 'c1', onDelete: 'cascade' }, itemGrants: {} } },
    };
    const kept = {
      id: 'g2',
      uuid: 'Actor.a.Item.g2',
      flags: { pf2e: { grantedBy: { id: 'c1', onDelete: 'detach' }, itemGrants: {} } },
    };
    const cond: any = {
      ...frightened,
      flags: { pf2e: { itemGrants: { a: { id: 'g1' }, b: { id: 'g2' } } } },
    };
    const byId: any = { g1: granted, g2: kept, c1: cond };
    const a2 = {
      ...actor,
      itemTypes: { ...actor.itemTypes, condition: [cond] },
      items: { get: (id: string) => byId[id] },
      decreaseCondition: decrease,
    };
    await pf2eAdapter.conditions(a2, { id: 'frightened', active: false }, ctx);
    expect(snapshot.mock.calls.map((c: any[]) => c[0]).sort()).toEqual([
      'Actor.a.Item.c1',
      'Actor.a.Item.g1',
    ]);
    expect(decrease).toHaveBeenCalledWith('frightened', { forceRemove: true });
    expect(actor.deleteEmbeddedDocuments).not.toHaveBeenCalled();
  });
  it('snapshots only the condition Item when updating its value, even with grants', async () => {
    const update = vi.fn(async () => {});
    (globalThis as any).game.pf2e.ConditionManager.updateConditionValue = update;
    const child = {
      id: 'g1',
      uuid: 'Actor.a.Item.g1',
      flags: { pf2e: { grantedBy: { id: 'c1', onDelete: 'cascade' }, itemGrants: {} } },
    };
    const cond: any = { ...frightened, flags: { pf2e: { itemGrants: { a: { id: 'g1' } } } } };
    const a2 = {
      ...actor,
      itemTypes: { ...actor.itemTypes, condition: [cond] },
      items: { get: (id: string) => ({ g1: child, c1: cond })[id] },
    };
    await pf2eAdapter.conditions(a2, { id: 'frightened', active: true, value: 1 }, ctx);
    expect(snapshot.mock.calls.map((c: any[]) => c[0])).toEqual(['Actor.a.Item.c1']);
  });
  it.each([
    ['a child it granted', 'child'],
    ['its granter', 'granter'],
  ])('stops without snapshots or removal when a restrict grant covers %s', async (_n, which) => {
    const decrease = vi.fn(async () => {});
    const other: any = {
      id: 'o1',
      uuid: 'Actor.a.Item.o1',
      flags: { pf2e: { grantedBy: { id: 'c1', onDelete: 'restrict' }, itemGrants: {} } },
    };
    const cond: any = {
      ...frightened,
      flags: {
        pf2e: {
          itemGrants: which === 'child' ? { a: { id: 'o1', onDelete: 'restrict' } } : {},
          grantedBy: which === 'granter' ? { id: 'o1' } : undefined,
        },
      },
    };
    if (which === 'granter') {
      other.flags.pf2e = { itemGrants: { a: { id: 'c1', onDelete: 'restrict' } } };
    }
    const a2 = {
      ...actor,
      itemTypes: { ...actor.itemTypes, condition: [cond] },
      items: { get: (id: string) => ({ o1: other, c1: cond })[id] },
      decreaseCondition: decrease,
    };
    const r = (await pf2eAdapter.conditions(a2, { id: 'frightened', active: false }, ctx)) as any;
    expect(snapshot).not.toHaveBeenCalled();
    expect(decrease).not.toHaveBeenCalled();
    expect(r.conditions.map((c: any) => c.id)).toContain('frightened');
  });
  it('does not claim a spend when a cantrip cast fails', async () => {
    spellMessage.mockRejectedValueOnce(new Error('boom'));
    const r = (await pf2eAdapter.performAction(actor, 'spell:e1:s2', {}, ctx)) as any;
    expect(r.completed).toBe(false);
    expect(r.message).toMatch(/^(?!.*was spent).*boom/);
  });
  it('makes no snapshot for a no-op change', async () => {
    await pf2eAdapter.conditions(actor, { id: 'frightened', active: true, value: 2 }, ctx);
    expect(snapshot).not.toHaveBeenCalled();
  });
  it('tells the caller a spent slot, innate use or focus point cannot be undone', async () => {
    const slot = (await pf2eAdapter.performAction(actor, 'spell:e1:s1', { rank: 3 }, ctx)) as any;
    expect(slot.message).toMatch(/spell slot spent cannot be undone/);
    const entry = { id: 'e1', uuid: 'Actor.a.Item.e1', isInnate: true, consume };
    const innate = (await pf2eAdapter.performAction(
      { ...actor, items: { get: () => entry } },
      'spell:e1:s1',
      { rank: 3 },
      ctx,
    )) as any;
    expect(innate.message).toMatch(/innate spell use spent cannot be undone/);
    const focus = { ...spell, system: { ...spell.system, cast: { focusPoints: 1 } } };
    const focusResult = (await pf2eAdapter.performAction(
      { ...actor, itemTypes: { ...actor.itemTypes, spell: [focus] } },
      'spell:e1:s1',
      { rank: 3 },
      ctx,
    )) as any;
    expect(focusResult.message).toMatch(/focus point spent cannot be undone/);
    const cantripResult = (await pf2eAdapter.performAction(actor, 'spell:e1:s2', {}, ctx)) as any;
    expect(cantripResult.message).not.toMatch(/cannot be undone/);
  });
  it('tells the caller spent ammunition cannot be undone, and says nothing when none was spent', async () => {
    const strike = actor.system.actions[0];
    const original = strike.item;
    strike.item = { ...original, system: { expend: 1 }, ammo: { uuid: 'Actor.a.Item.ammo1' } };
    let r: any;
    try {
      r = await pf2eAdapter.performAction(actor, 'strike:w1:longsword:0', {}, ctx);
    } finally {
      strike.item = original;
    }
    expect(r.message).toMatch(
      /Ammunition or a thrown weapon was spent; that spend cannot be undone/,
    );
    const plain = (await pf2eAdapter.performAction(actor, 'strike:w1:longsword:0', {}, ctx)) as any;
    expect(plain.message).not.toMatch(/cannot be undone/);
  });
  it('passes messageMode when replicating Item#toMessage for an action', async () => {
    await pf2eAdapter.performAction(actor, 'action:a2', {}, ctx);
    expect(chatCreate.mock.calls[0]![1]).toHaveProperty('messageMode', undefined);
  });
  it('rejects unknown conditions', async () => {
    await expect(
      pf2eAdapter.conditions(actor, { id: 'bogus', active: true }, ctx),
    ).rejects.toThrow();
  });
});
