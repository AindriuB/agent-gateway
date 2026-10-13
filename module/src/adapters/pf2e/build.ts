/* eslint-disable @typescript-eslint/no-explicit-any */
import type { CharacterBuildChange } from '@agent-gateway/protocol';
import type { BuildHook, BuildPayload } from '../build.js';
import type { AdapterExecutionContext } from '../types.js';
import { AdapterUnsupportedError } from '../types.js';
import { invalid } from '../../tools/_write.js';

declare const CONFIG: any;

const ATTRIBUTES = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;
const LEVEL_BOOSTS = [1, 5, 10, 15, 20];
const MAX_PER_LEVEL = 4;
const MAX_ROWS = 128;

const list = (v: unknown): any[] => {
  if (!v) return [];
  try {
    return Array.from(v as Iterable<unknown>);
  } catch {
    return [];
  }
};
const str = (v: unknown, max: number): string | undefined =>
  typeof v === 'string' && v ? v.slice(0, max) : undefined;
const own = (o: unknown, k: string): boolean =>
  !!o && typeof o === 'object' && Object.hasOwn(o as object, k);
const isAttr = (v: unknown): v is string => typeof v === 'string' && ATTRIBUTES.includes(v as any);
const attrList = (v: unknown): string[] => list(v).filter(isAttr).slice(0, 8);
const isCharacter = (actor: any): boolean => actor?.type === 'character';

function describe(actor: any): BuildPayload {
  if (!isCharacter(actor)) return { supported: false, boosts: [], skills: [], featSlots: [] };
  const boosts: BuildPayload['boosts'] = [];
  const items: ['ancestry' | 'background', any][] = [
    ['ancestry', actor.ancestry],
    ['background', actor.background],
  ];
  for (const [source, item] of items) {
    const slots = item?.system?.boosts;
    if (!slots || typeof slots !== 'object') continue;
    for (const [slot, data] of Object.entries<any>(slots)) {
      const attribute = isAttr(data?.selected) ? data.selected : undefined;
      boosts.push({
        source,
        slot: slot.slice(0, 100),
        ...(attribute ? { attribute } : {}),
        allowed: attrList(data?.value),
      });
    }
  }
  const levels = actor.system?.build?.attributes?.boosts;
  for (const level of LEVEL_BOOSTS)
    for (const attribute of attrList(levels?.[level]))
      boosts.push({ source: 'level', level, attribute });
  const manual = actor.system?.build?.attributes?.manual === true;
  const key = manual ? actor.system?.details?.keyability?.value : actor.class?.system?.keyAbility;
  const selected = manual ? key : key?.selected;
  const allowed = manual ? [...ATTRIBUTES] : attrList(key?.value);
  const keyAttribute =
    manual || actor.class
      ? { ...(isAttr(selected) ? { selected } : {}), allowed: allowed as string[] }
      : undefined;
  const skills = Object.entries<any>(actor.system?.skills ?? {})
    .filter(([, s]) => Number.isInteger(s?.rank) && s.rank >= 0 && s.rank <= 4)
    .slice(0, MAX_ROWS)
    .map(([skill, s]) => ({ skill: skill.slice(0, 64), rank: s.rank as number }));
  const featSlots: BuildPayload['featSlots'] = [];
  for (const group of list(actor.feats)) {
    if (!group?.slotted || typeof group.id !== 'string') continue;
    for (const slot of Object.values<any>(group.slots ?? {})) {
      const id = str(slot?.id, 100);
      if (!id) continue;
      const feat = slot.feat;
      featSlots.push({
        group: group.id.slice(0, 100),
        slot: id,
        ...(Number.isInteger(slot.level) && slot.level >= 0 && slot.level <= 20
          ? { level: slot.level as number }
          : {}),
        ...(str(feat?.uuid, 256) ? { itemUuid: str(feat.uuid, 256)! } : {}),
        ...(str(feat?.name, 200) ? { itemName: str(feat.name, 200)! } : {}),
      });
    }
  }
  return {
    supported: true,
    boosts: boosts.slice(0, MAX_ROWS),
    ...(keyAttribute ? { keyAttribute } : {}),
    skills,
    featSlots: featSlots.slice(0, MAX_ROWS),
  };
}

interface Plan {
  items: Map<any, Record<string, unknown>>;
  actor: Record<string, unknown>;
}

