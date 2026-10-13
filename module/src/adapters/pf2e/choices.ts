/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ChoiceDecision, ChoiceReportEntry } from '../embed.js';
import { invalid } from '../../tools/_write.js';

/**
 * Headless answers for pf2e ChoiceSet rule elements.
 *
 * A ChoiceSet's `preCreate` opens a `PickAThingPrompt` on the executing client and waits for a
 * human. One permanent wrapper on `ChoiceSet.prototype.preCreate` (installed once at `ready`)
 * answers a rule only inside a registered agent call, and inside such a call it never prompts.
 * The call is keyed by the audit call id the native create options already carry
 * (`operation.agentGateway.callId`); a spike on pf2e 8.6.0 showed that key reaches the rule for a
 * top-level item, class `system.items` grants and GrantItem children. Anything outside a
 * registered call runs the original method unchanged.
 */

export const MAX_LIVE_CALLS = 8;
export const CALL_TTL_MS = 120_000;
export const MAX_CHOICES = 64;
export const MAX_OPTIONS = 50;
const MAX_LABEL = 200;

/** A ChoiceSet the item (or a grant) will ask for, as the agent sees it. */
export interface ListedChoice {
  flag: string;
  itemUuid: string;
  prompt: string;
  options: Array<{ value: string; label: string }>;
  truncated: boolean;
  /** Set when the gateway cannot answer this kind of choice. */
  unsupported?: string;
  /** True when the options depend on the Actor and are checked when the item is created. */
  dynamic?: boolean;
}
/** A listed choice plus, internally, every valid value (the listing itself is cut at 50). */
export interface FoundChoice extends ListedChoice {
  values?: ReadonlySet<string>;
}
const MAX_VALUES = 5000;

const G = globalThis as any;
const isPlain = (v: unknown): v is Record<string, any> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const localize = (text: unknown): string => {
  const raw = String(text ?? '');
  const out = typeof G.game?.i18n?.localize === 'function' ? G.game.i18n.localize(raw) : raw;
  return String(out).slice(0, MAX_LABEL);
};

// pf2e's `sluggify` (pf2e.mjs:210-221), copied so that default flags agree exactly.
const kt = String.raw`[\p{Alphabetic}\p{Mark}\p{Decimal_Number}\p{Join_Control}]`;
const At = String.raw`[^\p{Alphabetic}\p{Mark}\p{Decimal_Number}\p{Join_Control}]`;
const jt = String.raw`(?=^|$|${kt})`;
const Mt = String.raw`\p{Lowercase_Letter}`;
const Nt = String.raw`\p{Uppercase_Letter}`;
const Pt = new RegExp(At, 'gu');
const Ft = new RegExp(`(${Mt})(${Nt}${jt})`, 'gu');
const It = /[^-\p{White_Space}\p{Alphabetic}\p{Mark}\p{Decimal_Number}\p{Join_Control}]/gu;
const Lt = new RegExp(`${Nt}|${At}${Mt}`, 'gu');
export function sluggify(text: string, camel: 'dromedary' | null = null): string {
  if (text === '-') return text;
  if (camel === 'dromedary')
    return text
      .replace(It, '')
      .replace(/[-_]+/g, ' ')
      .replace(Lt, (m, offset: number) => (offset === 0 ? m.toLowerCase() : m.toUpperCase()))
      .replace(/\s+/g, '');
  return text
    .replace(Ft, '$1-$2')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(Pt, ' ')
    .trim()
    .replace(/[-\s]+/g, '-');
}

/**
 * pf2e's default flag (`#setDefaultFlag`, pf2e.mjs:32053): the rule's own flag stripped to
 * `[-a-z0-9]`, else the dromedary slug of `rule.slug ?? item.slug ?? item.name`. An item without a
 * stored slug has the slug `sluggify(name)`.
 */
export function choiceFlag(rule: any, itemName: unknown, itemSlug?: unknown): string {
  if (typeof rule?.flag === 'string' && rule.flag.length > 0)
    return rule.flag.replace(/[^-a-z0-9]/gi, '').slice(0, 64);
  const slug =
    typeof rule?.slug === 'string' && rule.slug
      ? rule.slug
      : typeof itemSlug === 'string' && itemSlug
        ? itemSlug
        : sluggify(String(itemName ?? ''));
  return sluggify(slug, 'dromedary').slice(0, 64);
}

/** Why a ChoiceSet cannot be answered by value, or undefined when it can. */
function unsupportedKind(rule: any): string | undefined {
  const c = rule?.choices;
  if (isPlain(c) && 'query' in c) return 'query choices';
  if (rule?.allowedDrops) return 'drop-in choices';
  if (isPlain(c) && c.ownedItems && !(Array.isArray(c.types) && c.types.length))
    return 'owned-item choices without types';
  return undefined;
}

