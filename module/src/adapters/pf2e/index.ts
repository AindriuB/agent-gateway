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
  // Loaded ammunition (a repeating weapon's magazine, say) is a synthetic subitem built from its
  // owner's system.subitems (pf2e.mjs:46161-46167) and carries `parentItem`. Its update is
  // rerouted to a parentItem.update({system:{subitems}}) call (:46375-46387), so the persisted,
  // hook-visible document is the owning Item: snapshot that one.
  let ammo = item?.ammo;
  for (let depth = 0; ammo?.parentItem && depth < 8; depth++) ammo = ammo.parentItem;
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

/** What casting spends natively without callOptions, for the result disclosure. */
function spellSpends(entry: any, spell: any): string {
  if (spell.atWill === true || entry.isRitual === true) return '';
  const focus = num(spell.system?.cast?.focusPoints) ?? 0;
  if (focus > 0) return 'focus point';
  const targets = consumeTargets(entry, spell);
  if (!targets.length) return '';
  return targets[0] === spell.uuid ? 'innate spell use' : 'spell slot';
}

/**
 * Actionable abilities: `action` Items and `feat` Items with an action cost. AbilityItem, Feat and
 * the other item classes derive actionCost from system.actionType.value, `passive` giving null
 * (pf2e.mjs:52239-52245, :52305-52311, :52455-52461), so a costed feat has type action, reaction
 * or free. costLabel keeps only those. Items with `suppressed` set (suppressFeats, :52432-52433;
 * feat prepareBaseData :52482) are skipped, as the sheet does (#prepareAbilities, :24951).
 */
function actionItems(actor: any): any[] {
  return [...list(actor.itemTypes?.action), ...list(actor.itemTypes?.feat)].filter(
    (i) => i && i.suppressed !== true,
  );
}

function strikes(actor: any): any[] {
  return list(actor.system?.actions).filter(
    (s) => s && (s.type === undefined || s.type === 'strike') && typeof s.slug === 'string',
  );
}
/**
 * Ritual spells belong to the ephemeral RitualSpellcasting entry, id `rituals`, which exists only
 * in actor.spellcasting and is not an embedded Item (pf2e.mjs:33885-33892, :34530). Other spells
 * name their entry in system.location.value, which SpellPF2e#spellcasting resolves through
 * actor.spellcasting (:53077-53080).
 */
const spellEntryId = (spell: any): string =>
  spell.isRitual === true ? 'rituals' : text(spell.system?.location?.value, 64);
