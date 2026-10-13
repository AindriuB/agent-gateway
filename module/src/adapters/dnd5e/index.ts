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
        add(
          'damage',
          ' (damage roll)',
          item.type === 'spell' && level > 0
            ? 'Roll the damage without a dialog; options.level rolls it upcast to that slot level'
            : 'Roll the damage without a dialog',
        );
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

interface LockState {
  queue: Array<() => void>;
}
const locks = new Map<string, LockState>();
/** Number of Actors with an action queued or running (for tests). */
export const pendingActionLocks = (): number => locks.size;
/** How long a waiter queues before it is refused; under the gateway's 30 s call limit. */
export const ACTION_LOCK_WAIT_MS = 25_000;
/** Callers allowed to queue behind the holder; further callers are refused at once. */
export const ACTION_LOCK_MAX_WAITING = 4;
const BUSY = 'Another action is still running on this Actor; retry shortly.';
/**
 * Actions run one at a time per Actor in this client, so overlapping uses cannot both spend the
 * last slot and roll captures cannot cross. As in the pf2e build lock, waiters are refused (before
 * any snapshot or write) after ACTION_LOCK_WAIT_MS or when ACTION_LOCK_MAX_WAITING are already
 * queued. The holder is never timed out, because a native write may still land after an early
 * release. Known limit: a holder whose native call never settles keeps refusing actions on that
 * Actor until the page reloads. Writers on other clients are not covered.
 */
async function exclusive<T>(key: string, fn: () => Promise<T>): Promise<T> {
  let state = locks.get(key);
  if (!state) {
    state = { queue: [] };
    locks.set(key, state);
  } else {
    if (state.queue.length >= ACTION_LOCK_MAX_WAITING) invalid(BUSY);
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
      }, ACTION_LOCK_WAIT_MS);
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

/**
 * The activity of a clone of `item` prepared at `scaling` levels above its base level, the way
 * Activity#use prepares one (dnd5e.mjs:17655, :17957-17961). Returns undefined if it cannot.
 */
function scaledActivity(item: any, activity: any, scaling: number): any {
  const clone = item.clone({}, { keepId: true });
  const actor = clone?.actor;
  if (!clone || !actor) return undefined;
  actor._embeddedPreparation = true;
  try {
    clone.updateSource({ 'flags.dnd5e.scaling': scaling });
  } finally {
    delete actor._embeddedPreparation;
  }
  clone.prepareFinalAttributes();
  return clone.system?.activities?.get?.(activity.id);
}

/** Escape and bound a name that goes into a result message. */
const safeName = (v: unknown, max = 80): string =>
  text(v, max * 2)
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
/**
 * Decide what a `use` would do to concentration: which effect (if any) it ends, or why to refuse.
 * Ending a different spell's concentration is refused; recasting the same one replaces its own
 * effect, which is snapshotted and disclosed.
 */
function concentrationDecision(
  actor: any,
  item: any,
  activity: any,
): { effect?: any; refusal?: string } {
  const own = effectiveActivity(item, activity);
  const effect = concentrationEnded(actor, own);
  if (!effect) return {};
  const data = effect.flags?.dnd5e?.item?.data ?? {};
  if (data !== own.id && data?._id !== own.id && effect.flags?.dnd5e?.item?.id !== item.id)
    return {
      refusal: `Cannot use ${text(item.name, 100)}: it would end your concentration on ${concentrationLabel(actor, effect)}. End that first.`,
    };
  return { effect };
}
const concentrationLabel = (actor: any, effect: any): string =>
  safeName(
    effect?.flags?.dnd5e?.item?.data?.name ??
      actor.items?.get?.(effect?.flags?.dnd5e?.item?.id)?.name ??
      effect?.name ??
      'a spell',
  );

