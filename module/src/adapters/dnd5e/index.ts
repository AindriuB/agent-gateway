/* eslint-disable @typescript-eslint/no-explicit-any */
// Written against dnd5e 6.0.6 on Foundry 14; line references are to systems/dnd5e/dnd5e.mjs of that release.
import type { SystemAdapter, ConditionChange, AdapterExecutionContext } from '../types.js';
import { invalid } from '../../tools/_write.js';

declare const CONFIG: any;
declare const ChatMessage: any;
declare const Hooks: any;

const MAX_ACTIONS = 128;
const MAX_ITEMS = 256;
const MAX_CONDITIONS = 128;
const ID = /^[A-Za-z0-9]{1,64}$/;
const STATUS = /^[a-z][a-z0-9-]{0,63}$/;
const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;

const text = (v: unknown, max = 200): string =>
  typeof v === 'string' ? v.slice(0, max) : typeof v === 'number' ? String(v) : '';
const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;
const signed = (v: number): string => (v >= 0 ? `+${v}` : String(v));
const list = (v: unknown): any[] => {
  if (!v) return [];
  try {
    return Array.from(v as Iterable<unknown>);
  } catch {
    return [];
  }
};
function summary(actor: any) {
  const s = actor.system ?? {};
  const attributes: { key: string; label: string; value: string }[] = [];
  const add = (key: string, label: string, value: string | undefined) => {
    if (value !== undefined && value !== '') attributes.push({ key, label, value });
  };
  const hp = s.attributes?.hp;
  if (num(hp?.value) !== undefined)
    add(
      'hp',
      'Hit Points',
      `${hp.value}/${num(hp.max) ?? '?'}` + (num(hp.temp) ? ` (+${hp.temp} temp)` : ''),
    );
  add('ac', 'Armor Class', text(s.attributes?.ac?.value));
  // Level is derived on characters (dnd5e.mjs:11587, details.level, persisted: false); the Challenge
  // Rating is stored on NPCs (dnd5e.mjs:85320, details.cr).
  if (actor.type === 'npc') {
    const cr = s.details?.cr;
    add('cr', 'Challenge Rating', cr === null || cr === undefined ? undefined : text(cr));
  } else {
    add('level', 'Level', text(num(s.details?.level)));
  }
  const prof = num(s.attributes?.prof);
  add('prof', 'Proficiency Bonus', prof === undefined ? undefined : signed(prof));
  // abilities.<key>.mod is derived (dnd5e.mjs:11314).
  for (const key of ABILITIES) {
    const a = s.abilities?.[key];
    const mod = num(a?.mod);
    if (mod !== undefined)
      add(
        key,
        key.toUpperCase(),
        `${signed(mod)}${num(a.value) === undefined ? '' : ` (${a.value})`}`,
      );
  }
  // Speeds live in attributes.movement.speeds.<type> (dnd5e.mjs:5476, :7419 migrates the old path).
  const mv = s.attributes?.movement;
  const walk = num(mv?.speeds?.walk);
  if (walk !== undefined) add('speed', 'Speed', `${walk} ${text(mv.units, 8) || 'ft'}`);
  return {
    name: text(actor.name, 1000),
    img: text(actor.img, 2048),
    type: text(actor.type, 100),
    attributes,
  };
}

/** system.activities is an ActivityCollection, a Collection keyed by activity id (dnd5e.mjs:28454). */
const activitiesOf = (item: any): any[] => list(item?.system?.activities).filter((a) => a?.id);
/** Item uses: value is derived from max - spent (dnd5e.mjs:14286-14298). */
const usesLabel = (item: any): string | undefined => {
  const max = num(item.system?.uses?.max);
  const value = num(item.system?.uses?.value);
  return max && value !== undefined ? `${value}/${max} uses` : undefined;
};
const spellLevel = (item: any): number => num(item.system?.level) ?? 0;
/**
 * actor.system.spells maps a slot key (spell1..spell9, pact, ...) to { value, max, level, type }
 * (dnd5e.mjs:17951, :17997-17998, :18060-18061).
 */
