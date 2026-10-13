/* eslint-disable @typescript-eslint/no-explicit-any */
import type {
  ChoiceDecision,
  EmbedHook,
  EmbedInput,
  EmbedObservation,
  EmbedOverrides,
  EmbedRunInput,
} from '../embed.js';
import { invalid } from '../../tools/_write.js';
import {
  MAX_CHOICES,
  choiceFlag,
  choiceWrapperError,
  choiceWrapperInstalled,
  describeChoice,
  resolveChoices,
  withChoiceCall,
  makeInflater,
  type FoundChoice,
  type Inflater,
  type ListedChoice,
} from './choices.js';

declare const fromUuid: (uuid: string) => Promise<any>;
declare const Hooks: any;

/**
 * Item types with physical state (quantity and carry type). Feats take a slot instead.
 */
const PHYSICAL = new Set([
  'ammo',
  'armor',
  'backpack',
  'book',
  'consumable',
  'equipment',
  'shield',
  'treasure',
  'weapon',
]);
/** Grant chains deeper than this, or resolving more documents than MAX_DOCS, are refused. */
const MAX_DEPTH = 2;
const MAX_DOCS = 32;
const label = (src: any): string => `"${String(src?.name ?? 'unnamed').slice(0, 80)}"`;
const isPlain = (v: unknown): v is Record<string, any> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const keyIs = (rule: any, name: string): boolean =>
  typeof rule?.key === 'string' && (rule.key === name || rule.key.endsWith(`.${name}`));

interface ScanCtx {
  readonly decisions: readonly ChoiceDecision[];
  /** Listing mode: a grant that depends on an unanswered choice is skipped, not refused. */
  readonly lenient: boolean;
  skipped: number;
  readonly inflate: Inflater;
  readonly found: FoundChoice[];
  readonly user?: unknown;
}

/** Grant UUIDs an item source names: GrantItem rules and a class-style `system.items` map. */
function grantUuids(src: any, srcUuid: string, rules: any[], scan: ScanCtx): string[] {
  const out: string[] = [];
  for (const rule of rules) {
    if (!keyIs(rule, 'GrantItem') || typeof rule.uuid !== 'string') continue;
    const uuid = substituteSelection(rule.uuid, rules, src, srcUuid, scan);
    if (uuid !== undefined) out.push(uuid);
  }
  // Class, background and kit `system.items`; a kit's backpack entries nest further `items`.
  const pending: any[] = isPlain(src?.system?.items) ? Object.values(src.system.items) : [];
  for (let seen = 0; pending.length && seen < 256; seen++) {
    const entry = pending.pop();
    if (typeof entry?.uuid === 'string') out.push(entry.uuid);
    if (isPlain(entry?.items)) pending.push(...Object.values(entry.items));
  }
  // Fail closed: an unscanned entry could hide a ChoiceSet that would open a prompt.
  if (pending.length) invalid(`${label(src)}: more than 256 grant entries cannot be scanned`);
  return out;
}
/**
 * `{item|flags.pf2e.rulesSelections.x}` (or the `flags.system` alias) resolves to a preselected ChoiceSet, or else to the
 * agent's decision for that flag (validated against the choice's options afterwards). Otherwise
 * refuse, or in listing mode skip the grant.
 */
function substituteSelection(
  uuid: string,
  rules: any[],
  src: any,
  srcUuid: string,
  scan: ScanCtx,
): string | undefined {
  if (!uuid.includes('{')) return uuid;
  // pf2e resolves `{item|path}` with getProperty on the item (pf2e.mjs:31822-31850); the item's
  // system flags are reachable as `flags.pf2e` and as the alias `flags.system`.
  const m = /^\{item\|flags\.(?:pf2e|system)\.rulesSelections\.([A-Za-z0-9_-]{1,64})\}$/.exec(uuid);
  const choice = m
    ? rules.find(
        (r) => keyIs(r, 'ChoiceSet') && choiceFlag(r, src?.name, src?.system?.slug) === m[1],
      )
    : undefined;
  if (choice && typeof choice.selection === 'string') return choice.selection;
  const decided = choice
    ? scan.decisions.find(
        (d) => d.flag === m![1] && (d.itemUuid === undefined || d.itemUuid === srcUuid),
      )
    : undefined;
  // Only a value the choice itself offers may be loaded; anything else (or a choice whose options
  // are unknown until created) is treated as unresolved, never fetched.
  const offered = decided
    ? scan.found.find((c) => c.itemUuid === srcUuid.slice(0, 500) && c.flag === decided.flag)
    : undefined;
  if (
    decided &&
    offered &&
    !offered.dynamic &&
    !offered.unsupported &&
    offered.values?.has(decided.value)
  )
    return decided.value;
  if (scan.lenient) {
    scan.skipped += 1;
    return undefined;
  }
  return invalid(`${label(src)}: GrantItem uuid ${uuid.slice(0, 80)} cannot be resolved headless`);
}

