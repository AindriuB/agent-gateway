import { AGENT_CLASSES, type AgentClass } from '../policy/matrix.js';

/** `destructive` and `code` calls count against `write`. */
export const BUCKETS = ['read', 'write'] as const;
export type Bucket = (typeof BUCKETS)[number];

export type ClassLimits = Record<Bucket, number>;
export type StoredLimits = {
  playerAgents: ClassLimits;
  gmAgents: ClassLimits;
  /** Per-agent overrides keyed by agentId; a bucket left out inherits the class limit. */
  agents: Record<string, Partial<ClassLimits>>;
};

export const WINDOW_MS = 60_000;
export const MAX_LIMIT = 10_000;
/**
 * What anything unreadable or invalid becomes: one call per minute. It is the most restrictive
 * limit that still lets a GM see the agent work and diagnose the setting. Zero would be a silent
 * block, and blocking a category is the policy's job (deny), not the limiter's; unlimited is never
 * the answer to a bad setting.
 */
export const STRICT_LIMIT = 1;

export const DEFAULT_LIMITS: StoredLimits = {
  playerAgents: { read: 60, write: 10 },
  gmAgents: { read: 60, write: 10 },
  agents: {},
};

export class RateLimitConfigError extends Error {}

/** The bucket a tool category is charged to; an unknown category is charged as a write. */
export function bucketFor(category: string | undefined): Bucket {
  return category === 'read' ? 'read' : 'write';
}

export const isValidLimit = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= MAX_LIMIT;

const asObject = (raw: unknown): Record<string, unknown> | undefined => {
  let v = raw;
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v);
    } catch {
      return undefined;
    }
  }
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
};

/** The limits as the stage uses them. Per-agent overrides sit in a Map so ids like `__proto__` are plain keys. */
export interface LoadedLimits {
  classes: Record<AgentClass, ClassLimits>;
  agents: Map<string, Partial<ClassLimits>>;
  /** The overrides block could not be read, so no agent can be told apart: all get STRICT_LIMIT. */
  agentsCorrupt: boolean;
}

const cell = (v: unknown): number => (isValidLimit(v) ? v : STRICT_LIMIT);
const own = (o: Record<string, unknown>, k: string): boolean => Object.hasOwn(o, k);

/**
 * Read stored limits. Fail strict, like the world policy: a setting that is unparseable or not an
 * object, or a class, bucket or override that is missing or invalid, takes STRICT_LIMIT, never a
 * default and never unlimited. Only an override's absent bucket inherits its class limit.
 */
export function loadLimits(raw: unknown): LoadedLimits {
  const root = asObject(raw);
  const classes = {} as Record<AgentClass, ClassLimits>;
  for (const cls of AGENT_CLASSES) {
    const c = root && own(root, cls) ? asObject(root[cls]) : undefined;
    classes[cls] = {
      read: cell(c && own(c, 'read') ? c.read : undefined),
      write: cell(c && own(c, 'write') ? c.write : undefined),
    };
  }
  const agents = new Map<string, Partial<ClassLimits>>();
  if (!root) return { classes, agents, agentsCorrupt: true };
  if (!own(root, 'agents') || root.agents === undefined) {
    return { classes, agents, agentsCorrupt: false };
  }
  const block = asObject(root.agents);
  if (!block) return { classes, agents, agentsCorrupt: true };
  for (const [id, v] of Object.entries(block)) {
    const o = asObject(v);
    if (!o) {
      agents.set(id, { read: STRICT_LIMIT, write: STRICT_LIMIT });
      continue;
    }
    const entry: Partial<ClassLimits> = {};
    for (const b of BUCKETS) if (own(o, b)) entry[b] = cell(o[b]);
    agents.set(id, entry);
  }
  return { classes, agents, agentsCorrupt: false };
}

/** The per-minute limit for one agent and bucket: its override, else its class limit. */
export function resolveLimit(
  limits: LoadedLimits,
  agentClass: AgentClass,
  agentId: string,
  bucket: Bucket,
): number {
  if (limits.agentsCorrupt) return STRICT_LIMIT;
  return limits.agents.get(agentId)?.[bucket] ?? limits.classes[agentClass][bucket];
}

/** Throws on anything `loadLimits` would have to repair; used before a GM's edit reaches storage. */
export function validateLimits(input: unknown): StoredLimits {
  const root = asObject(input);
  if (!root) throw new RateLimitConfigError('rate limits must be an object');
  const classLimits = (v: unknown, where: string, partial: boolean): Partial<ClassLimits> => {
    const o = asObject(v);
    if (!o) throw new RateLimitConfigError(`${where} must be an object`);
    const out: Partial<ClassLimits> = {};
    for (const k of Object.keys(o)) {
      if (!(BUCKETS as readonly string[]).includes(k)) {
        throw new RateLimitConfigError(`${where}.${k} is not a bucket`);
      }
    }
    for (const b of BUCKETS) {
      if (!own(o, b)) {
        if (partial) continue;
        throw new RateLimitConfigError(`${where}.${b} is required`);
      }
      if (!isValidLimit(o[b])) {
        throw new RateLimitConfigError(`${where}.${b} must be an integer from 1 to ${MAX_LIMIT}`);
      }
      out[b] = o[b];
    }
    return out;
  };
  for (const k of Object.keys(root)) {
    if (k !== 'agents' && !(AGENT_CLASSES as readonly string[]).includes(k)) {
      throw new RateLimitConfigError(`${k} is not a class`);
    }
  }
  const agents: Record<string, Partial<ClassLimits>> = {};
  const block = own(root, 'agents') ? asObject(root.agents) : {};
  if (!block) throw new RateLimitConfigError('agents must be an object');
  for (const [id, v] of Object.entries(block)) {
    Object.defineProperty(agents, id, {
      value: classLimits(v, `agents.${id}`, true),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return {
    playerAgents: classLimits(root.playerAgents, 'playerAgents', false) as ClassLimits,
    gmAgents: classLimits(root.gmAgents, 'gmAgents', false) as ClassLimits,
    agents,
  };
}
