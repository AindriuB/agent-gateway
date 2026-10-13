/* eslint-disable @typescript-eslint/no-explicit-any */
import type { EmbedHook, EmbedInput, EmbedObservation, EmbedOverrides } from '../embed.js';
import { invalid } from '../../tools/_write.js';

declare const Hooks: any;

// Written against dnd5e 6.0.6; line references are to systems/dnd5e/dnd5e.mjs of that release.
//
// What happens when an Item is created on an Actor through the API:
//  - No dialog opens. Advancements are applied by AdvancementManager (forNewItem dnd5e.mjs:25309,
//    forLevelChange :25454, per-type Advancement#apply(level, data) :24925), which the sheet's drop
//    handler starts (:66402); createEmbeddedDocuments never does. They could be applied without
//    the sheet, but that is not done here (a follow-up task). Class, subclass, species (`race`),
//    background and feat Items therefore arrive with their advancement definitions and none is
//    applied: no hit points, no granted items, no proficiencies, no ability score improvements.
//    preCreateAdvancement (:28273) only fills in default advancement data on a source with none.
//  - Item5e#_preCreate (:35918) refuses non-physical Items on group Actors and sets an identifier.
//  - ClassData#_onCreate (:29191) assigns the primary class and spellcasting ability with Actor
//    updates that carry no audit options; SpellData#_preCreate (:34653) sets preparation; the
//    `observe` hook counts such writes.
// So the hook has nothing to answer and nothing to prompt. It refuses what could not be created
// safely, bounds the work, and `note` tells the caller that advancements were not applied.

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
/** Item types that carry advancements, none of which embedding applies. */
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
  /** A fixed text: nothing from the Item source is echoed, so there is no untrusted text to escape. */
  // The state is read from the embedded source itself: embedding never applies advancements, and
  // a source that already carries applied values is not claimed to be unapplied.
  note: (source: any): string | undefined => {
    if (!ADVANCING.has(source?.type)) return undefined;
    const text = describeReport([advancementReport(source, advancementCap(source))], 'this Item');
    return text ? `${text} Embedding does not apply advancements.` : undefined;
  },
});

/** True when embedding this Item source will leave advancements unapplied (see the file header). */
export const leavesAdvancementsUnapplied = (src: any): boolean =>
  ADVANCING.has(src?.type) && advancementOf(src).length > 0;

export interface AdvancementReport {
  /** Advancements with nothing applied at any level up to the Item's level. */
  unapplied: number;
  /** Advancements applied at some of those levels but not all. */
  partial: number;
  applied: number;
  /** Types whose application state cannot be read from the data. */
  unknown: number;
}
const isEmptyValue = (v: unknown): boolean =>
  v === undefined ||
  v === null ||
  (Array.isArray(v) ? v.length === 0 : typeof v === 'object' ? Object.keys(v).length === 0 : false);
const levelNum = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;

/**
 * Which levels of one advancement apply, up to `cap`, and whether each was applied. Mirrors the
 * system's own `configuredForLevel` (dnd5e.mjs:27422 Trait, :47233 HitPoints, :48485 ItemGrant,
 * :48695 ItemChoice, :50082 Subclass) on plain data, so it works on a source as well as an Item.
 * ASI is applied once its value has a `type` (asi or feat; :46758-46769). Advancements with no
 * application state (ScaleValue is derived) are skipped; Size and ModifyItem are reported unknown.
 */
function levelsApplied(adv: any, cap: number): boolean[] | 'unknown' | 'none' {
  const value = adv?.value ?? {};
  const config = adv?.configuration ?? {};
  const level = levelNum(adv?.level) ?? 0;
  switch (adv?.type) {
    case 'HitPoints':
      return Array.from({ length: Math.min(cap, 20) }, (_, i) => !!value[i + 1]);
    case 'ItemChoice':
      return Object.entries<any>(config.choices ?? {})
        .filter(([l, c]) => Number(l) <= cap && Number(c?.count) > 0)
        .map(([l]) => value.added?.[l] !== undefined);
    case 'ItemGrant':
      return isEmptyValue(config.items) || level > cap ? 'none' : [!isEmptyValue(value)];
    case 'Trait':
      return (isEmptyValue(config.grants) && isEmptyValue(config.choices)) || level > cap
        ? 'none'
        : [!isEmptyValue(value.chosen)];
    case 'Subclass':
      return level > cap ? 'none' : [!isEmptyValue(value)];
    case 'AbilityScoreImprovement':
      return level > cap ? 'none' : [typeof value.type === 'string' && value.type !== ''];
    case 'ScaleValue':
      return 'none';
    default:
      return 'unknown';
  }
}

/** Tally the application state of an Item source's advancements (see levelsApplied). */
export function advancementReport(src: any, cap: number): AdvancementReport {
  const out: AdvancementReport = { unapplied: 0, partial: 0, applied: 0, unknown: 0 };
  const level = Math.max(1, Math.trunc(cap) || 1);
  for (const adv of advancementOf(src)) {
    const states = levelsApplied(adv, level);
    if (states === 'none') continue;
    if (states === 'unknown') out.unknown += 1;
    else if (states.length === 0 || states.every(Boolean)) out.applied += 1;
    else if (states.some(Boolean)) out.partial += 1;
    else out.unapplied += 1;
  }
  return out;
}
const sum = (rs: readonly AdvancementReport[]): AdvancementReport =>
  rs.reduce(
    (a, r) => ({
      unapplied: a.unapplied + r.unapplied,
      partial: a.partial + r.partial,
      applied: a.applied + r.applied,
      unknown: a.unknown + r.unknown,
    }),
    { unapplied: 0, partial: 0, applied: 0, unknown: 0 },
  );
/** Fixed-text description of a report; empty when there is nothing to say. */
export function describeReport(rs: readonly AdvancementReport[], where: string): string {
  const r = sum(rs);
  const parts: string[] = [];
  if (r.unapplied)
    parts.push(
      `${r.unapplied} advancement(s) on ${where} are NOT applied (hit points, granted items, proficiencies or ability score improvements are not set)`,
    );
  if (r.partial) parts.push(`${r.partial} advancement(s) are only partly applied`);
  if (r.unknown) parts.push(`${r.unknown} advancement(s) have no readable application state`);
  return parts.length ? `${parts.join('; ')}.` : '';
}
/** The level an Item's advancements apply up to (dnd5e.mjs:27755), or 1 for a fresh source. */
export const advancementCap = (item: any): number =>
  levelNum(item?.system?.advancementLevel) ?? levelNum(item?.system?.levels) ?? 1;