/** True only for a known user who can observe the document and its pack. */
function docVisible(doc: any, user: unknown): boolean {
  if (user === undefined || user === null) return false;
  const g = globalThis as any;
  const pack = typeof doc?.pack === 'string' ? g.game?.packs?.get(doc.pack) : undefined;
  for (const d of [doc, pack])
    if (
      typeof d?.testUserPermission === 'function' &&
      d.testUserPermission(user, 'OBSERVER') !== true
    )
      return false;
  return true;
}

/** Collect the ChoiceSet rules that still need an answer; refuse the other unanswerable prompts. */
async function checkSource(
  src: any,
  uuid: string,
  found: FoundChoice[],
  scan: ScanCtx,
): Promise<string[]> {
  const rules: any[] = Array.isArray(src?.system?.rules) ? src.system.rules : [];
  for (const rule of rules) {
    if (!keyIs(rule, 'ChoiceSet')) continue;
    if (typeof rule.selection === 'string' || typeof rule.selection === 'number') continue;
    if (found.length >= MAX_CHOICES)
      invalid(`More than ${MAX_CHOICES} ChoiceSet rules need answers`);
    found.push(await describeChoice(rule, src, uuid, scan.inflate));
  }
  const sys = src?.system;
  if (src?.type === 'ammo' && sys?.craftableAs != null && !sys.baseItem)
    invalid(
      `${label(src)}: ammunition with craftableAs needs system.baseItem, which cannot be prompted`,
    );
  return grantUuids(src, uuid, rules, scan);
}
/**
 * Walk the grants the native create would add, refusing anything that would open a prompt other
 * than a ChoiceSet, and return every ChoiceSet that still needs an answer. Each carries the
 * label of the item it belongs to, for messages.
 */
export async function scanHeadless(
  root: any,
  rootUuid: string,
  options: {
    decisions?: readonly ChoiceDecision[];
    lenient?: boolean;
    /** The real target Actor (import) so actor-dependent filters are evaluated correctly. */
    actor?: unknown;
    user?: unknown;
  } = {},
): Promise<{ found: FoundChoice[]; labels: Map<FoundChoice, string>; skipped: number }> {
  const found: FoundChoice[] = [];
  const scan: ScanCtx = {
    decisions: options.decisions ?? [],
    lenient: options.lenient === true,
    skipped: 0,
    inflate: makeInflater({ actor: options.actor, user: options.user }),
    found,
    user: options.user,
  };
  const seen = new Set<string>();
  const labels = new Map<FoundChoice, string>();
  let docs = 0;
  let level: Array<{ src: any; uuid: string }> = [{ src: root, uuid: rootUuid }];
  for (let depth = 0; level.length; depth++) {
    const next: Array<{ src: any; uuid: string }> = [];
    for (const { src, uuid: srcUuid } of level) {
      const before = found.length;
      const uuids = await checkSource(src, srcUuid, found, scan);
      for (const c of found.slice(before)) labels.set(c, label(src));
      if (uuids.length && depth >= MAX_DEPTH)
        invalid(`${label(src)}: grants nest deeper than ${MAX_DEPTH} levels`);
      for (const uuid of uuids) {
        if (seen.has(uuid)) continue;
        seen.add(uuid);
        if (++docs > MAX_DOCS) invalid(`Grants resolve more than ${MAX_DOCS} documents`);
        const doc = await fromUuid(uuid);
        if (!doc) continue; // The native create skips an unresolvable grant.
        if (!docVisible(doc, options.user)) invalid('A granted item is not available to this user'); // never names the document
        const source = typeof doc.toObject === 'function' ? doc.toObject() : doc._source;
        if (isPlain(source)) next.push({ src: source, uuid });
      }
    }
    level = next;
  }
  return { found, labels, skipped: scan.skipped };
}

/** List the choices a compendium Item source and its grants will ask for. Reads only. */
export async function listChoices(
  source: any,
  uuid: string,
  user?: unknown,
): Promise<{ choices: ListedChoice[]; message?: string }> {
  const { found, skipped } = await scanHeadless(source, uuid, { lenient: true, user });
  const choices = found.map((c) => {
    const listed: Partial<FoundChoice> = { ...c };
    delete listed.values;
    return listed as ListedChoice;
  });
  return {
    choices,
    ...(skipped
      ? {
          message: `${skipped} grant(s) depend on a choice and are not expanded; answer it to see their choices.`,
        }
      : {}),
  };
}

