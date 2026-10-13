/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pf2eEmbedHook } from '../../../src/adapters/pf2e/embed.js';
import { embedHookFor } from '../../../src/adapters/embed.js';

const g = globalThis as any;
const prompt = vi.fn();
const docs = new Map<string, any>();
beforeEach(() => {
  docs.clear();
  prompt.mockClear();
  g.PickAThingPrompt = prompt;
  g.fromUuid = vi.fn(async (uuid: string) => docs.get(uuid));
});
afterEach(() => {
  delete g.PickAThingPrompt;
  delete g.fromUuid;
});

const slot = (level: number, feat?: object) => ({ level, feat });
const actor = (): any => ({
  feats: new Map([
    [
      'ancestry',
      {
        id: 'ancestry',
        slots: { 'ancestry-1': slot(1), 'ancestry-5': slot(5, { name: 'Taken' }) },
        isFeatValid: (feat: any) => feat.system?.category === 'ancestry',
      },
    ],
  ]),
});
const prepare = (source: any, overrides: any = {}, a = actor()) =>
  Promise.resolve(
    pf2eEmbedHook.prepare({ systemId: 'pf2e', actor: a, entry: {}, source, overrides }),
  );
const refused = async (source: any, overrides: any, match: RegExp) => {
  await expect(prepare(source, overrides)).rejects.toMatchObject({
    code: 'INVALID_ARGS',
    message: expect.stringMatching(match),
  });
  expect(prompt).not.toHaveBeenCalled();
};
const weapon = (usage = 'held-in-one-hand') => ({
  name: 'Club',
  type: 'weapon',
  system: { usage: { value: usage }, rules: [] },
});
const feat = (category = 'ancestry') => ({
  name: 'Feat',
  type: 'feat',
  system: { category, rules: [] },
});
const choiceDoc = (source: any) => ({ toObject: () => source });

describe('embed hook registry', () => {
  it('maps pf2e and falls back to the generic hook', () => {
    expect(embedHookFor('pf2e')).toBe(pf2eEmbedHook);
    expect(embedHookFor('dnd5e').systemId).toBe('generic');
    expect(embedHookFor('__proto__').systemId).toBe('generic');
  });
});