/** Validate options.level against the spell and the Actor's slot capacity (live state). */
function checkLevel(
  actor: any,
  item: any,
  kind: string,
  options: Readonly<Record<string, unknown>>,
): { level?: number; slot?: string; error?: string } {
  const level = options.level;
  if (level === undefined) return {};
  if (
    (kind !== 'use' && kind !== 'damage') ||
    item.type !== 'spell' ||
    spellLevel(item) < 1 ||
    typeof level !== 'number' ||
    !Number.isInteger(level) ||
    level < 1 ||
    level > 9
  )
    return {
      error:
        'Spell level must be an integer from 1 to 9 and only applies to using a spell or rolling its damage (cantrips scale with character level)',
    };
  if (level < Math.max(1, spellLevel(item)))
    return { error: `Spell level must be at least ${Math.max(1, spellLevel(item))}` };
  const spells = actor.system?.spells ?? {};
  // Capacity (max), not remaining slots: the damage roll follows a `use` that may have spent the
  // last slot of this level. A pact slot also covers any lower level it can be cast at.
  const slot = spells[`spell${level}`]?.max
    ? `spell${level}`
    : Object.keys(spells).find(
        (k) =>
          num(spells[k]?.max) &&
          (spells[k]?.level === level ||
            (kind === 'damage' && k === 'pact' && (num(spells[k]?.level) ?? 0) >= level)),
      );
  if (!slot) return { error: `No spell slots of level ${level}` };
  return { level, slot };
}

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
  const checked = checkLevel(actor, item, kind, options);
  if (checked.error) return invalid(checked.error);
  const { level, slot } = checked;
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
    const decided = concentrationDecision(actor, item, activity);
    if (decided.refusal) return invalid(decided.refusal);
    ended = decided.effect;
  }
  // The whole of what follows, from the audit steps to the native call, runs in the per-Actor queue,
  // so two overlapping actions on one Actor cannot both prepare "spend the last slot" (the second
  // sees the first's result). The snapshots and `intendCreate` are inside it too: they are awaits,
  // so every decision made before them is made again after them, with no await before the native
  // call.
  return exclusive(String(actor.uuid), async () => {
    if (kind === 'use') {
      const decided = concentrationDecision(actor, item, activity);
      if (decided.refusal) return invalid(decided.refusal);
      ended = decided.effect;
    }
    for (const uuid of [item.uuid, actor.uuid, ended?.uuid])
      if (typeof uuid === 'string') await context.snapshot(uuid);
    await context.intendCreate();
    // Every await is behind us. Native code recomputes a few things from live state when `use` runs
    // (which concentration to end, :17919-17923; whether the activity can run), so decide again now,
    // with no await between here and the `use` call, and bind the native call to that decision.
    let concentrationEnd: string | false | undefined;
    if (
      actor.items?.get?.(item.id) !== item ||
      item.system?.activities?.get?.(activity.id) !== activity
    )
      return invalid('The item changed while the action was being checked; try again');
    const again = checkLevel(actor, item, kind, options);
    if (again.error) return invalid(again.error);
    if (again.slot !== slot || again.level !== level)
      return invalid('The spell slots changed while the action was being checked; try again');
    if (kind === 'use') {
      const now = refusal(item, activity);
      if (now) return invalid(`Cannot use ${text(item.name, 100)}: ${now}`);
      if (activity.canUse === false) return invalid('This activity cannot be used');
      const decided = concentrationDecision(actor, item, activity);
      if (decided.refusal) return invalid(decided.refusal);
      if ((decided.effect?.id ?? null) !== (ended?.id ?? null))
        return invalid(
          `Cannot use ${text(item.name, 100)}: your concentration changed while it was being checked${
            decided.effect ? ` (it would now end ${concentrationLabel(actor, decided.effect)})` : ''
          }. Try again.`,
        );
      if (effectiveActivity(item, activity)?.requiresConcentration === true)
        concentrationEnd = decided.effect ? String(decided.effect.id) : false;
    }
    let refusedWhileQueued: string | undefined;
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
            // `end ??=` in _prepareUsageConfig (:17919-17923) keeps any value that is not nullish,
            // so the validated effect id, or false (end nothing), is honoured as given.
            ...(concentrationEnd === undefined ? {} : { concentration: { end: concentrationEnd } }),
          },
          { configure: false },
          { create: false },
        );
        const results = outcome as any;
        if (results) recorded = await postData(results.message, context);
      } else {
        // Everything below already runs inside the per-Actor queue, after the last await, so
        // what is decided here is what the native roll sees. Upcast damage: dnd5e
        // scales on a temporary clone of the Item whose flags.dnd5e.scaling is set, exactly as
        // Activity#_prepareUsageScaling does for `use` (dnd5e.mjs:17946-17963); the clone's own
        // activity rolls the scaled damage. Nothing is written for the clone.
        const rolled = await (async () => {
          if (
            actor.items?.get?.(item.id) !== item ||
            item.system?.activities?.get?.(activity.id) !== activity
          )
            return { refused: 'The item changed while the action was queued; try again' } as const;
          const live = checkLevel(actor, item, kind, options);
          if (live.error || live.slot !== slot || live.level !== level)
            return {
              refused: live.error ?? 'The spell slots changed while queued; try again',
            } as const;
          const scaling = level === undefined ? 0 : level - spellLevel(item);
          const rolling = scaling > 0 ? scaledActivity(item, activity, scaling) : activity;
          if (!rolling) return { refused: 'Could not prepare the upcast damage roll' } as const;
          return rollUnsaved(rolling, (message) =>
            kind === 'attack'
              ? rolling.rollAttack({}, { configure: false }, message)
              : rolling.rollDamage({}, { configure: false }, message),
          );
        })();
        if ('refused' in rolled) refusedWhileQueued = rolled.refused;
        outcome =
          !('refused' in rolled) && Array.isArray(rolled.rolls) && rolled.rolls.length
            ? rolled.rolls
            : undefined;
        if (outcome && !('refused' in rolled)) {
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
    if (refusedWhileQueued) return invalid(refusedWhileQueued);
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
  });
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
/** dnd5e.utils.staticID (dnd5e.mjs:656-659): truncate or zero-pad to 16 characters. */
const staticId = (id: string): string => (id.length >= 16 ? id.slice(0, 16) : id.padEnd(16, '0'));
/**
 * The effects Actor5e#toggleStatusEffect acts on for a status, not merely every effect that
 * carries it. A leveled status is the one effect with the static id `dnd5e<status>`
 * (ConditionData._applyDelta, dnd5e.mjs:7225). Otherwise core's toggleStatusEffect uses the
 * status's own static `_id` when CONFIG.statusEffects defines one (dnd5e.mjs:7641, :96394), else
 * the effects whose only status is this one. An item or feature effect that merely lists the
 * status among others is not touched by it.
 */
