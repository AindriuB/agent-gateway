/* eslint-disable @typescript-eslint/no-explicit-any */
import type { SystemAdapter, ConditionChange, AdapterExecutionContext } from '../types.js';
import { invalid } from '../../tools/_write.js';

declare const game: any;
declare const Hooks: any;

const MAX_ACTIONS = 128;
const MAX_ITEMS = 256;
const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
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

function costLabel(cost: unknown): string | undefined {
  const c = cost as { type?: string; value?: number } | null | undefined;
  if (!c || typeof c !== 'object') return undefined;
  if (c.type === 'reaction') return 'reaction';
  if (c.type === 'free') return 'free action';
  if (c.type === 'action') {
    const n = num(c.value) ?? 1;
    return n === 1 ? '1 action' : `${n} actions`;
  }
  return undefined;
}

function spellCost(v: unknown): string | undefined {
  const t = text(v, 200).trim();
  if (!t) return undefined;
  if (/^[123]$/.test(t)) return t === '1' ? '1 action' : `${t} actions`;
  if (/^free$/i.test(t)) return 'free action';
  if (/^reaction$/i.test(t)) return 'reaction';
  return t;
}

/**
 * Run a native operation that creates ChatMessages, declaring the creation first and recording
 * only messages provably produced by it. `run` receives `record`, for messages the native call
 * returned. With `match`, a createChatMessage hook also records in-flight messages that created by
 * this user and satisfy the predicate. Anything else (e.g. a concurrent chat_post) is never recorded.
 */
async function auditedChat<T>(
  context: AdapterExecutionContext,
  match: ((message: any) => boolean) | undefined,
  run: (record: (message: any) => void) => Promise<T>,
): Promise<T> {
  if (
    typeof context?.intendCreate !== 'function' ||
    typeof context.created !== 'function' ||
    (match && (typeof Hooks?.on !== 'function' || typeof Hooks.off !== 'function'))
  )
    throw new Error('Audit context unavailable');
  await context.intendCreate();
  const uuids = new Set<string>();
  const userId = game.user?.id;
  const record = (message: any) => {
    if (typeof message?.uuid === 'string' && message.uuid) uuids.add(message.uuid);
  };
  const hook = (message: any) => {
    if ((message?.author?.id ?? message?.user?.id) === userId && match?.(message)) record(message);
  };
  const id = match ? Hooks.on('createChatMessage', hook) : undefined;
  try {
    return await run(record);
  } finally {
    if (match) Hooks.off('createChatMessage', id);
    for (const uuid of uuids) await context.created(uuid);
  }
}

function strikes(actor: any): any[] {
  return list(actor.system?.actions).filter(
    (s) => s && (s.type === undefined || s.type === 'strike') && typeof s.slug === 'string',
  );
}
const spellEntryId = (spell: any): string => text(spell.system?.location?.value, 64);

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
      `${hp.value}/${num(hp.max) ?? '?'}` + (hp.temp ? ` (+${hp.temp} temp)` : ''),
    );
  add('ac', 'Armor Class', text(s.attributes?.ac?.value));
  add('level', 'Level', text(num(actor.level) ?? s.details?.level?.value));
  for (const save of ['fortitude', 'reflex', 'will']) {
    const m = num(actor.saves?.[save]?.mod ?? s.saves?.[save]?.mod ?? s.saves?.[save]?.value);
    add(save, save[0]!.toUpperCase() + save.slice(1), m === undefined ? undefined : signed(m));
  }
  const per = num(actor.perception?.mod ?? s.perception?.mod ?? s.perception?.value);
  add('perception', 'Perception', per === undefined ? undefined : signed(per));
  const land = s.movement?.speeds?.land?.value ?? s.attributes?.speed?.value;
  add('speed', 'Speed', num(land) === undefined ? undefined : `${land} ft`);
  const hero = s.resources?.heroPoints;
  if (num(hero?.value) !== undefined)
    add('heroPoints', 'Hero Points', `${hero.value}/${num(hero.max) ?? 3}`);
  return {
    name: text(actor.name, 1000),
    img: text(actor.img, 2048),
    type: text(actor.type, 100),
    attributes,
  };
}

