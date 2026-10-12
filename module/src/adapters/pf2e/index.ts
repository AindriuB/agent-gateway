/* eslint-disable @typescript-eslint/no-explicit-any */
import type { SystemAdapter, ConditionChange, AdapterExecutionContext } from '../types.js';
import { invalid } from '../../tools/_write.js';

declare const game: any;
declare const ChatMessage: any;

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
 * returned or handed to its callback. Anything else (e.g. a concurrent chat_post or another
 * strike by the same user) is never recorded.
 */
async function auditedChat<T>(
  context: AdapterExecutionContext,
  run: (record: (message: any) => void) => Promise<T>,
): Promise<T> {
  if (typeof context?.intendCreate !== 'function' || typeof context.created !== 'function')
    throw new Error('Audit context unavailable');
  await context.intendCreate();
  const uuids = new Set<string>();
  const record = (message: any) => {
    if (typeof message?.uuid === 'string' && message.uuid) uuids.add(message.uuid);
  };
  try {
    return await run(record);
  } finally {
    for (const uuid of uuids) await context.created(uuid);
  }
}

/**
 * pf2e's own message creation drops caller options (Item#toMessage pf2e.mjs:45496 and
 * SpellPF2e#toMessage :53446 hard-code theirs; Roll#toMessage via Check.roll :19526-19532 only
 * forwards messageMode), so the GM audit witness could not correlate the message with this call.
 * Each native path supports `create: false`, which returns the unsaved message. Create it here
 * with `context.callOptions`, as chat_post does (tools/chat-post.ts:110), and record the result.
 */
async function postMessage(
  message: any,
  context: AdapterExecutionContext,
  record: (message: any) => void,
  options: Record<string, unknown> = {},
): Promise<boolean> {
  if (!message || typeof message.toObject !== 'function') return false;
  const made = await ChatMessage.create(message.toObject(), {
    ...options,
    ...context.callOptions,
  });
  if (!made?.id) return false;
  record(made);
  return true;
}

/**
 * Existing embedded documents a strike updates without caller options: a consumable thrown weapon
 * (Check.roll, pf2e.mjs:19539) and spent ammunition (consumeAmmo, :36063/:36140, :52002).
 */
function strikeWrites(item: any): string[] {
  const out: string[] = [];
  if (
    item?.type === 'weapon' &&
    item.traits?.has?.('consumable') &&
    (num(item.quantity) ?? 0) > 0 &&
    typeof item.uuid === 'string'
  )
    out.push(item.uuid);
  const ammo = item?.ammo;
  if (
    item?.system?.ammo?.builtIn !== true &&
    (num(item?.system?.expend) ?? 0) > 0 &&
    typeof ammo?.uuid === 'string' &&
    !out.includes(ammo.uuid)
  )
    out.push(ammo.uuid);
  return out;
}

/**
 * Existing embedded documents SpellcastingEntryPF2e#consume (pf2e.mjs:53796-53840) updates. It
 * takes no options, so these writes cannot carry callOptions. Focus points live on the Actor.
 */
