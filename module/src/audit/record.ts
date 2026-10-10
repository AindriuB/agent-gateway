import {
  AUDIT_LIMITS as L,
  type AuditCategory,
  type AuditRecord,
  type AuditTarget,
} from './types.js';

/** Control, bidi-override and zero-width characters: they reorder or hide text when shown. */
const UNSAFE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g;

/** Untrusted text as one bounded line. HTML escaping is the template's job; this removes what escaping cannot. */
export function safeText(value: unknown, cap: number = L.label): string {
  let s: string;
  try {
    s = typeof value === 'string' ? value : value == null ? '' : String(value);
  } catch {
    s = '';
  }
  s = s.replace(UNSAFE, ' ').replace(/\s+/g, ' ').trim();
  return s.length > cap ? `${s.slice(0, cap)}...` : s;
}

/** Multi-line variant for pretty-printed JSON: keeps newlines and indentation. */
export function safeBlock(value: unknown, cap: number): string {
  const s = typeof value === 'string' ? value : '';
  const clean = s.replace(UNSAFE, (c) => (c === '\n' ? '\n' : ' '));
  return clean.length > cap ? `${clean.slice(0, cap)}...` : clean;
}

/**
 * Args as JSON text under hard bounds on depth, breadth, string length, node count and total size.
 * The walk never builds more than `argsNodes` values, whatever the input holds.
 */
export function boundedJson(value: unknown): { text: string; truncated: boolean } {
  let nodes = 0;
  let truncated = false;
  const walk = (v: unknown, depth: number): unknown => {
    if (++nodes > L.argsNodes) {
      truncated = true;
      return '[omitted]';
    }
    if (v === null || typeof v === 'boolean') return v;
    if (typeof v === 'number') return Number.isFinite(v) ? v : String(v);
    if (typeof v === 'string') {
      if (v.length > L.argsString) {
        truncated = true;
        return `${v.slice(0, L.argsString)}...`;
      }
      return v;
    }
    if (typeof v !== 'object') return safeText(String(v), 50);
    if (depth >= L.argsDepth) {
      truncated = true;
      return '[nested]';
    }
    if (Array.isArray(v)) {
      const out = v.slice(0, L.argsBreadth).map((x) => walk(x, depth + 1));
      if (v.length > L.argsBreadth) {
        truncated = true;
        out.push(`[+${v.length - L.argsBreadth} more]`);
      }
      return out;
    }
    const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    const keys = Object.keys(v);
    for (const k of keys.slice(0, L.argsBreadth)) {
      out[k.length > 100 ? `${k.slice(0, 100)}...` : k] = walk(
        (v as Record<string, unknown>)[k],
        depth + 1,
      );
    }
    if (keys.length > L.argsBreadth) {
      truncated = true;
      out['[omitted]'] = keys.length - L.argsBreadth;
    }
    return out;
  };
  let text: string;
  try {
    text = JSON.stringify(walk(value, 0)) ?? 'null';
  } catch {
    return { text: '"[unserialisable]"', truncated: true };
  }
  if (text.length > L.argsChars)
    return { text: `${text.slice(0, L.argsChars)}...`, truncated: true };
  return { text, truncated };
}

/** Serialised size of a snapshot, or Infinity when it cannot be serialised (cycle, depth). */
export function jsonSize(value: unknown): number {
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return Infinity;
  }
}

const CATEGORIES: readonly string[] = ['write', 'destructive', 'code'];
const UUID_OK = /^[A-Za-z0-9_.-]+$/;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** One target from anywhere (a handler or a socket), reduced to the allowed shape and sizes. */
export function sanitiseTarget(raw: unknown, budget: { chars: number }): AuditTarget | null {
  if (!isObject(raw)) return null;
  const uuid = typeof raw.uuid === 'string' ? raw.uuid : '';
  if (!uuid || uuid.length > L.uuid || !UUID_OK.test(uuid)) return null;
  const existed = raw.existed === true;
  let before: Record<string, unknown> | null = null;
  let undoable = raw.undoable === true;
  let note = safeText(raw.note, L.label);
  if (existed) {
    if (isObject(raw.before)) {
      const size = jsonSize(raw.before);
      if (size <= L.beforeChars && size <= budget.chars) {
        before = raw.before;
        budget.chars -= size;
      } else {
        undoable = false;
        note ||= 'snapshot too large to keep';
      }
    } else {
      undoable = false;
      note ||= 'no snapshot';
    }
  }
  const mod = raw.afterModifiedTime;
  return {
    uuid,
    existed,
    before,
    existsAfter: raw.existsAfter === true,
    afterModifiedTime: typeof mod === 'number' && Number.isFinite(mod) ? mod : null,
    undoable,
    note,
  };
}

export interface RecordForce {
  userId: string;
  timestamp: number;
  relayed: boolean;
}

/**
 * Rebuild a record from untrusted input. Identity, time and the relayed flag are forced by the
 * caller (a relayed record takes the socket's attested sender, never a payload field).
 */
export function sanitiseRecord(raw: unknown, force: RecordForce): AuditRecord | null {
  if (!isObject(raw)) return null;
  const entryId = safeText(raw.entryId, 40);
  if (!/^[A-Za-z0-9_-]{8,40}$/.test(entryId)) return null;
  const tool = safeText(raw.tool, L.label);
  if (!tool) return null;
  const category = (
    CATEGORIES.includes(String(raw.category)) ? raw.category : 'write'
  ) as AuditCategory;
  const rawArgs = typeof raw.args === 'string' ? raw.args : '';
  const argsCut = rawArgs.length > L.argsChars;
  const budget = { chars: L.beforeTotalChars };
  const list = Array.isArray(raw.targets) ? raw.targets : [];
  const targets: AuditTarget[] = [];
  for (const t of list.slice(0, L.targets)) {
    const clean = sanitiseTarget(t, budget);
    if (clean) targets.push(clean);
  }
  return {
    entryId,
    timestamp: force.timestamp,
    userId: force.userId,
    agentId: safeText(raw.agentId, L.label),
    tool,
    category,
    args: argsCut ? `${rawArgs.slice(0, L.argsChars)}...` : safeBlock(rawArgs, L.argsChars + 3),
    argsTruncated: raw.argsTruncated === true || argsCut,
    targets,
    targetsDropped:
      (typeof raw.targetsDropped === 'number' && raw.targetsDropped > 0
        ? Math.floor(raw.targetsDropped)
        : 0) + Math.max(0, list.length - L.targets),
    result: safeText(raw.result, L.result),
    status: raw.status === 'error' ? 'error' : 'ok',
    relayed: force.relayed,
  };
}

export function newEntryId(): string {
  const bytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The snapshot of a stored target, or null when it has none or the text is not a JSON object. */
export function decodeBefore(stored: { before?: unknown }): Record<string, unknown> | null {
  if (typeof stored.before !== 'string' || stored.before === '') return null;
  try {
    const v: unknown = JSON.parse(stored.before);
    return isObject(v) ? v : null;
  } catch {
    return null;
  }
}