function spellEntry(actor: any, id: string): any {
  if (!id) return undefined;
  // When actor.spellcasting exists a miss means "no entry": pf2e treats such spells as orphaned
  // (pf2e.mjs:33970). Only without it do we fall back to embedded Items.
  if (actor.spellcasting?.get) return actor.spellcasting.get(id) ?? undefined;
  return actor.items?.get?.(id);
}
/** The entry that can cast this spell: a ritual entry, or one that consumes resources. */
function castableEntry(actor: any, spell: any): any {
  if (typeof spell?.toMessage !== 'function') return undefined;
  const entry = spellEntry(actor, spellEntryId(spell));
  if (!entry) return undefined;
  if (spell.isRitual === true) return entry.isRitual === true ? entry : undefined;
  return typeof entry.consume === 'function' ? entry : undefined;
}

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
    // Only variants performAction can roll are listed.
    const variants = list(strike.variants);
    const itemId = text(strike.item?.id, 64) || text(strike.slug, 64);
    variants.forEach((v, i) => {
      if (typeof v?.roll !== 'function') return;
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
  for (const item of actionItems(actor)) {
    const cost = costLabel(item.actionCost);
    if (!cost || typeof item.toMessage !== 'function') continue;
    actions.push({
      id: `action:${text(item.id, 64)}`,
      name: text(item.name, 1000),
      group: 'Actions',
      cost,
    });
  }
  for (const spell of list(actor.itemTypes?.spell)) {
    if (!castableEntry(actor, spell)) continue;
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
    const spentAmmo = strikeWrites(strike.item).length > 0;
    let attributed = false;
    let noMessage = false;
    let rolled: unknown;
    try {
      rolled = await auditedChat(context, async (record) => {
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
    } catch (e) {
      // A failure after the roll may already have spent ammunition. Return, not throw, so the
      // disclosure survives invokeAdapter and the caller does not blindly retry.
      if (!spentAmmo) throw e;
      return {
        completed: false,
        message:
          `Rolling ${text(strike.label, 200)} failed; ammunition or a thrown weapon may have been spent and that cannot be undone: ${text((e as Error)?.message, 300)}`.slice(
            0,
            2000,
          ),
      };
    }
    // pf2e resolves null when nothing was rolled: no ammo, out of range, no origin, cancelled.
    if (rolled === null || rolled === undefined)
      return {
        completed: false,
        message:
          `${text(strike.label, 200)} ${text(variant.label, 100)} was not rolled (no ammunition, out of range or no valid target)`.trim(),
      };
    // Ammunition and thrown weapons are spent natively without callOptions (see strikeWrites).
    const spent = spentAmmo
      ? '. Ammunition or a thrown weapon was spent; that spend cannot be undone'
      : '';
    const rolledLabel = `Rolled ${text(strike.label, 200)} ${text(variant.label, 100)}`.trim();
    if (!attributed && (noMessage || supported))
      return done(`${rolledLabel}. No attack message was created${spent}`);
    if (!attributed)
      return done(
        `${rolledLabel}. The attack message was posted but not audited and cannot be undone${spent}`,
      );
    return done(`${rolledLabel}${spent}`);
  }
  if (parts[0] === 'action' && parts.length === 2) {
    const item = actionItems(actor).find((i) => i.id === parts[1] && costLabel(i.actionCost));
    if (!item || typeof item.toMessage !== 'function') return invalid('Unknown action');
    // Item#toMessage hard-codes its create options (pf2e.mjs:45476-45496); `create: false` returns
    // the unsaved message (:45496) so it can be created here with callOptions.
    await auditedChat(context, async (record) => {
      const made = await postMessage(
        await item.toMessage(undefined, { create: false }),
        context,
        record,
        // Native passes messageMode: eventToMessageMode(undefined), which is undefined
        // (pf2e.mjs:13774-13775, :45495-45496).
        { renderSheet: false, messageMode: undefined },
      );
      if (!made) throw new Error(`No chat message was created for ${text(item.name, 200)}`);
    });
    return done(`Performed ${text(item.name, 200)}`);
  }
  if (parts[0] === 'spell' && parts.length === 3) {
    const spell = list(actor.itemTypes?.spell).find((i) => i.id === parts[2]);
    const entry = spell && castableEntry(actor, spell);
    if (!spell || !entry || spellEntryId(spell) !== parts[1])
      return invalid('Unknown spell action');
    if (entry.isRitual === true) {
      // RitualSpellcasting#cast (pf2e.mjs:33922-33928) has no slots, uses or focus cost: it only
      // posts the spell via toMessage with actualCast. Replicate that with `create: false` so the
      // message carries callOptions. Nothing is spent, so nothing is snapshotted or disclosed.
      await auditedChat(context, async (record) => {
        const made = await postMessage(
          await spell.toMessage(undefined, { actualCast: true, create: false }),
          context,
          record,
          { renderSheet: false },
        );
        if (!made) throw new Error(`No chat message was created for ${text(spell.name, 200)}`);
      });
      return done(`Cast ${text(spell.name, 200)}`);
    }
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
    const spends = spellSpends(entry, spell);
    const spentNote = spends ? `. The ${spends} spent cannot be undone` : '';
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
        // Return, not throw: invokeAdapter turns a throw into a generic invalid-result error that
        // would hide the spend disclosure and invite a retry that spends again.
        return {
          failure: `Casting ${text(spell.name, 200)} failed${
            spends ? ` after its ${spends} was spent and cannot be undone` : ''
          }: ${text((e as Error)?.message, 300)}`,
        };
      }
      return true;
    });
    if (typeof cast === 'object') return { completed: false, message: cast.failure.slice(0, 2000) };
    if (!cast)
      return {
        completed: false,
        message: `Could not cast ${text(spell.name, 200)}: no slot or focus point available`,
      };
    return done(`Cast ${text(spell.name, 200)}${spentNote}`);
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

/**
 * What pf2e's deletion of a condition would do (processGrantDeletions, pf2e.mjs:45387-45412,
 * called from :45773-45789): the Items it cascade-deletes with it (items it granted, and its
 * granter when that grant cascades), or a refusal when a `restrict` grant forbids the removal
 * (:45389-45403). A refused removal deletes nothing.
 */
function deletionPlan(actor: any, condition: any): { targets: string[]; refused: boolean } {
  const pending: any[] = [condition];
  let refused = false;
  const visit = (item: any) => {
    if (refused) return;
    const get = (id: unknown) => actor.items?.get?.(id ?? '');
    const granter = get(item.flags?.pf2e?.grantedBy?.id);
    const grant = Object.values(granter?.flags?.pf2e?.itemGrants ?? {}).find(
      (g: any) => g?.id === item.id,
    ) as any;
    const children = (Object.values(item.flags?.pf2e?.itemGrants ?? {}) as any[])
      .map((g) => get(g?.id))
      .filter((c) => c?.flags?.pf2e?.grantedBy?.id === item.id);
    if (granter && grant?.onDelete === 'restrict' && !pending.includes(granter)) refused = true;
    if (
      children.some((c) => c.flags.pf2e.grantedBy.onDelete === 'restrict' && !pending.includes(c))
    )
      refused = true;
    if (refused || pending.length >= 64) return;
    if (granter && grant?.onDelete === 'cascade' && !pending.includes(granter)) {
      pending.push(granter);
      visit(granter);
    }
    for (const c of children)
      if (c.flags.pf2e.grantedBy.onDelete === 'cascade' && !pending.includes(c)) {
        pending.push(c);
        visit(c);
      }
  };
  visit(condition);
  return {
    refused,
    targets: refused
      ? []
      : pending.map((i) => i.uuid).filter((u): u is string => typeof u === 'string' && !!u),
  };
}

async function conditions(actor: any, change?: ConditionChange, context?: AdapterExecutionContext) {
  if (change !== undefined) {
    if (!SLUG.test(change.id)) return invalid('Unknown condition');
    if (change.id === 'persistent-damage')
      return invalid('Persistent damage cannot be changed through this tool');
    const known = game.pf2e?.ConditionManager?.getCondition?.(change.id);
    if (!known) return invalid('Unknown condition');
    if (typeof context?.snapshot !== 'function') throw new Error('Audit context unavailable');
    const existing = list(actor.itemTypes?.condition).find(
      (c) => c.slug === change.id && c.active !== false,
    );
    const value = change.value;
    // pf2e's condition API (increaseCondition, decreaseCondition, updateConditionValue;
    // pf2e.mjs:33531-33561, :48967) accepts no document options, so callOptions cannot reach its
    // writes and the change is not undoable. Enrol the Items it changes or cascade-deletes so
    // they go stale and Undo refuses them instead of half-restoring.
    if (!change.active || value === 0) {
      if (existing) {
        const plan = deletionPlan(actor, existing);
        // pf2e would cancel the deletion (a restrict grant), so nothing changes: report the
        // unchanged conditions without snapshotting or calling it.
        if (!plan.refused) {
          for (const uuid of plan.targets) await context.snapshot(uuid);
          await actor.decreaseCondition(change.id, { forceRemove: true });
        }
      }
    } else if (!existing) {
      // Native increaseCondition reuses an inactive unlocked same-slug condition when a value is
      // given (pf2e.mjs:33547-33549), so this may update an Item rather than create one.
      await actor.increaseCondition(change.id, value ? { value } : {});
    } else if (value !== undefined && num(existing.system?.value?.value) !== undefined) {
      if (existing.system.value.value !== value) {
        // updateConditionValue (pf2e.mjs:48967-48975) touches only the condition Item.
        if (typeof existing.uuid === 'string') await context.snapshot(existing.uuid);
        await game.pf2e.ConditionManager.updateConditionValue(existing.id, actor, value);
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