function consumeTargets(entry: any, spell: any): string[] {
  if (entry.isRitual === true) return [];
  const focus = num(spell.system?.cast?.focusPoints) ?? 0;
  if ((spell.isFocusSpell === true || spell.isCantrip === true) && focus === 0) return [];
  if (focus > 0) return [];
  const prepared = entry.isPrepared === true && entry.isFlexible !== true;
  const target = entry.isInnate === true && !prepared ? spell : entry;
  return typeof target.uuid === 'string' ? [target.uuid] : [];
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
    // Check.roll only honours the user's showCheckDialogs setting, or an `event` run through
    // eventToRollParams, where Shift inverts it. Pass a synthetic event whose Shift state always
    // yields skipDialog = true, whatever the setting.
    const showDialogs = Boolean((globalThis as any).game?.user?.settings?.showCheckDialogs);
    const event = { shiftKey: showDialogs, ctrlKey: false, metaKey: false };
    // Character strikes (pf2e.mjs:35997-36064) forward `createMessage` and `callback` to Check.roll
    // (:19374), which then builds the roll message through Roll#toMessage with only a messageMode
    // (:19526-19532), so the native create cannot carry callOptions. With createMessage: false it
    // does not create the message but still hands the unsaved one to `callback(check, outcome,
    // message, event)` (:19536-19537); create it there with callOptions and record exactly that
    // message. Overlapping strikes by the same user with the same weapon share author, origin and
    // identifier, so no hook predicate could tell them apart. NPC and hazard strikes (:39073,
    // :20448-20499) call Check.roll without a callback, so their message is created natively
    // without callOptions and is neither attributable nor undoable: disclosed below.
    const supported = actor.type === 'character';
    let attributed = false;
    let noMessage = false;
    const rolled = await auditedChat(context, async (record) => {
      // These updates run inside pf2e without options (see strikeWrites), so their snapshots go
      // stale for Undo rather than being restored incorrectly; enrol them all the same.
      for (const uuid of supported ? strikeWrites(strike.item) : []) await context.snapshot(uuid);
      return variant.roll({
        event,
        ...(supported
          ? {
              createMessage: false,
              callback: async (_check: unknown, _outcome: unknown, message: any) => {
                const mode = message?.flags?.pf2e?.context?.messageMode;
                attributed = await postMessage(
                  message,
                  context,
                  record,
                  typeof mode === 'string' ? { messageMode: mode } : {},
                );
                noMessage = !attributed;
              },
            }
          : {}),
      });
    });
    // pf2e resolves null when nothing was rolled: no ammo, out of range, no origin, cancelled.
    if (rolled === null || rolled === undefined)
      return {
        completed: false,
        message:
          `${text(strike.label, 200)} ${text(variant.label, 100)} was not rolled (no ammunition, out of range or no valid target)`.trim(),
      };
    const rolledLabel = `Rolled ${text(strike.label, 200)} ${text(variant.label, 100)}`.trim();
    if (!attributed && (noMessage || supported))
      return done(`${rolledLabel}. No attack message was created`);
    if (!attributed)
      return done(
        `${rolledLabel}. The attack message was posted but not audited and cannot be undone`,
      );
    return done(rolledLabel);
  }
  if (parts[0] === 'action' && parts.length === 2) {
    const item = list(actor.itemTypes?.action).find((i) => i.id === parts[1]);
    if (!item || typeof item.toMessage !== 'function') return invalid('Unknown action');
    // Item#toMessage hard-codes its create options (pf2e.mjs:45476-45496); `create: false` returns
    // the unsaved message (:45496) so it can be created here with callOptions.
    await auditedChat(context, async (record) => {
      const made = await postMessage(
        await item.toMessage(undefined, { create: false }),
        context,
        record,
        { renderSheet: false },
      );
      if (!made) throw new Error(`No chat message was created for ${text(item.name, 200)}`);
    });
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
    // consume (pf2e.mjs:53796-53840) takes no options, so its slot or use update cannot carry
    // callOptions; enrol the entry or spell it writes so Undo knows about them (their snapshots
    // go stale rather than being restored wrongly). Focus points are on the Actor, already enrolled.
    for (const uuid of spell.atWill === true ? [] : consumeTargets(entry, spell))
      await context.snapshot(uuid);
    const cast = await auditedChat(context, async (record) => {
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
        // SpellPF2e#toMessage creates with fixed options (pf2e.mjs:53414, :53446); `create: false` returns
        // the unsaved message (:53446) to create here with callOptions.
        const made = await postMessage(
          await spell.toMessage(null, { actualCast: true, create: false, data: { castRank: cr } }),
          context,
          record,
          { renderSheet: false },
        );
        if (!made) throw new Error('no chat message was created');
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

async function conditions(actor: any, change?: ConditionChange, context?: AdapterExecutionContext) {
  if (change !== undefined) {
    if (!SLUG.test(change.id)) return invalid('Unknown condition');
    if (change.id === 'persistent-damage')
      return invalid('Persistent damage cannot be changed through this tool');
    const known = game.pf2e?.ConditionManager?.getCondition?.(change.id);
    if (!known) return invalid('Unknown condition');
    if (
      typeof context?.snapshot !== 'function' ||
      typeof context.intendCreate !== 'function' ||
      typeof context.created !== 'function'
    )
      throw new Error('Audit context unavailable');
    const existing = list(actor.itemTypes?.condition).find(
      (c) => c.slug === change.id && c.active !== false,
    );
    const value = change.value;
    // pf2e's increaseCondition, decreaseCondition and ConditionManager.updateConditionValue
    // (pf2e.mjs:33531-33561, :48967) call createEmbeddedDocuments, deleteEmbeddedDocuments and
    // Item#update/delete without accepting options, so callOptions cannot reach them. These are
    // the same Foundry document operations they perform (same data and clamping), issued with
    // callOptions the way core tools do (tools/_documents.ts:309).
    if (!change.active || value === 0) {
      if (existing) {
        await context.snapshot(existing.uuid);
        await actor.deleteEmbeddedDocuments('Item', [existing.id], context.callOptions);
      }
    } else if (!existing) {
      await context.intendCreate(actor);
      const data = known.toObject();
      const base = data.system?.value?.value;
      if (data.system?.value)
        data.system.value.value = typeof base === 'number' ? Math.max(base, value ?? 1) : null;
      const made = (await actor.createEmbeddedDocuments('Item', [data], context.callOptions))?.[0];
      if (typeof made?.uuid === 'string' && made.uuid) await context.created(made.uuid, actor);
    } else if (value !== undefined && num(existing.system?.value?.value) !== undefined) {
      let next = value;
      if (['dying', 'wounded', 'doomed'].includes(existing.slug))
        next = Math.min(next, num(actor.attributes?.[existing.slug]?.max) ?? next);
      if (existing.system.value.value !== next) {
        await context.snapshot(existing.uuid);
        await existing.update({ 'system.value.value': next }, context.callOptions);
      }
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