function staticOptions(rule: any): Array<{ value: string; label: string }> | undefined {
  const c = rule?.choices;
  const out: Array<{ value: string; label: string }> = [];
  const add = (value: unknown, label: unknown): boolean => {
    if (typeof value !== 'string' && typeof value !== 'number') return false;
    out.push({ value: String(value).slice(0, 500), label: localize(label ?? value) });
    return true;
  };
  if (Array.isArray(c)) {
    for (const o of c) if (!isPlain(o) || !add(o.value, o.label)) return undefined;
    return out;
  }
  const path =
    typeof c === 'string' ? c : isPlain(c) && typeof c.config === 'string' ? c.config : '';
  if (!path) return undefined;
  let node: any = G.CONFIG?.PF2E;
  for (const part of path.split('.')) node = isPlain(node) ? node[part] : undefined;
  if (!isPlain(node)) return undefined;
  for (const [k, v] of Object.entries(node)) {
    if (!add(k, typeof v === 'string' ? v : isPlain(v) ? v.label : k)) return undefined;
  }
  return out;
}

/** Inflates a rule's choices on a temporary Actor and Item. Nothing is written or persisted. */
export type Inflater = (rule: any, source: any) => Promise<unknown[] | undefined>;
export function makeInflater(): Inflater {
  let actor: any;
  return async (rule, source) => {
    try {
      const ActorClass = G.CONFIG?.Actor?.documentClass;
      const ItemClass = G.CONFIG?.Item?.documentClass;
      const RuleClass = target();
      if (!ActorClass || !ItemClass || typeof RuleClass !== 'function') return undefined;
      actor ??= new ActorClass({ name: 'agent-gateway temporary', type: 'character' });
      const item = new ItemClass(structuredClone(source), { parent: actor });
      const instance = new RuleClass(structuredClone(rule), { parent: item });
      const rollOptions = new Set([actor.getRollOptions(), item.getRollOptions('parent')].flat());
      const out = await instance.inflateChoices(rollOptions, []);
      return Array.isArray(out) ? out : undefined;
    } catch {
      return undefined;
    }
  };
}

/** Describe one unselected ChoiceSet rule of an item source. */
export async function describeChoice(
  rule: any,
  source: any,
  itemUuid: string,
  inflate?: Inflater,
): Promise<FoundChoice> {
  const flag = choiceFlag(rule, source?.name, source?.system?.slug);
  const base = {
    flag,
    itemUuid: itemUuid.slice(0, 500),
    prompt: localize(rule?.prompt ?? 'PF2E.UI.RuleElements.ChoiceSet.Prompt'),
  };
  const kind = unsupportedKind(rule);
  if (kind) return { ...base, options: [], truncated: false, unsupported: kind };
  let all = staticOptions(rule);
  if (!all) {
    // Owned items and attacks depend on the real Actor: checked when the item is created.
    const c = rule?.choices;
    const onActor = isPlain(c) && (c.ownedItems || c.attacks || c.unarmedAttacks);
    // A compendium filter: ask pf2e itself, on temporary documents.
    const inflated = onActor ? undefined : await inflate?.(rule, source);
    const list = inflated?.map((o: any) => ({
      value: o?.value,
      label: o?.label,
    }));
    if (
      list &&
      list.length <= MAX_VALUES &&
      list.every((o) => typeof o.value === 'string' || typeof o.value === 'number')
    ) {
      all = list.map((o) => ({
        value: String(o.value).slice(0, 500),
        label: localize(o.label ?? o.value),
      }));
    }
  }
  if (!all) return { ...base, options: [], truncated: false, dynamic: true };
  return {
    ...base,
    options: all.slice(0, MAX_OPTIONS),
    truncated: all.length > MAX_OPTIONS,
    values: new Set(all.map((o) => o.value)),
  };
}

/**
 * Check the agent's answers against the choices found by the grant scan. Refuses (INVALID_ARGS,
 * before any write) a decision that matches nothing, is ambiguous, targets an unsupported kind or
 * names a value outside the options, and, unless `onUnanswered` is `ignore`, any unanswered choice.
 */
