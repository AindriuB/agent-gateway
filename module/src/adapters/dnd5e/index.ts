/* eslint-disable @typescript-eslint/no-explicit-any */
// Written against dnd5e 5.1 (Foundry v13): Activity#use, ItemDataModel activities, toggleStatusEffect.
import type { SystemAdapter, ConditionChange, AdapterExecutionContext } from '../types.js';
import { invalid } from '../../tools/_write.js';

declare const game: any;
declare const CONFIG: any;
declare const ChatMessage: any;

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
const localize = (v: unknown): string => {
  const s = text(v, 400);
  try {
    return game?.i18n?.localize ? text(game.i18n.localize(s), 1000) : s;
  } catch {
    return s;
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
  if (actor.type === 'npc') {
    const cr = s.details?.cr;
    add('cr', 'Challenge Rating', cr === null || cr === undefined ? undefined : text(cr));
  } else {
    add('level', 'Level', text(num(s.details?.level)));
  }
  add(
    'prof',
    'Proficiency Bonus',
    num(s.attributes?.prof) === undefined ? undefined : signed(s.attributes.prof),
  );
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
  const mv = s.attributes?.movement;
  const walk = num(mv?.walk);
  if (walk !== undefined) add('speed', 'Speed', `${walk} ${text(mv.units, 8) || 'ft'}`);
  return {
    name: text(actor.name, 1000),
    img: text(actor.img, 2048),
    type: text(actor.type, 100),
    attributes,
  };
}

const activitiesOf = (item: any): any[] => list(item?.system?.activities).filter((a) => a?.id);
const usesLabel = (item: any): string | undefined => {
  const max = num(item.system?.uses?.max);
  const value = num(item.system?.uses?.value);
  return max && value !== undefined ? `${value}/${max} uses` : undefined;
};
const spellLevel = (item: any): number => num(item.system?.level) ?? 0;
function slotLabel(actor: any, level: number): string | undefined {
  const sp = actor.system?.spells?.[`spell${level}`];
  if (num(sp?.max) && num(sp?.value) !== undefined) return `${sp.value}/${sp.max} slots`;
  const pact = actor.system?.spells?.pact;
  if (num(pact?.max) && num(pact?.value) !== undefined && pact.level === level)
    return `${pact.value}/${pact.max} pact slots`;
  return undefined;
}
/** Spells an Actor can cast now: always, at will, innate and pact, plus prepared ones that are. */
function castable(actor: any, spell: any): boolean {
  if (actor.type === 'npc') return true;
  const p = spell.system?.preparation;
  if (spellLevel(spell) === 0) return true;
  return p?.mode !== 'prepared' || p?.prepared === true;
}

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
      const name =
        text(act.name, 400) && act.name !== item.name ? `${item.name}: ${act.name}` : item.name;
      rows.push({
        order,
        level,
        action: {
          id: `activity:${text(item.id, 64)}:${text(act.id, 64)}`,
          name: text(name, 1000),
          group,
          cost: text(act.activation?.type, 100) || undefined,
          uses,
          description: text(act.type, 100) ? `${text(act.type, 100)} activity` : undefined,
        },
      });
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
 * Activity#use posts its own chat card and spends uses, quantity and slots natively. The message
 * is created here with callOptions (create: false) so the audit witness can correlate it; the
 * resource spend carries no callOptions, so the owning Item and the Actor are snapshotted and the
 * spend is disclosed as not undoable.
 */
async function performAction(
  actor: any,
  actionId: string,
  options: Readonly<Record<string, unknown>>,
  context: AdapterExecutionContext,
) {
  const parts = actionId.split(':');
  if (parts[0] !== 'activity' || parts.length !== 3 || !ID.test(parts[1]!) || !ID.test(parts[2]!))
    return invalid('Unknown action ID');
  const item = actor.items?.get?.(parts[1]);
  const activity = item?.system?.activities?.get?.(parts[2]);
  if (!item || !activity || typeof activity.use !== 'function') return invalid('Unknown action');
  const level = options.level;
  if (
    level !== undefined &&
    (item.type !== 'spell' ||
      typeof level !== 'number' ||
      !Number.isInteger(level) ||
      level < 1 ||
      level > 9)
  )
    return invalid('Spell level must be an integer from 1 to 9 and only applies to spells');
  if (level !== undefined && (level as number) < Math.max(1, spellLevel(item)))
    return invalid(`Spell level must be at least ${Math.max(1, spellLevel(item))}`);
  if (typeof context?.intendCreate !== 'function' || typeof context.created !== 'function')
    throw new Error('Audit context unavailable');
  if (typeof context.snapshot !== 'function') throw new Error('Audit context unavailable');
  for (const uuid of [item.uuid, actor.uuid])
    if (typeof uuid === 'string') await context.snapshot(uuid);
  await context.intendCreate();
  let recorded: string | undefined;
  let result: any;
  try {
    // configure: false skips the dialog; the usage message is returned unsaved (create: false).
    result = await activity.use(
      level === undefined ? {} : { spell: { slot: `spell${level}` } },
      { configure: false },
      { create: false },
    );
    const message = result?.message ?? result;
    const data =
      typeof message?.toObject === 'function'
        ? message.toObject()
        : message && typeof message === 'object' && message.content !== undefined
          ? message
          : undefined;
    if (data) {
      const made = await ChatMessage.create(data, { ...context.callOptions });
      if (typeof made?.uuid === 'string') recorded = made.uuid;
    }
  } catch (e) {
    return {
      completed: false,
      message:
        `Using ${text(item.name, 200)} failed; uses, quantity or a spell slot may already have been spent and that cannot be undone: ${text((e as Error)?.message, 300)}`.slice(
          0,
          2000,
        ),
    };
  } finally {
    if (recorded) await context.created(recorded);
  }
  if (result === null || result === undefined)
    return {
      completed: false,
      message: `${text(item.name, 200)} was not used (cancelled or no resources)`,
    };
  const note = recorded
    ? '. Uses or slots spent natively cannot be undone'
    : '. No usage message was created; uses or slots spent natively cannot be undone';
  return { completed: true, message: `Used ${text(item.name, 200)}${note}`.slice(0, 2000) };
}

function inventory(actor: any) {
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
      const w = num(i.system?.weight?.value ?? i.system?.weight);
      if (w !== undefined) out.weight = `${w} ${text(i.system?.weight?.units, 8) || 'lb'}`;
      if (typeof i.system?.equipped === 'boolean') out.equipped = i.system.equipped;
      // dnd5e attunement is the nearest analogue of the interface's `invested`.
      if (i.system?.attuned === true || i.system?.attunement === 'required')
        out.invested = i.system?.attuned === true;
      return out;
    });
  const totals: { key: string; label: string; value: string }[] = [];
  const enc = actor.system?.attributes?.encumbrance;
  if (num(enc?.value) !== undefined)
    totals.push({
      key: 'weight',
      label: 'Carried weight',
      value: `${enc.value}${num(enc.max) === undefined ? '' : `/${enc.max}`}`,
    });
  const att = num(actor.system?.attributes?.attunement?.value);
  if (att !== undefined)
    totals.push({
      key: 'attuned',
      label: 'Attuned items',
      value: `${att}/${num(actor.system.attributes.attunement.max) ?? '?'}`,
    });
  for (const [k, v] of Object.entries(actor.system?.currency ?? {}))
    if (/^[a-z]{2}$/.test(k) && num(v) !== undefined && totals.length < 16)
      totals.push({ key: k, label: k.toUpperCase(), value: String(v) });
  return { supported: true, items, totals };
}