function carryFor(source: any, equipped: boolean): Record<string, unknown> | undefined {
  // pf2e does not persist usage for armor (`wornarmor`) or shields (`held-in-one-hand`); it
  // forces them in prepareBaseData (pf2e.mjs:11338-11346, :50938, :51334). Others keep their source.
  const forced: Record<string, string> = { armor: 'wornarmor', shield: 'held-in-one-hand' };
  const usage = forced[source.type] ?? String(source?.system?.usage?.value ?? '');
  if (/^held-in-/.test(usage))
    return equipped
      ? { carryType: 'held', handsHeld: usage === 'held-in-two-hands' ? 2 : 1 }
      : { carryType: 'worn', handsHeld: 0 };
  // getUsageDetails: `worn` has no slot; `wornarmor`, `worngloves`... name the slot after "worn".
  if (usage === 'worn') return { carryType: equipped ? 'worn' : 'dropped', handsHeld: 0 };
  if (usage.startsWith('worn')) return { carryType: 'worn', handsHeld: 0, inSlot: equipped };
  if (usage === 'carried' || usage === '') {
    if (equipped) return undefined; // Carried items count as equipped already.
    invalid('equipped=false is not supported for an item that is only carried');
  }
  return invalid(`equipped is not supported for usage "${usage.slice(0, 60)}"`);
}

function checkSlot(actor: any, source: any, slot: string): number | undefined {
  const groups: any[] = Array.from(actor?.feats?.values?.() ?? []);
  for (const group of groups) {
    if (!isPlain(group?.slots) || !Object.hasOwn(group.slots, slot)) continue;
    const entry = group.slots[slot];
    if (entry?.feat) invalid(`Feat slot "${slot}" is occupied`);
    // FeatGroup#isFeatValid reads `category` from an Item instance; the same test on the source.
    const supported: unknown[] = Array.isArray(group.supported) ? group.supported : [];
    if (supported.length > 0 && !supported.includes(source.system?.category))
      invalid(`Feat slot "${slot}" does not accept this feat's category`);
    return typeof entry?.level === 'number' ? entry.level : undefined;
  }
  return invalid(`Unknown feat slot "${slot.slice(0, 100)}" for this Actor`);
}

function applyOverrides(
  actor: any,
  source: Record<string, any>,
  { quantity, equipped, slot }: EmbedOverrides,
): void {
  const physical = PHYSICAL.has(source.type);
  if (quantity !== undefined) {
    if (!physical) invalid(`quantity is only supported for physical items, not ${source.type}`);
    (source.system ??= {}).quantity = quantity;
  }
  if (equipped !== undefined) {
    if (!physical) invalid(`equipped is only supported for physical items, not ${source.type}`);
    const carry = carryFor(source, equipped);
    if (carry) (source.system ??= {}).equipped = carry;
  }
  if (slot !== undefined) {
    if (source.type !== 'feat') invalid(`slot is only supported for feats, not ${source.type}`);
    const level = checkSlot(actor, source, slot);
    const system = (source.system ??= {});
    system.location = slot;
    if (level !== undefined)
      system.level = { ...(isPlain(system.level) ? system.level : {}), taken: level };
  }
}

/**
 * Count Item updates and deletes on this Actor that carry no audit callId, which are the system's
 * own uncorrelated writes (pf2e `itemUpdates`, class replacement). Document hooks, not patching.
 */
function observe(actor: any): EmbedObservation {
  let count = 0;
  const on = (name: string) =>
    Hooks.on(name, (doc: any, ...args: unknown[]) => {
      const options: any = name.startsWith('update') ? args[1] : args[0];
      if (doc?.parent === actor && typeof options?.agentGateway?.callId !== 'string') count += 1;
    });
  const ids: Array<[string, unknown]> = [];
  for (const name of ['updateItem', 'deleteItem']) ids.push([name, on(name)]);
  return {
    finish() {
      for (const [name, id] of ids.splice(0)) Hooks.off(name, id);
      return count;
    },
  };
}

export const pf2eEmbedHook: EmbedHook = Object.freeze({
  systemId: 'pf2e',
  async prepare({
    user,
    actor,
    entry,
    source,
    overrides,
    choices,
    onUnanswered,
  }: EmbedInput): Promise<Record<string, any>> {
    const rootUuid = String(entry?.uuid ?? source?._stats?.compendiumSource ?? '');
    const { found, labels } = await scanHeadless(source, rootUuid, {
      decisions: choices ?? [],
      actor,
      user,
    });
    const decisions = choices ?? [];
    resolveChoices(
      found,
      decisions,
      onUnanswered ?? 'reject',
      (c) => labels.get(c) ?? label(source),
    );
    // Anything left to answer (or ignore) needs the wrapper; without it nothing may reach a prompt.
    if ((found.length || decisions.length) && !choiceWrapperInstalled())
      invalid(`${label(source)}: choices cannot be answered: ${choiceWrapperError()}`);
    applyOverrides(actor, source, overrides);
    return source;
  },
  async run<T>(input: EmbedRunInput, create: () => Promise<T>) {
    // No wrapper (a non-choice item on a system whose install failed): the create is unchanged.
    if (!choiceWrapperInstalled()) return { value: await create(), report: [], timedOut: false };
    return withChoiceCall(input.callId, String(input.actor?.id ?? ''), input.choices ?? [], create);
  },
  observe,
});
