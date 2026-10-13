/* eslint-disable @typescript-eslint/no-explicit-any */
import { characterBuildOutput, type CharacterBuildChange } from '@agent-gateway/protocol';
import type { BuildHook, BuildPayload } from '../build.js';
import type { AdapterExecutionContext } from '../types.js';
import { AdapterUnsupportedError } from '../types.js';
import { invalid } from '../../tools/_write.js';
import { boundedAdapterData } from '../../tools/_adapters.js';

declare const CONFIG: any;
declare const Hooks: any;

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

function sourceBuild(actor: any): Record<string, unknown> {
  let build: unknown;
  try {
    build = typeof actor.toObject === 'function' ? actor.toObject().system?.build : undefined;
  } catch {
    build = undefined;
  }
  return build && typeof build === 'object'
    ? structuredClone(build as Record<string, unknown>)
    : {};
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
        // Mirror the native AttributeBuilder (pf2e.mjs:23973-23975): merge into the Actor's own
        // source `system.build` and update that object, never a dotted array path.
        const base = out.actor['system.build'] ?? sourceBuild(actor);
        const attrs = ((base as any).attributes ??= {});
        (attrs.boosts ??= {})[lv!] = [...current];
        out.actor['system.build'] = base;
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

/**
 * Count Item writes on this Actor that did not carry the audit callId while the batch ran: native
 * rule elements (GrantItem and the like) write without our options. Listeners are always removed
 * by `finish()`.
 */
function observe(actor: any): { finish(): { added: number; updated: number; removed: number } } {
  const seen = { added: 0, updated: 0, removed: 0 };
  const ids: Array<[string, unknown]> = [];
  const hooks = typeof Hooks === 'undefined' ? undefined : Hooks;
  const kinds = { createItem: 'added', updateItem: 'updated', deleteItem: 'removed' } as const;
  for (const [name, key] of Object.entries(kinds))
    ids.push([
      name,
      hooks?.on(name, (doc: any, ...args: unknown[]) => {
        const options: any = name === 'updateItem' ? args[1] : args[0];
        if (doc?.parent === actor && typeof options?.agentGateway?.callId !== 'string')
          seen[key] += 1;
      }),
    ]);
  return {
    finish() {
      for (const [name, id] of ids.splice(0)) hooks?.off?.(name, id);
      return seen;
    },
  };
}

interface LockState {
  queue: Array<() => void>;
}
const locks = new Map<string, LockState>();
/** Number of Actors with a build call queued or running (for tests). */
export const pendingBuildLocks = (): number => locks.size;
/** How long a waiter queues before it is refused. The holder is never timed out. */
export const BUILD_LOCK_WAIT_MS = 30_000;
/** Callers allowed to queue behind the holder; further callers are refused at once. */
export const BUILD_LOCK_MAX_WAITING = 4;
const BUSY = 'Another build is still running on this Actor; retry shortly.';
/**
 * Serialise build calls on one Actor in this client (plan, snapshots, updates, post-write read).
 * Waiters are refused after BUILD_LOCK_WAIT_MS or when the queue is full; the holder is not timed
 * out, because a native write may still land after an early release. Known limit: a holder whose
 * snapshot or update never settles keeps refusing builds on that Actor until the page reloads.
 * Writers on other clients are caught by the optimistic check in `applyLocked`.
 */
async function withActorLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  let state = locks.get(key);
  if (!state) {
    state = { queue: [] };
    locks.set(key, state);
  } else {
    if (state.queue.length >= BUILD_LOCK_MAX_WAITING) invalid(BUSY);
    const queue = state.queue;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let granted = false;
    await new Promise<void>((resolve) => {
      const grant = () => {
        granted = true;
        resolve();
      };
      queue.push(grant);
      timer = setTimeout(() => {
        const at = queue.indexOf(grant);
        if (at >= 0) queue.splice(at, 1);
        resolve();
      }, BUILD_LOCK_WAIT_MS);
    });
    clearTimeout(timer);
    if (!granted) invalid(BUSY);
  }
  try {
    return await fn();
  } finally {
    // Hand the lock to the next waiter, or forget the Actor when nobody is queued.
    const next = state.queue.shift();
    if (next) next();
    else locks.delete(key);
  }
}