export function resolveChoices(
  found: readonly FoundChoice[],
  decisions: readonly ChoiceDecision[],
  onUnanswered: 'reject' | 'ignore',
  labelOf: (choice: FoundChoice) => string,
): void {
  const answered = new Set<FoundChoice>();
  for (const d of decisions) {
    const hits = found.filter(
      (c) => c.flag === d.flag && (d.itemUuid === undefined || c.itemUuid === d.itemUuid),
    );
    if (hits.length === 0)
      invalid(`choice "${d.flag.slice(0, 64)}" matches no ChoiceSet of this item or its grants`);
    if (d.itemUuid === undefined && new Set(hits.map((h) => h.itemUuid)).size > 1)
      invalid(`choice "${d.flag.slice(0, 64)}" is on several items; give itemUuid`);
    for (const c of hits) {
      if (c.unsupported)
        invalid(`${labelOf(c)}: choice "${c.flag}" cannot be answered (${c.unsupported})`);
      // A dynamic choice (depends on the Actor) is checked exactly when the item is created.
      if (!c.dynamic && !(c.values ?? new Set(c.options.map((o) => o.value))).has(d.value))
        invalid(`${labelOf(c)}: value for choice "${c.flag}" is not one of its options`);
      answered.add(c);
    }
  }
  if (onUnanswered === 'ignore') return;
  const missing = found.filter((c) => !answered.has(c));
  if (missing.length)
    invalid(
      missing
        .map(
          (c) =>
            `${labelOf(c)}: ChoiceSet rule "${c.flag}" needs a selection and the gateway cannot answer prompts; supply choices or set onUnanswered "ignore"`,
        )
        .join('; ')
        .slice(0, 1500),
    );
}

// ---- runtime wrapper -------------------------------------------------------------------------

interface CallEntry {
  readonly callId: string;
  readonly actorId: string;
  readonly decisions: readonly ChoiceDecision[];
  readonly report: ChoiceReportEntry[];
}
/**
 * Live calls, and tombstones for calls that timed out while their native create still runs. They
 * live on globalThis so that a wrapper left by an earlier copy of this module reads the same state.
 */
const SHARED = Symbol.for('agent-gateway.pf2e.choiceState');
const shared: { registry: Map<string, CallEntry>; tombstones: Map<string, string> } = (G[SHARED] ??=
  { registry: new Map(), tombstones: new Map() });
const registry = shared.registry;
const tombstones = shared.tombstones;
export const MAX_TOMBSTONES = 32;
const MARK = Symbol.for('agent-gateway.pf2e.choiceSetWrapper');
const HANDLED = Symbol('agent-gateway.pf2e.choiceHandled');
const state: { error?: string } = {};

function target(): any {
  return G.game?.pf2e?.RuleElements?.builtin?.ChoiceSet;
}
/** Timed-out calls whose create is still running (for tests and diagnostics). */
export const choiceTombstones = (): number => tombstones.size;
/** Live call count (for tests and diagnostics). */
export const liveChoiceCalls = (): number => registry.size;

function record(
  entry: CallEntry,
  flag: string,
  itemUuid: string | undefined,
  status: ChoiceReportEntry['status'],
): void {
  if (entry.report.length >= MAX_CHOICES) return;
  entry.report.push(itemUuid ? { flag, itemUuid, status } : { flag, status });
}

const sourceUuid = (rule: any, args: any): string | undefined => {
  const s = args?.itemSource;
  const v = s?._stats?.compendiumSource ?? s?.flags?.core?.sourceId ?? rule?.item?.sourceId;
  return typeof v === 'string' ? v : undefined;
};

async function answer(
  self: any,
  args: any,
  entry: CallEntry,
  original: (...a: any[]) => any,
): Promise<unknown> {
  args[HANDLED] = true;
  const rule = args.ruleSource;
  const uuid = sourceUuid(self, args);
  const ignore = (flag: string, status: ChoiceReportEntry['status']): undefined => {
    if (isPlain(rule)) rule.ignored = true;
    record(entry, flag, uuid, status);
    return undefined;
  };
  const flag =
    typeof self.flag === 'string' && self.flag
      ? self.flag
      : choiceFlag(rule, args?.itemSource?.name);
  const decision = entry.decisions.find(
    (d) => d.flag === flag && (d.itemUuid === undefined || d.itemUuid === uuid),
  );
  // Paths where pf2e itself returns before prompting: run it unchanged.
  const c = self.choices;
  if (self.selection === null && isPlain(c) && 'query' in c) {
    record(entry, flag, uuid, 'unsupported');
    return original.call(self, args);
  }
  if (self.item?.isOfType?.('feat') && self.item.suppressed) return original.call(self, args);
  let rollOptions: Set<unknown>;
  try {
    rollOptions = new Set([self.actor.getRollOptions(), self.item.getRollOptions('parent')].flat());
    if (!self.resolveInjectedProperties(self.predicate).test(rollOptions)) {
      if (decision) record(entry, flag, uuid, 'unsupported');
      return original.call(self, args);
    }
  } catch {
    return ignore(flag, 'unsupported');
  }
  if (isPlain(c) && 'ownedItems' in c && c.ownedItems && !c.types?.length)
    return original.call(self, args);
  if (self.allowedDrops) return ignore(flag, 'unsupported');
  let options: any[];
  try {
    options = await self.inflateChoices(rollOptions, args.tempItems);
  } catch {
    return ignore(flag, 'unsupported');
  }
  if (!Array.isArray(options)) return ignore(flag, 'unsupported');
  if (decision) {
    const hit = options.find(
      (o) =>
        o?.value === decision.value ||
        (typeof o?.value === 'number' && String(o.value) === decision.value),
    );
    if (!hit) return ignore(flag, 'rejected');
    self.selection = hit.value;
    record(entry, flag, uuid, 'answered');
    return original.call(self, args);
  }
  // Preselected in the item source and matching an option: native, no prompt.
  if (self.selection !== null && options.some((o) => o?.value === self.selection))
    return original.call(self, args);
  // No answer: never prompt.
  return ignore(flag, 'unanswered');
}