function plan(actor: any, changes: readonly CharacterBuildChange[]): Plan {
  const out: Plan = { items: new Map(), actor: {} };
  const patch = (item: any, key: string, value: unknown) => {
    const p = out.items.get(item) ?? {};
    p[key] = value;
    out.items.set(item, p);
  };
  const level = typeof actor.level === 'number' ? actor.level : 1;
  const selected = new Map<any, Map<string, string | null>>();
  const working = (item: any): Map<string, string | null> => {
    let m = selected.get(item);
    if (!m) {
      m = new Map(
        Object.entries<any>(item.system?.boosts ?? {}).map(([k, v]) => [k, v?.selected ?? null]),
      );
      selected.set(item, m);
    }
    return m;
  };
  const levelLists = new Map<number, string[]>();
  const taken = new Set<string>();
  for (const c of changes) {
    if (c.kind === 'attribute_boost') {
      if (!c.attribute || !isAttr(c.attribute)) invalid('A valid attribute is required');
      if (c.source === 'level') {
        const lv = c.level;
        if (lv === undefined || !LEVEL_BOOSTS.includes(lv))
          invalid('Level boosts are granted at levels 1, 5, 10, 15 and 20');
        if (lv! > level) invalid('A level boost cannot exceed the Actor level');
        const current =
          levelLists.get(lv!) ?? attrList(actor.system?.build?.attributes?.boosts?.[lv!]);
        if (current.includes(c.attribute!)) invalid('Duplicate attribute boost within a level');
        if (current.length >= MAX_PER_LEVEL) invalid('At most 4 boosts are allowed per level');
        current.push(c.attribute!);
        levelLists.set(lv!, current);
        out.actor[`system.build.attributes.boosts.${lv}`] = current;
      } else if (c.source === 'ancestry' || c.source === 'background') {
        const item = c.source === 'ancestry' ? actor.ancestry : actor.background;
        if (!item) invalid(`The Actor has no ${c.source}`);
        if (c.source === 'ancestry' && item.system?.alternateAncestryBoosts)
          invalid('Alternate ancestry boosts are not supported');
        const slot = c.slot;
        const data =
          slot !== undefined && own(item.system?.boosts, slot) ? item.system.boosts[slot] : null;
        if (!data) invalid('Unknown boost slot');
        if (!attrList(data.value).includes(c.attribute!))
          invalid('Attribute is not allowed in this boost slot');
        const map = working(item);
        for (const [other, attr] of map)
          if (other !== slot && attr === c.attribute)
            invalid('Duplicate attribute boost within one source');
        map.set(slot!, c.attribute!);
        patch(item, `system.boosts.${slot}.selected`, c.attribute);
      } else invalid('Attribute boosts need source ancestry, background or level');
    } else if (c.kind === 'key_attribute') {
      if (!c.attribute || !isAttr(c.attribute)) invalid('A valid attribute is required');
      if (actor.system?.build?.attributes?.manual === true)
        out.actor['system.details.keyability.value'] = c.attribute;
      else {
        const cls = actor.class;
        if (!cls) invalid('The Actor has no class');
        if (!attrList(cls.system?.keyAbility?.value).includes(c.attribute!))
          invalid('Attribute is not an allowed key attribute for the class');
        patch(cls, 'system.keyAbility.selected', c.attribute);
      }
    } else if (c.kind === 'skill_rank') {
      const skills = actor.system?.skills;
      if (!c.skill || !own(CONFIG.PF2E?.skills, c.skill) || !own(skills, c.skill))
        invalid('Unknown skill');
      if (skills[c.skill!]?.lore === true)
        invalid('Lore skill ranks live on the lore Item and cannot be set here');
      if (c.rank === undefined) invalid('A skill rank is required');
      const cap = level < 7 ? 2 : level < 15 ? 3 : 4;
      if (c.rank! > cap) invalid(`Skill rank ${c.rank} exceeds the level ${level} cap of ${cap}`);
      out.actor[`system.skills.${c.skill}.rank`] = c.rank;
    } else {
      const item = c.itemUuid ? list(actor.items).find((i) => i?.uuid === c.itemUuid) : undefined;
      if (!item || item.type !== 'feat' || item.parent !== actor)
        invalid('itemUuid must be a feat embedded in this Actor');
      let slot: any;
      let group: any;
      for (const g of list(actor.feats))
        if (g?.slotted && c.slot !== undefined && own(g.slots, c.slot)) {
          group = g;
          slot = g.slots[c.slot];
        }
      if (!slot) invalid('Unknown feat slot');
      if ((slot.feat && slot.feat !== item) || taken.has(slot.id)) invalid('Feat slot is occupied');
      if (typeof group.isFeatValid === 'function' && !group.isFeatValid(item))
        invalid('This feat cannot fill that slot');
      taken.add(slot.id);
      patch(item, 'system.location', slot.id);
      if (Number.isInteger(slot.level)) patch(item, 'system.level.taken', slot.level);
    }
  }
  return out;
}

async function apply(
  actor: any,
  changes: readonly CharacterBuildChange[],
  context: AdapterExecutionContext,
): Promise<BuildPayload> {
  if (!isCharacter(actor)) throw new AdapterUnsupportedError();
  if (typeof context?.snapshot !== 'function' || !context.callOptions)
    throw new Error('Audit context unavailable');
  const p = plan(actor, changes);
  const before = new Set(list(actor.items).map((i) => i?.id));
  // Every document the batch will update is snapshotted before the first write.
  const docs: [any, Record<string, unknown>][] = [...p.items];
  if (Object.keys(p.actor).length) docs.push([actor, p.actor]);
  for (const [doc] of docs) await context.snapshot(doc.uuid);
  for (const [doc, patch] of docs) await doc.update(patch, context.callOptions);
  const after = list(actor.items).map((i) => i?.id);
  const created = after.filter((id) => !before.has(id)).length;
  const removed = [...before].filter((id) => !after.includes(id)).length;
  const result = describe(actor);
  if (created || removed)
    result.message =
      `Native pf2e rule elements changed Items on this Actor (${created} added, ${removed} removed) ` +
      'outside this call’s audit correlation. Those changes are not undoable.';
  return result;
}

export const pf2eBuildHook: BuildHook = Object.freeze({
  systemId: 'pf2e',
  describe,
  apply,
});