const itemLocation = (item: any): unknown =>
  (item?._source?.system ?? item?.system)?.location ?? null;

interface Fingerprint {
  /** Actor-level inputs: source build, level and the skill ranks being set. */
  actor: string;
  /** Per-document inputs, keyed by the Item the call will write. */
  items: Map<unknown, string>;
}

/** What the plan was built from: everything `plan()` read that another writer could change. */
function fingerprint(actor: any, changes: readonly CharacterBuildChange[]): Fingerprint {
  let source: any;
  try {
    source = typeof actor.toObject === 'function' ? actor.toObject().system : undefined;
  } catch {
    source = undefined;
  }
  const ranks = changes
    .filter((c) => c.kind === 'skill_rank' && c.skill)
    .map((c) => [c.skill, source?.skills?.[c.skill!]?.rank ?? null]);
  const items = list(actor.items);
  const sourced = (item: any): any => item?._source?.system ?? item?.system;
  const picked = new Map<unknown, string>();
  for (const c of changes) {
    if (c.kind === 'attribute_boost' && (c.source === 'ancestry' || c.source === 'background')) {
      const item = c.source === 'ancestry' ? actor.ancestry : actor.background;
      // plan() checks duplicates across every slot, so all of them are inputs.
      const all = Object.entries<any>(sourced(item)?.boosts ?? {}).map(([k, v]) => [
        k,
        v?.selected ?? null,
      ]);
      picked.set(item ?? c.source, JSON.stringify(all));
    } else if (c.kind === 'key_attribute') {
      picked.set(
        actor.class ?? 'class',
        JSON.stringify(sourced(actor.class)?.keyAbility?.selected ?? null),
      );
    } else if (c.kind === 'feat_slot') {
      const feat = items.find((i) => i?.uuid === c.itemUuid);
      const occupants = items
        .filter((i) => itemLocation(i) === c.slot)
        .map((i) => i?.uuid)
        .sort();
      picked.set(
        feat ?? String(c.itemUuid),
        JSON.stringify([c.slot, itemLocation(feat), occupants]),
      );
    }
  }
  return {
    actor: JSON.stringify([source?.build ?? null, source?.details?.level?.value ?? null, ranks]),
    items: picked,
  };
}

async function apply(
  actor: any,
  changes: readonly CharacterBuildChange[],
  context: AdapterExecutionContext,
): Promise<BuildPayload> {
  if (!isCharacter(actor)) throw new AdapterUnsupportedError();
  if (typeof context?.snapshot !== 'function' || !context.callOptions)
    throw new Error('Audit context unavailable');
  return withActorLock(String(actor.uuid), () => applyLocked(actor, changes, context));
}

async function applyLocked(
  actor: any,
  changes: readonly CharacterBuildChange[],
  context: AdapterExecutionContext,
): Promise<BuildPayload> {
  const p = plan(actor, changes);
  const planned = fingerprint(actor, changes);
  const applied: string[] = [];
  const written = new Set<unknown>();
  /**
   * Re-read the plan's inputs. Inputs of documents this call has already written are skipped:
   * they changed because of us, not because of a rival writer.
   */
  const stale = () => {
    const now = fingerprint(actor, changes);
    let changed = now.actor !== planned.actor;
    for (const [key, value] of planned.items)
      if (!written.has(key) && now.items.get(key) !== value) changed = true;
    if (!changed) return;
    invalid(
      'The build changed during this call; read it again and retry.' +
        (applied.length ? ` Already applied: ${applied.join(', ').slice(0, 300)}.` : ''),
    );
  };
  // Every document the batch will update is snapshotted before the first write.
  const docs: [any, Record<string, unknown>][] = [...p.items];
  if (Object.keys(p.actor).length) docs.push([actor, p.actor]);
  for (const [doc] of docs) await context.snapshot(doc.uuid);
  // Once a write has happened the result must never be lost: failures are reported, not thrown.
  const failures: string[] = [];
  const notes: string[] = [];
  const watch = observe(actor);
  let seen = { added: 0, updated: 0, removed: 0 };
  try {
    stale();
    for (const [doc, patch] of docs) {
      if (doc === actor) stale();
      try {
        // Foundry's update() writes `parent` etc. into the operation object it is given, so a
        // shared options object would turn a later Actor update into an "embedded" one. Hand
        // each call a fresh copy that carries only the audit correlation.
        const options = {
          ...context.callOptions,
          agentGateway: { ...context.callOptions.agentGateway },
        };
        await doc.update(patch, options);
        applied.push(str(doc.name, 60) ?? 'a document');
        written.add(doc);
      } catch (error) {
        const why = error instanceof Error ? error.message : String(error);
        failures.push(
          `Update of ${str(doc.name, 80) ?? 'a document'} failed: ${why.slice(0, 200)}`,
        );
      }
    }
  } finally {
    seen = watch.finish();
  }
  if (seen.added || seen.updated || seen.removed)
    notes.push(
      `Uncorrelated Item writes were observed on this Actor during the call (${seen.added} added, ${seen.updated} updated, ${seen.removed} removed). ` +
        'They are not undoable here. The count may include concurrent writes by others.',
    );
  // Nothing written: report a failure so the audit entry is not recorded as ok.
  if (docs.length > 0 && failures.length === docs.length)
    invalid(`No build change was written. ${failures[0]}`);
  // Failures lead the message so the audit result's truncation cannot hide them.
  return finish(actor, [...failures, ...notes]);
}

