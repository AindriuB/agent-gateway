/* eslint-disable @typescript-eslint/no-explicit-any */
import type { EmbedHook, EmbedInput, EmbedObservation, EmbedOverrides } from '../embed.js';
import { invalid } from '../../tools/_write.js';

declare const Hooks: any;

// Written against dnd5e 6.0.6; line references are to systems/dnd5e/dnd5e.mjs of that release.
//
// What happens when an Item is created on an Actor through the API:
//  - No dialog opens. Advancement prompts come only from AdvancementManager, which the sheet's
//    drop handler starts (dnd5e.mjs:66402, forNewItem :25309); createEmbeddedDocuments never does.
//    Class, subclass, species (`race`), background and feat Items therefore arrive with their
//    advancement definitions but none of them is applied: no hit points, no granted items, no
//    proficiencies, no ability score improvements. preCreateAdvancement (:28273) only fills in
//    default advancement data on a source that has none.
//  - Item5e#_preCreate (:35918) refuses non-physical Items on group Actors and sets an identifier.
//  - ClassData#_onCreate (:29191) assigns the primary class and spellcasting ability with Actor
//    updates that carry no audit options; SpellData#_preCreate (:34653) sets preparation; the
//    `observe` hook counts such writes.
// So the hook has nothing to answer and nothing to prompt. It refuses what could not be created
// safely and bounds the work.

/** Item types a character may carry; `facility` belongs to bastions and needs a prompt-driven flow. */
const TYPES = new Set([
  'background',
  'class',
  'consumable',
  'container',
  'equipment',
  'feat',
  'loot',
  'race',
  'spell',
  'subclass',
  'tool',
  'weapon',
]);
/** Types with physical state (PhysicalItemTemplate: quantity, weight; dnd5e.mjs:29525-29545). */
const PHYSICAL = new Set(['consumable', 'container', 'equipment', 'loot', 'tool', 'weapon']);
/** Item types whose creation applies advancement only through a UI flow. */
const ADVANCING = new Set(['background', 'class', 'feat', 'race', 'subclass']);
const MAX_ENTRIES = 128;
const label = (src: any): string => `"${String(src?.name ?? 'unnamed').slice(0, 80)}"`;
const size = (v: unknown): number =>
  Array.isArray(v) ? v.length : v && typeof v === 'object' ? Object.keys(v).length : 0;

/** The advancement entries on an Item source, whatever shape (array or id-keyed map). */
export const advancementOf = (src: any): any[] => {
  const a = src?.system?.advancement;
  const rows = Array.isArray(a) ? a : a && typeof a === 'object' ? Object.values(a) : [];
  return rows.slice(0, MAX_ENTRIES);
};

function applyOverrides(source: Record<string, any>, { quantity, equipped, slot }: EmbedOverrides) {
  const physical = PHYSICAL.has(source.type);
  if (quantity !== undefined) {
    if (!physical) invalid(`quantity is only supported for physical items, not ${source.type}`);
    (source.system ??= {}).quantity = quantity;
  }
  if (equipped !== undefined) {
    // `equipped` is a boolean on equippable data (dnd5e.mjs:29265); containers and loot have none.
    if (!physical || typeof source.system?.equipped !== 'boolean')
      invalid(`equipped is not supported for ${source.type} items`);
    source.system.equipped = equipped;
  }
  if (slot !== undefined) invalid('dnd5e has no feat slots; slot is not supported');
}

/**
 * Count Item and Actor writes on this Actor that carry no audit callId: the system's own
 * follow-up writes (class assignment, spellcasting ability, encumbrance). Hooks, not patching.
 */
function observe(actor: any): EmbedObservation {
  let count = 0;
  const on = (name: string, isActor: boolean) =>
    Hooks.on(name, (doc: any, ...args: unknown[]) => {
      const options: any = name.startsWith('update') ? args[1] : args[0];
      if (
        (isActor ? doc === actor : doc?.parent === actor) &&
        typeof options?.agentGateway?.callId !== 'string'
      )
        count += 1;
    });
  const ids: Array<[string, unknown]> = [];
  for (const name of ['updateItem', 'deleteItem']) ids.push([name, on(name, false)]);
  ids.push(['updateActor', on('updateActor', true)]);
  return {
    finish() {
      for (const [name, id] of ids.splice(0)) Hooks.off(name, id);
      return count;
    },
  };
}

export const dnd5eEmbedHook: EmbedHook = Object.freeze({
  systemId: 'dnd5e',
  prepare({ actor, source, overrides, choices }: EmbedInput): Record<string, any> {
    if (choices?.length)
      invalid('dnd5e Items raise no ChoiceSet prompts; choices are not supported');
    if (!TYPES.has(source?.type))
      invalid(`${label(source)}: ${String(source?.type)} items cannot be embedded`);
    // Item5e#_preCreate (dnd5e.mjs:35922) drops non-physical Items on a group; say so up front.
    if (actor?.system?.isGroup && !PHYSICAL.has(source.type))
      invalid('Only physical items can be added to a group Actor');
    for (const key of ['activities', 'advancement', 'effects'] as const) {
      const n = size(key === 'effects' ? source?.effects : source?.system?.[key]);
      if (n > MAX_ENTRIES) invalid(`${label(source)}: more than ${MAX_ENTRIES} ${key} entries`);
    }
    applyOverrides(source, overrides);
    return source;
  },
  observe,
});

/** True when embedding this Item source will leave advancements unapplied (see the file header). */
export const leavesAdvancementsUnapplied = (src: any): boolean =>
  ADVANCING.has(src?.type) && advancementOf(src).length > 0;