describe('pf2e overrides', () => {
  it('maps quantity and equipped for a held weapon', async () => {
    const out = await prepare(weapon(), { quantity: 2, equipped: true });
    expect(out.system.quantity).toBe(2);
    expect(out.system.equipped).toEqual({ carryType: 'held', handsHeld: 1 });
    expect(prompt).not.toHaveBeenCalled();
  });
  it('maps two-handed, worn, slotted and unequipped states', async () => {
    expect(
      (await prepare(weapon('held-in-two-hands'), { equipped: true })).system.equipped,
    ).toEqual({
      carryType: 'held',
      handsHeld: 2,
    });
    const armor = { name: 'A', type: 'armor', system: { usage: { value: 'worn' }, rules: [] } };
    expect(
      (await prepare(structuredClone(armor), { equipped: true })).system.equipped.carryType,
    ).toBe('worn');
    expect(
      (await prepare(structuredClone(armor), { equipped: false })).system.equipped.carryType,
    ).toBe('dropped');
    const gloves = { ...armor, system: { usage: { value: 'worn-gloves' }, rules: [] } };
    expect((await prepare(gloves, { equipped: true })).system.equipped.inSlot).toBe(true);
    expect((await prepare(weapon(), { equipped: false })).system.equipped).toEqual({
      carryType: 'worn',
      handsHeld: 0,
    });
  });
  it('maps a free slot to system.location and the slot level', async () => {
    const out = await prepare(feat(), { slot: 'ancestry-1' });
    expect(out.system.location).toBe('ancestry-1');
    expect(out.system.level.taken).toBe(1);
  });
  it('leaves the source unchanged without overrides', async () => {
    const src = weapon();
    expect(await prepare(structuredClone(src))).toEqual(src);
  });
  it('rejects each bad override', async () => {
    await refused(feat(), { quantity: 2 }, /quantity is only supported for physical/);
    await refused(feat(), { equipped: true }, /equipped is only supported for physical/);
    await refused(weapon(), { slot: 'ancestry-1' }, /slot is only supported for feats/);
    await refused(feat(), { slot: 'ancestry-5' }, /occupied/);
    await refused(feat(), { slot: 'nope' }, /Unknown feat slot/);
    await refused(feat('class'), { slot: 'ancestry-1' }, /does not accept/);
    await refused(weapon('carried'), { equipped: false }, /only carried/);
    await refused(weapon('attached-to-weapon'), { equipped: true }, /not supported for usage/);
    await expect(
      pf2eEmbedHook.prepare({
        systemId: 'pf2e',
        actor: {},
        entry: {},
        source: feat(),
        overrides: { slot: 'ancestry-1' },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGS' });
  });
  it('accepts equipped=true on a carried item as a no-op', async () => {
    const out = await prepare(weapon('carried'), { equipped: true });
    expect(out.system.equipped).toBeUndefined();
  });
});

describe('pf2e headless safety', () => {
  const choice = (extra: object = {}) => ({
    key: 'ChoiceSet',
    flag: 'pick',
    choices: [],
    ...extra,
  });
  it('refuses a ChoiceSet without selection and accepts one with it', async () => {
    const src = (rule: object) => ({ name: 'F', type: 'feat', system: { rules: [rule] } });
    await refused(src(choice()), {}, /ChoiceSet rule "pick" needs a selection/);
    await refused(src(choice({ selection: null })), {}, /needs a selection/);
    await expect(prepare(src(choice({ selection: 'x' })))).resolves.toBeDefined();
    expect(prompt).not.toHaveBeenCalled();
  });
  it('refuses a ChoiceSet in a granted item, via GrantItem and class items', async () => {
    docs.set('Compendium.p.c.Item.g', choiceDoc({ name: 'G', system: { rules: [choice()] } }));
    await refused(
      {
        name: 'F',
        type: 'feat',
        system: { rules: [{ key: 'GrantItem', uuid: 'Compendium.p.c.Item.g' }] },
      },
      {},
      /"G": ChoiceSet/,
    );
    await refused(
      {
        name: 'C',
        type: 'class',
        system: { rules: [], items: { a: { uuid: 'Compendium.p.c.Item.g', level: 1 } } },
      },
      {},
      /"G": ChoiceSet/,
    );
  });
  it('resolves a preselected grant placeholder, refuses an unresolvable one', async () => {
    docs.set('Compendium.p.c.Item.ok', choiceDoc({ name: 'Ok', system: { rules: [] } }));
    const grant = { key: 'GrantItem', uuid: '{item|flags.pf2e.rulesSelections.pick}' };
    await expect(
      prepare({
        name: 'F',
        type: 'feat',
        system: { rules: [choice({ selection: 'Compendium.p.c.Item.ok' }), grant] },
      }),
    ).resolves.toBeDefined();
    await refused(
      { name: 'F', type: 'feat', system: { rules: [grant] } },
      {},
      /cannot be resolved headless/,
    );
  });
  it('bounds grant depth at 2 and documents at 32', async () => {
    const link = (to?: string) =>
      choiceDoc({ name: 'L', system: { rules: to ? [{ key: 'GrantItem', uuid: to }] : [] } });
    docs.set('Compendium.p.c.Item.d1', link('Compendium.p.c.Item.d2'));
    docs.set('Compendium.p.c.Item.d2', link());
    const top = (to: string) => ({
      name: 'F',
      type: 'feat',
      system: { rules: [{ key: 'GrantItem', uuid: to }] },
    });
    await expect(prepare(top('Compendium.p.c.Item.d1'))).resolves.toBeDefined();
    docs.set('Compendium.p.c.Item.d2', link('Compendium.p.c.Item.d3'));
    docs.set('Compendium.p.c.Item.d3', link());
    await refused(top('Compendium.p.c.Item.d1'), {}, /deeper than 2/);
    const rules = Array.from({ length: 33 }, (_, i) => {
      docs.set(`Compendium.p.c.Item.w${i}`, link());
      return { key: 'GrantItem', uuid: `Compendium.p.c.Item.w${i}` };
    });
    await refused({ name: 'W', type: 'feat', system: { rules } }, {}, /more than 32/);
  });
  it('refuses ammunition that needs a base item', async () => {
    const ammo = (system: object) => ({
      name: 'Arrows',
      type: 'ammo',
      system: { rules: [], ...system },
    });
    await refused(ammo({ craftableAs: ['arrow'] }), {}, /craftableAs needs system.baseItem/);
    await expect(
      prepare(ammo({ craftableAs: ['arrow'], baseItem: 'arrow' })),
    ).resolves.toBeDefined();
    await expect(prepare(ammo({}))).resolves.toBeDefined();
  });
});

describe('pf2e write observer', () => {
  it('counts only writes without audit callOptions and restores the methods', async () => {
    const original = vi.fn(async () => []);
    const a: any = Object.create({
      updateEmbeddedDocuments: original,
      deleteEmbeddedDocuments: original,
    });
    const obs = pf2eEmbedHook.observe!(a);
    await a.updateEmbeddedDocuments('Item', [], { render: false });
    await a.deleteEmbeddedDocuments('Item', [], { agentGateway: { callId: 'c' } });
    expect(obs.finish()).toBe(1);
    expect(Object.hasOwn(a, 'updateEmbeddedDocuments')).toBe(false);
    expect(a.updateEmbeddedDocuments).toBe(original);
  });
});