const EMPTY: BuildPayload = { supported: true, boosts: [], skills: [], featSlots: [] };
/** Describe after a write, bounding every field so the result always passes the output schema. */
function finish(actor: any, notes: string[]): BuildPayload {
  let state: any;
  try {
    state = describe(actor);
  } catch {
    state = { ...EMPTY };
    notes.push('The resulting build state could not be read; read it again with character_build.');
  }
  const shape = characterBuildOutput.shape;
  const out: any = { supported: true };
  for (const key of ['boosts', 'skills', 'featSlots'] as const) {
    const parsed = shape[key].safeParse(state?.[key]);
    if (parsed.success) out[key] = parsed.data;
    else {
      out[key] = [];
      notes.push(`The ${key} state was not reportable; read it again with character_build.`);
    }
  }
  const key = shape.keyAttribute.safeParse(state?.keyAttribute);
  if (key.success && key.data) out.keyAttribute = key.data;
  else if (!key.success && state?.keyAttribute !== undefined)
    notes.push('The keyAttribute state was not reportable; read it again with character_build.');
  return fit(out, notes);
}

/** Leave headroom for the actorUuid and systemId fields invokeAdapter adds, and its byte cap. */
const RESULT_BUDGET = 60000;
function fits(result: unknown): boolean {
  try {
    boundedAdapterData(result);
    return new TextEncoder().encode(JSON.stringify(result)).length <= RESULT_BUDGET;
  } catch {
    return false;
  }
}
const TRUNCATED =
  'The build state was truncated to fit the result size limit; read it again with character_build.';
/**
 * Make the whole result pass boundedAdapterData and invokeAdapter's byte cap. Trim
 * deterministically: drop slot names, then shorten featSlots, then the other arrays.
 */
function fit(out: any, notes: string[]): BuildPayload {
  const message = (extra: string[]) => {
    const all = [...notes, ...extra];
    return all.length ? { message: all.join(' ').slice(0, 2000) } : {};
  };
  let result = { ...out, ...message([]) };
  if (fits(result)) return result;
  const extra = [TRUNCATED];
  const trial = () => (result = { ...out, ...message(extra) });
  for (const slot of out.featSlots) delete slot.itemName;
  if (trial() && fits(result)) return result;
  for (const key of ['featSlots', 'skills', 'boosts'] as const)
    while (out[key].length > 0) {
      out[key] = out[key].slice(0, Math.floor(out[key].length / 2));
      trial();
      if (fits(result)) return result;
    }
  delete out.keyAttribute;
  return trial();
}

export const pf2eBuildHook: BuildHook = Object.freeze({
  systemId: 'pf2e',
  describe: (actor: unknown) => (isCharacter(actor) ? finish(actor, []) : describe(actor)),
  apply,
});
