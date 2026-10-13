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
}

const G = globalThis as any;
const isPlain = (v: unknown): v is Record<string, any> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const localize = (text: unknown): string => {
  const raw = String(text ?? '');
  const out = typeof G.game?.i18n?.localize === 'function' ? G.game.i18n.localize(raw) : raw;
  return String(out).slice(0, MAX_LABEL);
};

/** pf2e's default flag (`#setDefaultFlag`): the rule's own, stripped, else the camel-cased slug. */
export function choiceFlag(rule: any, itemName: unknown, itemSlug?: unknown): string {
  if (typeof rule?.flag === 'string' && rule.flag.length > 0)
    return rule.flag.replace(/[^-a-z0-9]/gi, '').slice(0, 64);
  const base = String(rule?.slug ?? itemSlug ?? itemName ?? '');
  const words = base.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return words
    .map((w, i) => (i === 0 ? w : w[0]!.toUpperCase() + w.slice(1)))
    .join('')
    .slice(0, 64);
}

/** Why a ChoiceSet cannot be answered by value, or undefined when it can. */
function unsupportedKind(rule: any): string | undefined {
  const c = rule?.choices;
  if (isPlain(c) && 'query' in c) return 'query choices';
  if (rule?.allowedDrops) return 'drop-in choices';
  if (isPlain(c) && 'attacks' in c) return 'attack choices';
  if (isPlain(c) && 'ownedItems' in c) return 'owned-item choices';
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

/** Describe one unselected ChoiceSet rule of an item source. */
export function describeChoice(rule: any, source: any, itemUuid: string): ListedChoice {
  const flag = choiceFlag(rule, source?.name, source?.system?.slug);
  const base = {
    flag,
    itemUuid: itemUuid.slice(0, 500),
    prompt: localize(rule?.prompt ?? 'PF2E.UI.RuleElements.ChoiceSet.Prompt'),
  };
  const kind = unsupportedKind(rule);
  const options = kind ? undefined : staticOptions(rule);
  if (!options)
    return {
      ...base,
      options: [],
      truncated: false,
      unsupported: kind ?? 'choices that cannot be resolved without an Actor',
    };
  return {
    ...base,
    options: options.slice(0, MAX_OPTIONS),
    truncated: options.length > MAX_OPTIONS,
  };
}

/**
 * Check the agent's answers against the choices found by the grant scan. Refuses (INVALID_ARGS,
 * before any write) a decision that matches nothing, is ambiguous, targets an unsupported kind or
 * names a value outside the options, and, unless `onUnanswered` is `ignore`, any unanswered choice.
 */
export function resolveChoices(
  found: readonly ListedChoice[],
  decisions: readonly ChoiceDecision[],
  onUnanswered: 'reject' | 'ignore',
  labelOf: (choice: ListedChoice) => string,
): void {
  const answered = new Set<ListedChoice>();
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
      if (!c.options.some((o) => o.value === d.value))
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
  readonly expires: number;
}
const registry = new Map<string, CallEntry>();
const MARK = Symbol.for('agent-gateway.pf2e.choiceSetWrapper');
const state: { original?: (...a: any[]) => any; error?: string } = {};

const target = (): any => G.game?.pf2e?.RuleElements?.builtin?.ChoiceSet;
const purge = (now = Date.now()): void => {
  for (const [id, e] of registry) if (e.expires <= now) registry.delete(id);
};
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

async function answer(self: any, args: any, entry: CallEntry): Promise<unknown> {
  const original = state.original!;
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

function wrapper(this: any, args: any): unknown {
  const callId = args?.operation?.agentGateway?.callId;
  const entry = typeof callId === 'string' ? registry.get(callId) : undefined;
  if (
    !entry ||
    entry.expires <= Date.now() ||
    typeof this?.actor?.id !== 'string' ||
    this.actor.id !== entry.actorId
  )
    return state.original!.call(this, args);
  return answer(this, args, entry);
}
(wrapper as any)[MARK] = true;

/**
 * Install the one wrapper. Idempotent: the class is re-resolved each time, a method that is
 * already the wrapper is left alone, and a swapped method is stored as the new original and
 * wrapped. Returns whether it is in place.
 */
export function installChoiceWrapper(): boolean {
  const proto = target()?.prototype;
  const current = proto?.preCreate;
  if (typeof current !== 'function') {
    state.error = 'ChoiceSet.prototype.preCreate is not available';
    return false;
  }
  if (current !== wrapper) {
    state.original = current;
    proto.preCreate = wrapper;
  }
  state.error = undefined;
  return true;
}
/** True while the wrapper is the live method (checked per call; never installs). */
export const choiceWrapperInstalled = (): boolean =>
  typeof state.original === 'function' && target()?.prototype?.preCreate === wrapper;
export const choiceWrapperError = (): string =>
  state.error ?? 'the ChoiceSet wrapper is not installed';

/** Test hook: forget all module state. */
export function resetChoicesForTest(): void {
  registry.clear();
  state.original = undefined;
  state.error = undefined;
}

/**
 * Run `create` with these decisions registered for `callId` and `actorId`, and return its result
 * with the report. The entry is removed on every exit, including a throw or the TTL expiring.
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
  purge();
  if (registry.has(callId)) invalid('This call is already registered for choice answering');
  if (registry.size >= MAX_LIVE_CALLS)
    invalid('Too many concurrent imports are answering choices; try again shortly');
  const entry: CallEntry = {
    callId,
    actorId,
    decisions,
    report: [],
    expires: Date.now() + ttlMs,
  };
  registry.set(callId, entry);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const value = await Promise.race([
      create(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Timed out while creating with choice answers')),
          ttlMs,
        );
      }),
    ]);
    return { value, report: entry.report };
  } finally {
    if (timer) clearTimeout(timer);
    registry.delete(callId);
  }
}

G.Hooks?.once('ready', () => {
  if (G.game?.system?.id === 'pf2e') installChoiceWrapper();
});
