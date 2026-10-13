/* eslint-disable @typescript-eslint/no-explicit-any */
import type { EmbedHook, EmbedInput, EmbedObservation, EmbedOverrides } from '../embed.js';
import { invalid } from '../../tools/_write.js';

declare const fromUuid: (uuid: string) => Promise<any>;

/**
 * Item types with physical state (quantity and carry type). Feats take a slot instead.
 */
const PHYSICAL = new Set([
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

/** Grant UUIDs an item source names: GrantItem rules and a class-style `system.items` map. */
function grantUuids(src: any, rules: any[]): string[] {
  const out: string[] = [];
  for (const rule of rules) {
    if (!keyIs(rule, 'GrantItem') || typeof rule.uuid !== 'string') continue;
    out.push(substituteSelection(rule.uuid, rules, src));
  }
  if (isPlain(src?.system?.items))
    for (const entry of Object.values<any>(src.system.items))
      if (typeof entry?.uuid === 'string') out.push(entry.uuid);
  return out;
}
/** `{item|flags.pf2e.rulesSelections.x}` resolves to a preselected ChoiceSet; otherwise refuse. */
function substituteSelection(uuid: string, rules: any[], src: any): string {
  if (!uuid.includes('{')) return uuid;
  const m = /^\{item\|flags\.pf2e\.rulesSelections\.([A-Za-z0-9_-]{1,64})\}$/.exec(uuid);
  const choice = m
    ? rules.find((r) => keyIs(r, 'ChoiceSet') && r.flag === m[1] && typeof r.selection === 'string')
    : undefined;
  if (!choice)
    invalid(`${label(src)}: GrantItem uuid ${uuid.slice(0, 80)} cannot be resolved headless`);
  return choice.selection;
}
function checkSource(src: any): string[] {
  const rules: any[] = Array.isArray(src?.system?.rules) ? src.system.rules : [];
  for (const rule of rules) {
    if (!keyIs(rule, 'ChoiceSet')) continue;
    if (rule.selection === undefined || rule.selection === null)
      invalid(
        `${label(src)}: ChoiceSet rule${typeof rule.flag === 'string' ? ` "${rule.flag.slice(0, 40)}"` : ''} needs a selection and the gateway cannot answer prompts`,
      );
  }
  const sys = src?.system;
  if (src?.type === 'ammo' && sys?.craftableAs != null && !sys.baseItem)
    invalid(
      `${label(src)}: ammunition with craftableAs needs system.baseItem, which cannot be prompted`,
    );
  return grantUuids(src, rules);
}
/** Walk the grants the native create would add, refusing anything that would open a prompt. */
async function scanHeadless(root: any): Promise<void> {
  const seen = new Set<string>();
  let docs = 0;
  let level: any[] = [root];
  for (let depth = 0; level.length; depth++) {
    const next: any[] = [];
    for (const src of level) {
      const uuids = checkSource(src);
      if (uuids.length && depth >= MAX_DEPTH)
        invalid(`${label(src)}: grants nest deeper than ${MAX_DEPTH} levels`);
      for (const uuid of uuids) {
        if (seen.has(uuid)) continue;
        seen.add(uuid);
        if (++docs > MAX_DOCS) invalid(`Grants resolve more than ${MAX_DOCS} documents`);
        const doc = await fromUuid(uuid);
        if (!doc) continue; // The native create skips an unresolvable grant.
        const source = typeof doc.toObject === 'function' ? doc.toObject() : doc._source;
        if (isPlain(source)) next.push(source);
      }
    }
    level = next;
  }
}

function carryFor(source: any, equipped: boolean): Record<string, unknown> | undefined {
  const usage = String(source?.system?.usage?.value ?? '');
  const held =
    /^held-in-(one|two)-hands?$/.exec(usage) ?? (/^held-in-/.test(usage) ? ['', 'one'] : null);
  if (held)
    return equipped
      ? { carryType: 'held', handsHeld: held[1] === 'two' ? 2 : 1 }
      : { carryType: 'worn', handsHeld: 0 };
  if (usage === 'worn') return { carryType: equipped ? 'worn' : 'dropped', handsHeld: 0 };
  if (usage.startsWith('worn-'))
    return equipped
      ? { carryType: 'worn', handsHeld: 0, inSlot: true }
      : { carryType: 'worn', handsHeld: 0, inSlot: false };
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
    if (typeof group.isFeatValid === 'function' && group.isFeatValid(source) !== true)
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

function observe(actor: any): EmbedObservation {
  let count = 0;
  const restore: Array<() => void> = [];
  for (const method of ['updateEmbeddedDocuments', 'deleteEmbeddedDocuments']) {
    const original = actor?.[method];
    if (typeof original !== 'function') continue;
    const own = Object.hasOwn(actor, method);
    actor[method] = function (this: unknown, ...args: any[]) {
      if (typeof args[2]?.agentGateway?.callId !== 'string') count += 1;
      return original.apply(this, args);
    };
    restore.push(() => {
      if (own) actor[method] = original;
      else delete actor[method];
    });
  }
  return {
    finish() {
      for (const undo of restore) undo();
      restore.length = 0;
      return count;
    },
  };
}

export const pf2eEmbedHook: EmbedHook = Object.freeze({
  systemId: 'pf2e',
  async prepare({ actor, entry, source, overrides }: EmbedInput): Promise<Record<string, any>> {
    void entry;
    await scanHeadless(source);
    applyOverrides(actor, source, overrides);
    return source;
  },
  observe,
});