function listActions(actor: any) {
  const actions: any[] = [];
  for (const strike of strikes(actor)) {
    const variants = list(strike.variants);
    const itemId = text(strike.item?.id, 64) || text(strike.slug, 64);
    (variants.length ? variants : [{ label: '' }]).forEach((v, i) => {
      actions.push({
        id: `strike:${itemId}:${text(strike.slug, 64)}:${i}`,
        name:
          text(strike.label ?? strike.item?.name ?? strike.slug, 1000) +
          (i > 0 && v.label ? ` (${text(v.label, 100)})` : ''),
        group: 'Strikes',
        cost: '1 action',
        description:
          i === 0 && v.label
            ? `Attack ${text(v.label, 100)}`
            : i > 0
              ? `Multiple attack penalty variant ${i}`
              : undefined,
      });
    });
  }
  for (const item of list(actor.itemTypes?.action)) {
    const cost = costLabel(item.actionCost);
    if (!cost) continue;
    actions.push({
      id: `action:${text(item.id, 64)}`,
      name: text(item.name, 1000),
      group: 'Actions',
      cost,
    });
  }
  for (const spell of list(actor.itemTypes?.spell)) {
    const rank = num(spell.rank) ?? num(spell.system?.level?.value) ?? 0;
    const cantrip = spell.isCantrip === true || spell.system?.traits?.value?.includes?.('cantrip');
    actions.push({
      id: `spell:${spellEntryId(spell)}:${text(spell.id, 64)}`,
      name: text(spell.name, 1000),
      group: cantrip ? 'Cantrips' : `Rank ${rank} spells`,
      cost: spellCost(spell.system?.time?.value),
    });
  }
  const trimmed = actions.slice(0, MAX_ACTIONS).map((a) => {
    for (const k of Object.keys(a)) if (a[k] === undefined || a[k] === '') delete a[k];
    return a;
  });
  return { supported: true, actions: trimmed };
}

async function performAction(
  actor: any,
  actionId: string,
  options: Readonly<Record<string, unknown>>,
  context: AdapterExecutionContext,
) {
  const parts = actionId.split(':');
  const done = (message: string) => ({ completed: true, message: message.slice(0, 2000) });
  if (parts[0] === 'strike' && parts.length === 4) {
    const strike = strikes(actor).find(
      (s) => s.slug === parts[2] && (text(s.item?.id, 64) || text(s.slug, 64)) === parts[1],
    );
    const variant = strike ? list(strike.variants)[Number(parts[3])] : undefined;
    if (!variant || typeof variant.roll !== 'function') return invalid('Unknown strike action');
    const itemUuid = text(strike.item?.uuid, 256);
    // pf2e builds `${item.id}.${slug}.${melee|ranged}`; the MAP index is not part of it.
    const identifier = `${text(strike.item?.id, 64)}.${text(strike.slug, 64)}.${
      strike.item?.isMelee ? 'melee' : 'ranged'
    }`;
    // Check.roll only honours the user's showCheckDialogs setting, or an `event` run through
    // eventToRollParams, where Shift inverts it. Pass a synthetic event whose Shift state always
    // yields skipDialog = true, whatever the setting.
    const showDialogs = Boolean((globalThis as any).game?.user?.settings?.showCheckDialogs);
    const event = { shiftKey: showDialogs, ctrlKey: false, metaKey: false };
    const rolled = await auditedChat(
      context,
      (m) => {
        const pf2e = m.flags?.pf2e;
        return (
          itemUuid !== '' &&
          pf2e?.origin?.uuid === itemUuid &&
          pf2e?.context?.type === 'attack-roll' &&
          pf2e?.context?.identifier === identifier
        );
      },
      () => variant.roll({ event }),
    );
    // pf2e resolves null when nothing was rolled: no ammo, out of range, no origin, cancelled.
    if (rolled === null || rolled === undefined)
      return {
        completed: false,
        message:
          `${text(strike.label, 200)} ${text(variant.label, 100)} was not rolled (no ammunition, out of range or no valid target)`.trim(),
      };
    return done(`Rolled ${text(strike.label, 200)} ${text(variant.label, 100)}`.trim());
  }
  if (parts[0] === 'action' && parts.length === 2) {
    const item = list(actor.itemTypes?.action).find((i) => i.id === parts[1]);
    if (!item || typeof item.toMessage !== 'function') return invalid('Unknown action');
    await auditedChat(context, undefined, async (record) => record(await item.toMessage()));
    return done(`Performed ${text(item.name, 200)}`);
  }
  if (parts[0] === 'spell' && parts.length === 3) {
    const spell = list(actor.itemTypes?.spell).find((i) => i.id === parts[2]);
    const entry = spell && actor.items?.get?.(parts[1]);
    if (
      !spell ||
      !entry ||
      typeof spell.toMessage !== 'function' ||
      typeof entry.consume !== 'function'
    )
      return invalid('Unknown spell action');
    if (spellEntryId(spell) !== parts[1]) return invalid('Unknown spell action');
    const rank = options.rank;
    if (
      rank !== undefined &&
      (typeof rank !== 'number' || !Number.isInteger(rank) || rank < 1 || rank > 10)
    )
      return invalid('Spell rank must be an integer from 1 to 10');
    const fixed = spell.isCantrip === true || spell.isFocusSpell === true;
    const baseRank = num(spell.baseRank) ?? num(spell.rank) ?? 1;
    if (rank !== undefined && (fixed ? rank !== num(spell.rank) : rank < baseRank))
      return invalid(`Spell rank must be ${fixed ? 'the spell rank' : `at least ${baseRank}`}`);
    const castRank = rank ?? num(spell.rank);
    if (castRank === undefined && !fixed && spell.atWill !== true)
      return invalid('Spell rank is required for this spell');
    const cast = await auditedChat(context, undefined, async (record) => {
      // Consume first so a failed consumption (no focus point or slot) is reported, not hidden.
      let paid: boolean;
      try {
        paid = spell.atWill === true || Boolean(await entry.consume(spell, castRank));
      } catch (e) {
        const msg = text((e as Error)?.message, 300);
        return invalid(
          /slot not given/i.test(msg)
            ? 'Spell rank is required: pass `rank` to choose a spell slot'
            : `Could not cast ${text(spell.name, 200)}: ${msg}`,
        );
      }
      if (!paid) return false;
      try {
        spell.system.location.value ??= entry.id;
        const cr =
          typeof spell.computeCastRank === 'function' ? spell.computeCastRank(castRank) : castRank;
        record(await spell.toMessage(null, { actualCast: true, data: { castRank: cr } }));
      } catch (e) {
        throw new Error(
          `Casting ${text(spell.name, 200)} failed after its slot or focus point was spent: ${text(
            (e as Error)?.message,
            300,
          )}`,
        );
      }
      return true;
    });
    if (!cast)
      return {
        completed: false,
        message: `Could not cast ${text(spell.name, 200)}: no slot or focus point available`,
      };
    return done(`Cast ${text(spell.name, 200)}`);
  }
  return invalid('Unknown action ID');
}