function slotLabel(actor: any, level: number): string | undefined {
  const spells = actor.system?.spells ?? {};
  const own = spells[`spell${level}`];
  const slot = num(own?.max)
    ? own
    : Object.values<any>(spells).find((x) => x?.level === level && num(x.max));
  if (num(slot?.max) && num(slot?.value) !== undefined) return `${slot.value}/${slot.max} slots`;
  return undefined;
}
/**
 * Spells in 6.0 carry system.method and a numeric system.prepared: 0 unprepared, 1 prepared,
 * 2 always (dnd5e.mjs:33892-33893, :53536-53548). Methods that do not prepare (innate, pact,
 * at will) are always castable (canPrepare, :34033).
 */
function castable(actor: any, spell: any): boolean {
  if (actor.type === 'npc' || spellLevel(spell) === 0) return true;
  if (spell.system?.canPrepare !== true) return true;
  return (num(spell.system?.prepared) ?? 0) > 0;
}

/**
 * Activity types whose `use` is safe to run headless in 6.0.6, from reading each class:
 *  - attack, damage, heal: only the base flow; their follow-up (attack dialog) is behind
 *    `subsequentActions`, which we turn off (dnd5e.mjs:17728, :21468, :23524, :37064).
 *  - check, save, utility, teleport, enchant: base flow; enchant and teleport act in
 *    `_triggerSubsequentActions` (:36534, :41145), which we skip, so only the card is posted.
 *  - summon: `_finalizeUsage` places tokens (:40481-40483, TokenPlacement :40883 or the actor
 *    picker :40522) only when `create.summons` is set; we pass false.
 *  - transform: `_finalizeUsage` (:41893-41904) opens CompendiumBrowser.selectOne through
 *    queryActor (:41907) for every mode except "form" and the empty mode, so those two only.
 *  - forward: delegates to another activity of the same item (:36881), which is checked too.
 * Refused: cast (creates an Item and uses it, which can open the activity chooser; :22017,
 * :35538) and order (a bastion facility flow that always needs its dialog and updates the Item;
 * :37750-37770), and any type this adapter has not been checked against.
 */
const SAFE_TYPES = new Set([
  'attack',
  'check',
  'damage',
  'enchant',
  'forward',
  'heal',
  'save',
  'summon',
  'teleport',
  'transform',
  'utility',
]);
/** Why `use` is refused for this activity, or undefined when it can run without a prompt. */
function refusal(item: any, activity: any, depth = 0): string | undefined {
  const type = text(activity?.type, 40);
  if (!SAFE_TYPES.has(type)) return `${type || 'this'} activities may prompt and are not supported`;
  if (type === 'transform') {
    const mode = activity.transform?.mode;
    if (mode && mode !== 'form')
      return 'transform activities that choose a creature open a compendium browser';
  }
  if (type === 'forward') {
    if (depth > 0) return 'nested forward activities are not supported';
    const target = item?.system?.activities?.get?.(activity.activity?.id);
    if (!target || target === activity) return 'the forwarded activity is missing';
    return refusal(item, target, depth + 1);
  }
  return undefined;
}
/** The activity whose own `use` finally runs (forward activities delegate). */
const effectiveActivity = (item: any, activity: any): any =>
  activity?.type === 'forward'
    ? (item?.system?.activities?.get?.(activity.activity?.id) ?? activity)
    : activity;

type Kind = 'use' | 'attack' | 'damage';
const DAMAGING = new Set(['attack', 'damage', 'save']);