/** Status ids the system defines as conditions; falls back to every registered status. */
function knownStatuses(): Map<string, string> {
  const out = new Map<string, string>();
  const allowed = CONFIG?.DND5E?.conditionTypes
    ? new Set(Object.keys(CONFIG.DND5E.conditionTypes))
    : undefined;
  for (const e of list(CONFIG?.statusEffects)) {
    const id = text(e?.id, 64);
    if (STATUS.test(id) && (!allowed || allowed.has(id)))
      out.set(id, localize(e.name ?? e.label ?? id));
  }
  return out;
}

function activeConditions(actor: any) {
  const known = knownStatuses();
  const active = new Set<string>(list(actor.statuses).map((s) => text(s, 64)));
  const out: any[] = [];
  for (const [id, name] of known) {
    if (!active.has(id) || out.length >= MAX_CONDITIONS) continue;
    const row: any = { id, name };
    const lvl = id === 'exhaustion' ? num(actor.system?.attributes?.exhaustion) : undefined;
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
    if (change.value !== undefined && change.id !== 'exhaustion')
      return invalid('Only exhaustion takes a value in dnd5e');
    const isActive = list(actor.statuses).includes(change.id);
    if (change.id === 'exhaustion' && change.value !== undefined) {
      if (!Number.isInteger(change.value) || change.value < 0 || change.value > 10)
        return invalid('Exhaustion must be an integer from 0 to 10');
      // A plain Actor update, so it carries the audit callOptions.
      await actor.update(
        { 'system.attributes.exhaustion': change.active ? change.value : 0 },
        { ...context.callOptions },
      );
    } else if (change.active !== isActive) {
      // toggleStatusEffect takes no document options, so its writes cannot carry callOptions.
      // Enrol the effects a removal deletes so Undo refuses them instead of half-restoring.
      if (!change.active)
        for (const e of list(actor.effects))
          if (list(e.statuses).includes(change.id) && typeof e.uuid === 'string')
            await context.snapshot(e.uuid);
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