function effectsFor(actor: any, id: string): any[] {
  if (hasLevels(id)) {
    const e = actor.effects?.get?.(staticId(`dnd5e${id}`));
    return e ? [e] : [];
  }
  const fixed = CONFIG?.statusEffects?.[id]?._id;
  if (typeof fixed === 'string') {
    const e = actor.effects?.get?.(fixed);
    return e ? [e] : [];
  }
  return list(actor.effects).filter((e) => {
    const statuses = list(e?.statuses);
    return statuses.length === 1 && statuses[0] === id;
  });
}

function activeConditions(actor: any) {
  const known = knownStatuses();
  // Actor#statuses is core's Set of status ids from active effects.
  const active = new Set<string>(list(actor.statuses).map((s) => text(s, 64)));
  const out: any[] = [];
  for (const [id, name] of known) {
    if (!active.has(id) || out.length >= MAX_CONDITIONS) continue;
    const row: any = { id, name };
    // No static-id effect means level 0, as _applyDelta treats it.
    const lvl = hasLevels(id) ? (num(effectsFor(actor, id)[0]?.system?.level) ?? 0) : undefined;
    if (lvl !== undefined && lvl >= 0) row.value = lvl;
    out.push(row);
  }
  return out;
}

/**
 * Effects a change to this condition would touch: the ones carrying the status and, when adding,
 * those of other statuses in the same exclusive group, which dnd5e deletes (dnd5e.mjs:46068-46072).
 */
function touched(actor: any, id: string, adding: boolean): any[] {
  const out = new Set<any>(effectsFor(actor, id));
  const group = CONFIG?.statusEffects?.[id]?.exclusiveGroup;
  if (adding && group)
    for (const e of Object.values<any>(CONFIG?.statusEffects ?? {}))
      if (e?.id !== id && e?.exclusiveGroup === group)
        for (const x of effectsFor(actor, text(e.id, 64))) out.add(x);
  return [...out];
}
type Step = { levels: number } | { active: boolean } | undefined;
/** What to ask Actor5e#toggleStatusEffect for, from live state, so the request is a target. */
function stepFor(actor: any, change: ConditionChange, leveled: boolean): Step | { error: string } {
  if (leveled) {
    // For leveled statuses toggleStatusEffect applies a level delta and ignores `active`
    // (:46060-46062, ConditionData._applyDelta :7224-7250); the delta is derived from the live
    // level and the requested target level, never stored across an await.
    const current = num(effectsFor(actor, change.id)[0]?.system?.level) ?? 0;
    const target = !change.active ? 0 : (change.value ?? Math.max(current, 1));
    if (!Number.isInteger(target) || target < 0 || target > 10)
      return { error: 'Condition level must be an integer from 0 to 10' };
    return target === current ? undefined : { levels: target - current };
  }
  // toggleStatusEffect decides from the effects it finds (see effectsFor), so the request is
  // compared with those, not with the Actor's whole status set.
  return change.active !== effectsFor(actor, change.id).length > 0
    ? { active: change.active }
    : undefined;
}

async function conditions(actor: any, change?: ConditionChange, context?: AdapterExecutionContext) {
  if (change !== undefined) {
    if (!STATUS.test(change.id) || !knownStatuses().has(change.id))
      return invalid('Unknown condition');
    if (typeof context?.snapshot !== 'function') throw new Error('Audit context unavailable');
    const leveled = hasLevels(change.id);
    if (change.value !== undefined && !leveled)
      return invalid('Only conditions with levels, such as exhaustion, take a value in dnd5e');
    const first = stepFor(actor, change, leveled);
    if (first && 'error' in first) return invalid(first.error);
    // Actor5e#toggleStatusEffect (dnd5e.mjs:46059-46075) takes no document options, so its writes
    // cannot carry callOptions. Enrol the effects it changes so Undo refuses them instead of
    // half-restoring.
    const enrolled = new Set<string>();
    if (first)
      for (const e of touched(actor, change.id, change.active))
        if (typeof e.uuid === 'string') {
          enrolled.add(e.uuid);
          await context.snapshot(e.uuid);
        }
    // The snapshots may have taken a round trip. Decide again from live state, with no await
    // before the native call: the step is recomputed from the target, and it may only touch effects
    // that were enrolled.
    const step = stepFor(actor, change, leveled);
    if (step && 'error' in step) return invalid(step.error);
    if (step) {
      const unenrolled = touched(actor, change.id, change.active).some(
        (e) => typeof e.uuid !== 'string' || !enrolled.has(e.uuid),
      );
      if (unenrolled)
        return invalid('The condition changed while it was being checked; read it and try again');
      await actor.toggleStatusEffect(change.id, step);
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