function listActions(actor: any) {
  const rows: { order: number; level: number; action: any }[] = [];
  for (const item of list(actor.items)) {
    const acts = activitiesOf(item);
    if (!acts.length || typeof item.type !== 'string') continue;
    let order: number;
    let group: string;
    let level = 0;
    if (item.type === 'weapon') {
      if (actor.type !== 'npc' && item.system?.equipped !== true) continue;
      [order, group] = [0, 'Weapon attacks'];
    } else if (item.type === 'spell') {
      if (!castable(actor, item)) continue;
      level = spellLevel(item);
      [order, group] = [1, level === 0 ? 'Cantrips' : `Level ${level} spells`];
    } else if (item.type === 'feat') {
      [order, group] = [2, 'Features'];
    } else {
      [order, group] = [3, 'Items'];
    }
    for (const act of acts) {
      if (typeof act.use !== 'function') continue;
      const uses = item.type === 'spell' && level > 0 ? slotLabel(actor, level) : usesLabel(item);
      const base =
        text(act.name, 400) && act.name !== item.name ? `${item.name}: ${act.name}` : item.name;
      const add = (kind: Kind, label: string, description: string) =>
        rows.push({
          order,
          level,
          action: {
            id: `${kind}:${text(item.id, 64)}:${text(act.id, 64)}`,
            name: text(`${base}${label}`, 1000),
            group,
            cost: text(act.activation?.type, 100) || undefined,
            uses,
            description,
          },
        });
      if (!refusal(item, act))
        add(
          'use',
          '',
          `Use (${text(act.type, 100)} activity): posts the card and spends resources`,
        );
      if (act.type === 'attack' && typeof act.rollAttack === 'function')
        add('attack', ' (attack roll)', 'Roll the attack without a dialog');
      if (DAMAGING.has(act.type) && typeof act.rollDamage === 'function')
        add('damage', ' (damage roll)', 'Roll the damage without a dialog');
    }
  }
  rows.sort((a, b) => a.order - b.order || a.level - b.level);
  const actions = rows.slice(0, MAX_ACTIONS).map(({ action }) => {
    for (const k of Object.keys(action))
      if (action[k] === undefined || action[k] === '') delete action[k];
    return action;
  });
  return { supported: true, actions };
}

/**
 * Create the usage message with the audit callOptions. Activity#use builds its card with
 * messageConfig.create = false returning the card data unsaved (dnd5e.mjs:18216), and the roll
 * builders do the same through buildPost (dnd5e.mjs:72090-72095).
 */
async function postData(
  data: unknown,
  context: AdapterExecutionContext,
): Promise<string | undefined> {
  const raw = (data as any)?.toObject ? (data as any).toObject() : data;
  if (!raw || typeof raw !== 'object') return undefined;
  const made = await ChatMessage.create(raw, { ...context.callOptions });
  return typeof made?.uuid === 'string' ? made.uuid : undefined;
}

/**
 * attack/damage rolls return the rolls, not the message. The roll workflow hands one message
 * config to the `dnd5e.preRollV2` hook (dnd5e.mjs:72012-72014; the hook name '' is appended at
 * :72005, giving `preRoll` + '' + `V2`). The listener keeps the first config whose subject is this
 * activity and unregisters at once, so a later roll of the same activity (our own, queued behind
 * `exclusive`, or the user's) can never be captured; the data is read after the roll finishes.
 */
async function rollUnsaved(
  activity: any,
  roll: (message: { create: false }) => Promise<unknown>,
): Promise<{ rolls: any; data: unknown }> {
  let config: any;
  const id = Hooks.on('dnd5e.preRollV2', (c: any, _d: unknown, m: any) => {
    if (config === undefined && c?.subject === activity) {
      config = m;
      Hooks.off('dnd5e.preRollV2', id);
    }
  });
  try {
    const rolls = await roll({ create: false });
    return { rolls, data: config?.data };
  } finally {
    Hooks.off('dnd5e.preRollV2', id);
  }
}

/** Roll actions run one at a time per Actor in this client, so captures cannot cross. */
const queues = new Map<string, Promise<unknown>>();
async function exclusive<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve();
  const run = previous.then(fn, fn);
  const tail = run.catch(() => undefined);
  queues.set(key, tail);
  try {
    return await run;
  } finally {
    if (queues.get(key) === tail) queues.delete(key);
  }
}

/** Escape and bound a name that goes into a result message. */
const safeName = (v: unknown, max = 80): string =>
  text(v, max * 2)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
    .slice(0, max);

/**
 * The concentration effect that using this activity would end: at the concentration limit,
 * `_prepareUsageConfig` (dnd5e.mjs:17919-17923) picks the effect of this same activity, or else the
 * first one, and `use` deletes it (:17696) without caller options.
 */