function makeWrapper(original: (...a: any[]) => any): (...a: any[]) => unknown {
  const wrapper = function (this: any, args: any): unknown {
    if (args?.[HANDLED]) return original.call(this, args);
    const callId = args?.operation?.agentGateway?.callId;
    const actorId = this?.actor?.id;
    if (typeof callId !== 'string' || typeof actorId !== 'string') return original.call(this, args);
    // A call that timed out while its create still runs: never prompt, never answer.
    if (tombstones.get(callId) === actorId) {
      if (isPlain(args?.ruleSource)) args.ruleSource.ignored = true;
      return undefined;
    }
    const entry = registry.get(callId);
    if (!entry || entry.actorId !== actorId) return original.call(this, args);
    return answer(this, args, entry, original);
  };
  (wrapper as any)[MARK] = true;
  return wrapper;
}

/**
 * Install the one wrapper. Idempotent: the class is re-resolved each time, a method that already
 * carries the wrapper marker is left alone (even if it is another copy of this module's), and a
 * swapped method is wrapped as the new original. Returns whether it is in place.
 */
export function installChoiceWrapper(): boolean {
  const proto = target()?.prototype;
  const current = proto?.preCreate;
  if (typeof current !== 'function') {
    state.error = 'ChoiceSet.prototype.preCreate is not available';
    return false;
  }
  if (!current[MARK]) proto.preCreate = makeWrapper(current);
  state.error = undefined;
  return true;
}
/** True while the live method carries the wrapper marker (checked per call; never installs). */
export const choiceWrapperInstalled = (): boolean =>
  typeof target()?.prototype?.preCreate === 'function' &&
  target().prototype.preCreate[MARK] === true;
export const choiceWrapperError = (): string =>
  state.error ?? 'the ChoiceSet wrapper is not installed';

/** Test hook: forget all module state. */
export function resetChoicesForTest(): void {
  registry.clear();
  tombstones.clear();
  state.error = undefined;
}

/**
 * Run `create` with these decisions registered for `callId` and `actorId`, and return its result
 * with the report. The entry is removed on every exit. When the time limit passes while `create`
 * is still running, the call becomes a tombstone (bounded, see MAX_TOMBSTONES): the wrapper then
 * ignores every remaining ChoiceSet of that call, so none can prompt, until `create` settles.
 */
export async function withChoiceCall<T>(
  callId: string,
  actorId: string,
  decisions: readonly ChoiceDecision[],
  create: () => Promise<T>,
  ttlMs = CALL_TTL_MS,
): Promise<{ value: T; report: ChoiceReportEntry[] }> {
  if (!choiceWrapperInstalled())
    invalid(`Choice answering is unavailable: ${choiceWrapperError()}`);
  if (registry.has(callId) || tombstones.has(callId))
    invalid('This call is already registered for choice answering');
  if (registry.size >= MAX_LIVE_CALLS)
    invalid('Too many concurrent imports are answering choices; try again shortly');
  if (tombstones.size >= MAX_TOMBSTONES)
    invalid('Earlier imports that timed out are still finishing; try again shortly');
  const entry: CallEntry = { callId, actorId, decisions, report: [] };
  registry.set(callId, entry);
  const created = (async () => create())();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  try {
    const value = await Promise.race([
      created,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          reject(new Error('Timed out while creating with choice answers'));
        }, ttlMs);
      }),
    ]);
    return { value, report: entry.report };
  } catch (error) {
    if (timedOut) {
      tombstones.set(callId, actorId);
      const done = () => void tombstones.delete(callId);
      created.then(done, done);
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    registry.delete(callId);
  }
}

G.Hooks?.once('ready', () => {
  if (G.game?.system?.id === 'pf2e') installChoiceWrapper();
});
