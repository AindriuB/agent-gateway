/* eslint-disable @typescript-eslint/no-explicit-any */
import { vi } from 'vitest';

export const events: string[] = [];
export function resetEvents(): void {
  events.length = 0;
}
/** An embedded Item stub whose update is recorded in `events`. */
export function item(id: string, type: string, system: Record<string, unknown> = {}, actor?: any) {
  const doc: any = {
    id,
    type,
    name: id,
    uuid: `Actor.a.Item.${id}`,
    parent: actor,
    system,
    // The source data is the data the Item reads from, as after a Foundry update.
    get _source() {
      return { system: doc.system };
    },
    update: vi.fn(async (patch: any, options: any) => {
      events.push(`update:${doc.uuid}`);
      doc.lastOptions = { ...options };
      // Like Foundry, apply the patch to the source data the Item reads from.
      for (const [path, value] of Object.entries(patch)) {
        const keys = path.split('.').slice(1);
        let node = doc.system;
        for (const k of keys.slice(0, -1)) node = node[k] ??= {};
        node[keys.at(-1)!] = value;
      }
      // Foundry writes the operation context into the options object it is handed.
      if (options && typeof options === 'object') Object.assign(options, { parent: actor });
      doc.lastPatch = patch;
    }),
  };
  return doc;
}
export const boostSlots = () => ({
  0: { value: ['str', 'dex'], selected: null },
  1: { value: ['con', 'int'], selected: null },
  2: { value: ['str', 'dex', 'con', 'int', 'wis', 'cha'], selected: null },
});
/** A level-7 pf2e character stub with ancestry, background, class, one feat and two slots. */
export function pf2eActor(level = 7): any {
  const actor: any = {
    id: 'a',
    uuid: 'Actor.a',
    documentName: 'Actor',
    name: 'Hero',
    img: 'icons/hero.webp',
    type: 'character',
    level,
    parent: null,
    pack: null,
    isToken: false,
    token: null,
    folder: null,
    owned: true,
    testUserPermission() {
      return this.owned;
    },
    toObject: () => ({ _id: 'a', name: 'Hero', type: 'character' }),
    system: {
      build: { attributes: { manual: false, boosts: { 1: ['str'], 5: [] } } },
      skills: { acrobatics: { rank: 1 }, athletics: { rank: 0 } },
      details: { keyability: { value: 'str' } },
    },
    // pf2e 8.6.0 stores a sparse source (pf2e.mjs:35316); prepared system.skills is complete.
    _source: { system: { skills: { acrobatics: { rank: 1 } } } },
    update: vi.fn(async (patch: any, options: any) => {
      for (const key of ['parent', 'parentUuid', 'pack'])
        if (options && key in options)
          throw new Error('Actor is not a valid embedded Document within the Actor Document');
      events.push('update:Actor.a');
      actor.lastPatch = patch;
      actor.lastOptions = options;
    }),
  };
  actor.ancestry = item('anc', 'ancestry', { boosts: boostSlots() }, actor);
  actor.background = item('bg', 'background', { boosts: boostSlots() }, actor);
  actor.class = item(
    'cls',
    'class',
    { keyAbility: { value: ['str', 'dex'], selected: null } },
    actor,
  );
  actor.feat = item('feat1', 'feat', { location: null }, actor);
  actor.feat.name = 'Toughness';
  actor.itemList = [actor.ancestry, actor.background, actor.class, actor.feat];
  actor.items = actor.itemList;
  const slots: Record<string, any> = {
    'class-1': { id: 'class-1', level: 1, feat: null },
    'class-2': { id: 'class-2', level: 2, feat: { uuid: 'Actor.a.Item.other', name: 'Taken' } },
  };
  actor.feats = [{ id: 'class', slotted: true, slots, isFeatValid: () => true }];
  return actor;
}