function concentrationEnded(actor: any, activity: any): any {
  if (activity?.requiresConcentration !== true) return undefined;
  let disabled = false;
  try {
    disabled = Boolean((globalThis as any).game?.settings?.get('dnd5e', 'disableConcentration'));
  } catch {
    disabled = false;
  }
  if (disabled) return undefined;
  const limit = num(actor.system?.attributes?.concentration?.limit) ?? 0;
  const effects = list(actor.concentration?.effects);
  if (!limit || limit > effects.length) return undefined;
  return (
    effects.find((e) => {
      const data = e?.flags?.dnd5e?.item?.data ?? {};
      return data === activity.id || data?._id === activity.id;
    }) ?? effects[0]
  );
}
const concentrationLabel = (actor: any, effect: any): string =>
  safeName(
    effect?.flags?.dnd5e?.item?.data?.name ??
      actor.items?.get?.(effect?.flags?.dnd5e?.item?.id)?.name ??
      effect?.name ??
      'a spell',
  );

/**
 * Activity#use (dnd5e.mjs:17634), Activity#rollAttack (:21483) and Activity#rollDamage (:18274) are
 * the system's own APIs; no dice are rolled here. Each posts a card natively, which is created here
 * instead with callOptions. Resource spend (uses, quantity, slots, ammunition) carries none, so the
 * Item and Actor are snapshotted and the spend is disclosed as not undoable.
 */
async function performAction(
  actor: any,
  actionId: string,
  options: Readonly<Record<string, unknown>>,
  context: AdapterExecutionContext,
) {
  const parts = actionId.split(':');
  const kind = parts[0] as Kind;
  if (
    parts.length !== 3 ||
    !['use', 'attack', 'damage'].includes(kind) ||
    !ID.test(parts[1]!) ||
    !ID.test(parts[2]!)
  )
    return invalid('Unknown action ID');
  const item = actor.items?.get?.(parts[1]);
  const activity = item?.system?.activities?.get?.(parts[2]);
  if (!item || !activity || typeof activity.use !== 'function') return invalid('Unknown action');
  if (
    kind === 'attack' &&
    (activity.type !== 'attack' || typeof activity.rollAttack !== 'function')
  )
    return invalid('Unknown action');
  if (
    kind === 'damage' &&
    (!DAMAGING.has(activity.type) || typeof activity.rollDamage !== 'function')
  )
    return invalid('Unknown action');
  if (activity.canUse === false) return invalid('This activity cannot be used');
  if (kind === 'use') {
    const why = refusal(item, activity);
    if (why) return invalid(`Cannot use ${text(item.name, 100)}: ${why}`);
  }
  const level = options.level;
  let slot: string | undefined;
  if (level !== undefined) {
    if (
      kind !== 'use' ||
      item.type !== 'spell' ||
      typeof level !== 'number' ||
      !Number.isInteger(level) ||
      level < 1 ||
      level > 9
    )
      return invalid(
        'Spell level must be an integer from 1 to 9 and only applies to using a spell',
      );
    if (level < Math.max(1, spellLevel(item)))
      return invalid(`Spell level must be at least ${Math.max(1, spellLevel(item))}`);
    const spells = actor.system?.spells ?? {};
    slot = spells[`spell${level}`]?.max
      ? `spell${level}`
      : Object.keys(spells).find((k) => spells[k]?.level === level && num(spells[k]?.max));
    if (!slot) return invalid(`No spell slots of level ${level}`);
  }
  if (
    typeof context?.intendCreate !== 'function' ||
    typeof context.created !== 'function' ||
    typeof context.snapshot !== 'function'
  )
    throw new Error('Audit context unavailable');
  // Using a concentration spell at the limit ends another concentration. Ending a different
  // spell's concentration is refused (the safer choice); recasting the same one replaces its own
  // effect, which is snapshotted and disclosed.
  let ended: any;
  if (kind === 'use') {
    ended = concentrationEnded(actor, effectiveActivity(item, activity));
    if (ended) {
      const own = effectiveActivity(item, activity).id;
      const data = ended.flags?.dnd5e?.item?.data ?? {};
      if (data !== own && data?._id !== own && ended.flags?.dnd5e?.item?.id !== item.id)
        return invalid(
          `Cannot use ${text(item.name, 100)}: it would end your concentration on ${concentrationLabel(actor, ended)}. End that first.`,
        );
    }
  }
  for (const uuid of [item.uuid, actor.uuid, ended?.uuid])
    if (typeof uuid === 'string') await context.snapshot(uuid);
  await context.intendCreate();
  let recorded: string | undefined;
  let outcome: unknown;
  let summary = '';
  try {
    if (kind === 'use') {
      // configure: false skips the dialog; subsequentActions: false stops an attack activity
      // opening its own attack dialog (:21468, :17728); measuredTemplate: false skips template
      // placement (:17866, :18222); summons: false skips token placement (:40481-40483);
      // create: false returns the card data unsaved.
      outcome = await activity.use(
        {
          subsequentActions: false,
          create: { measuredTemplate: false, summons: false },
          ...(slot ? { spell: { slot } } : {}),
        },
        { configure: false },
        { create: false },
      );
      const results = outcome as any;
      if (results) recorded = await postData(results.message, context);
    } else {
      const rolled = await exclusive(String(actor.uuid), () =>
        rollUnsaved(activity, (message) =>
          kind === 'attack'
            ? activity.rollAttack({}, { configure: false }, message)
            : activity.rollDamage({}, { configure: false }, message),
        ),
      );
      outcome = Array.isArray(rolled.rolls) && rolled.rolls.length ? rolled.rolls : undefined;
      if (outcome) {
        recorded = await postData(rolled.data, context);
        summary = ` (total ${(outcome as any[]).map((r) => text(num(r?.total))).join(', ')})`;
      }
    }
  } catch (e) {
    return {
      completed: false,
      message:
        `Using ${text(item.name, 200)} failed; uses, quantity, ammunition or a spell slot may already have been spent and that cannot be undone: ${text((e as Error)?.message, 300)}`.slice(
          0,
          2000,
        ),
    };
  } finally {
    if (recorded) await context.created(recorded);
  }
  if (!outcome)
    return {
      completed: false,
      message: `${text(item.name, 200)} was not used (cancelled, unavailable or no resources)`,
    };
  const verb =
    kind === 'use' ? 'Used' : kind === 'attack' ? 'Rolled attack for' : 'Rolled damage for';
  const replaced = ended
    ? `. Your concentration on ${concentrationLabel(actor, ended)} ended and cannot be undone`
    : '';
  const note =
    (recorded
      ? '. Resources spent natively cannot be undone'
      : '. No chat message was created; resources spent natively cannot be undone') + replaced;
  return {
    completed: true,
    message: `${verb} ${text(item.name, 200)}${summary}${note}`.slice(0, 2000),
  };
}