function bulkLabel(v: unknown): string {
  const b = v as { normal?: number; light?: number } | undefined;
  const normal = num(b?.normal) ?? 0;
  const light = num(b?.light) ?? 0;
  return light ? (normal ? `${normal} + ${light}L` : `${light}L`) : String(normal);
}
function itemBulk(item: any): string | undefined {
  const v = num(item.system?.bulk?.value);
  if (v === undefined) return undefined;
  return v === 0 ? '-' : v < 1 ? 'L' : String(v);
}

function inventory(actor: any) {
  const items = list(actor.inventory ?? actor.items)
    .filter((i) => i && i.system?.quantity !== undefined)
    .slice(0, MAX_ITEMS)
    .map((i) => {
      const out: any = {
        uuid: text(i.uuid, 256),
        name: text(i.name, 1000),
        type: text(i.type, 100),
      };
      const q = num(i.quantity ?? i.system?.quantity);
      if (q !== undefined && q >= 0) out.quantity = q;
      const w = itemBulk(i);
      if (w !== undefined) out.weight = w;
      const carry = i.system?.equipped?.carryType;
      out.equipped =
        typeof i.isEquipped === 'boolean' ? i.isEquipped : carry === 'held' || carry === 'worn';
      const inv = i.isInvested ?? i.system?.equipped?.invested;
      if (typeof inv === 'boolean') out.invested = inv;
      return out;
    });
  const b = actor.inventory?.bulk;
  const totals: { key: string; label: string; value: string }[] = [];
  if (b) {
    totals.push({ key: 'bulk', label: 'Bulk', value: bulkLabel(b.value) });
    if (num(b.encumberedAfter) !== undefined)
      totals.push({
        key: 'encumberedAfter',
        label: 'Encumbered after',
        value: String(b.encumberedAfter),
      });
    if (num(b.max) !== undefined)
      totals.push({ key: 'maxBulk', label: 'Maximum bulk', value: String(b.max) });
  }
  totals.push({
    key: 'invested',
    label: 'Invested items',
    value: String(items.filter((i) => i.invested === true).length),
  });
  return { supported: true, items, totals };
}

function activeConditions(actor: any) {
  return list(actor.itemTypes?.condition)
    .filter((c) => c && c.active !== false && typeof c.slug === 'string')
    .slice(0, 128)
    .map((c) => {
      const out: any = { id: text(c.slug, 256), name: text(c.name, 1000) };
      const v = num(c.value ?? c.system?.value?.value);
      if (v !== undefined && v >= 0) out.value = v;
      return out;
    });
}

async function conditions(actor: any, change?: ConditionChange) {
  if (change !== undefined) {
    if (!SLUG.test(change.id)) return invalid('Unknown condition');
    if (change.id === 'persistent-damage')
      return invalid('Persistent damage cannot be changed through this tool');
    const known = game.pf2e?.ConditionManager?.getCondition?.(change.id);
    if (!known) return invalid('Unknown condition');
    const existing = list(actor.itemTypes?.condition).find(
      (c) => c.slug === change.id && c.active !== false,
    );
    const value = change.value;
    if (!change.active || value === 0) {
      if (existing) await actor.decreaseCondition(change.id, { forceRemove: true });
    } else if (!existing) {
      await actor.increaseCondition(change.id, value ? { value } : {});
    } else if (value !== undefined && num(existing.system?.value?.value) !== undefined) {
      if (existing.system.value.value !== value)
        await game.pf2e.ConditionManager.updateConditionValue(existing.id, actor, value);
    }
  }
  return { supported: true, conditions: activeConditions(actor) };
}

export const pf2eAdapter: SystemAdapter = Object.freeze({
  systemId: 'pf2e',
  actorSummary: summary,
  listActions,
  performAction,
  inventorySemantics: inventory,
  conditions,
});