function inventory(actor: any) {
  // Equippable data (dnd5e.mjs:29263-29265) carries `attunement` (required/optional), `attuned` and
  // `equipped`; physical data (:29532-29540) carries quantity and weight { value, units }.
  const items = list(actor.items)
    .filter((i) => i && num(i.system?.quantity) !== undefined)
    .slice(0, MAX_ITEMS)
    .map((i) => {
      const out: any = {
        uuid: text(i.uuid, 256),
        name: text(i.name, 1000),
        type: text(i.type, 100),
      };
      const q = num(i.system.quantity);
      if (q !== undefined && q >= 0) out.quantity = q;
      const w = num(i.system?.weight?.value);
      if (w !== undefined) out.weight = `${w} ${text(i.system?.weight?.units, 8) || 'lb'}`;
      if (typeof i.system?.equipped === 'boolean') out.equipped = i.system.equipped;
      // dnd5e attunement is the nearest analogue of the interface's `invested`.
      if (i.system?.attuned === true || (i.system?.attunement && i.system.attunement !== ''))
        out.invested = i.system?.attuned === true;
      return out;
    });
  const totals: { key: string; label: string; value: string }[] = [];
  // encumbrance.value and thresholds.maximum are derived (dnd5e.mjs:9969-9976).
  const enc = actor.system?.attributes?.encumbrance;
  const maxWeight = num(enc?.thresholds?.maximum);
  if (num(enc?.value) !== undefined)
    totals.push({
      key: 'weight',
      label: 'Carried weight',
      value: `${enc.value}${maxWeight === undefined ? '' : `/${maxWeight}`}`,
    });
  const att = actor.system?.attributes?.attunement;
  if (num(att?.value) !== undefined)
    totals.push({
      key: 'attuned',
      label: 'Attuned items',
      value: `${att.value}/${num(att.max) ?? '?'}`,
    });
  for (const [k, v] of Object.entries(actor.system?.currency ?? {}))
    if (/^[a-z]{2}$/.test(k) && num(v) !== undefined && totals.length < 16)
      totals.push({ key: k, label: k.toUpperCase(), value: String(v) });
  return { supported: true, items, totals };
}

/**
 * Statuses dnd5e defines as conditions (CONFIG.DND5E.conditionTypes, dnd5e.mjs:53941). In v14
 * CONFIG.statusEffects is keyed by id (dnd5e.mjs:46066) with names already localized (:1381).
 */
function knownStatuses(): Map<string, string> {
  const out = new Map<string, string>();
  const allowed = CONFIG?.DND5E?.conditionTypes
    ? new Set(Object.keys(CONFIG.DND5E.conditionTypes))
    : undefined;
  for (const e of Object.values<any>(CONFIG?.statusEffects ?? {})) {
    const id = text(e?.id, 64);
    if (STATUS.test(id) && (!allowed || allowed.has(id))) out.set(id, text(e.name ?? id, 1000));
  }
  return out;
}
/** Leveled conditions (exhaustion, ...) are ActiveEffects with system.level (dnd5e.mjs:7095-7115). */
const hasLevels = (id: string): boolean =>
  Number.isFinite(CONFIG?.DND5E?.conditionTypes?.[id]?.levels);
const effectsFor = (actor: any, id: string): any[] =>
  list(actor.effects).filter((e) => list(e?.statuses).includes(id));

function activeConditions(actor: any) {
  const known = knownStatuses();
  // Actor#statuses is core's Set of status ids from active effects.
  const active = new Set<string>(list(actor.statuses).map((s) => text(s, 64)));
  const out: any[] = [];
  for (const [id, name] of known) {
    if (!active.has(id) || out.length >= MAX_CONDITIONS) continue;
    const row: any = { id, name };
    const lvl = hasLevels(id) ? num(effectsFor(actor, id)[0]?.system?.level) : undefined;
    if (lvl !== undefined && lvl >= 0) row.value = lvl;
    out.push(row);
  }
  return out;
}

async function conditions(actor: any, change?: ConditionChange, context?: AdapterExecutionContext) {
  if (change !== undefined) {
    if (!STATUS.test(change.id) || !knownStatuses().has(change.id))
      return invalid('Unknown condition');
    if (typeof context?.snapshot !== 'function') throw new Error('Audit context unavailable');
    const leveled = hasLevels(change.id);
    if (change.value !== undefined && !leveled)
      return invalid('Only conditions with levels, such as exhaustion, take a value in dnd5e');
    const existing = effectsFor(actor, change.id);
    const isActive = list(actor.statuses).includes(change.id);
    // Actor5e#toggleStatusEffect (dnd5e.mjs:46059-46075) takes no document options, so its writes
    // cannot carry callOptions. Enrol the effects it changes so Undo refuses them instead of
    // half-restoring.
    const enrol = async () => {
      for (const e of existing) if (typeof e.uuid === 'string') await context.snapshot(e.uuid);
    };
    if (leveled) {
      // For leveled statuses toggleStatusEffect applies a level delta and ignores `active`
      // (:46060-46062, ConditionData._applyDelta :7224-7250).
      const current = num(existing[0]?.system?.level) ?? 0;
      const target = !change.active ? 0 : (change.value ?? Math.max(current, 1));
      if (!Number.isInteger(target) || target < 0 || target > 10)
        return invalid('Condition level must be an integer from 0 to 10');
      const delta = target - current;
      if (delta !== 0) {
        await enrol();
        await actor.toggleStatusEffect(change.id, { levels: delta });
      }
    } else if (change.active !== isActive) {
      await enrol();
      await actor.toggleStatusEffect(change.id, { active: change.active });
    }
  }
  return { supported: true, conditions: activeConditions(actor) };
}

export const dnd5eAdapter: SystemAdapter = Object.freeze({
  systemId: 'dnd5e',
  actorSummary: summary,
  listActions,
  performAction,
  inventorySemantics: inventory,
  conditions,
});
