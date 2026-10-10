import { isDecision, type Decision } from './lattice.js';

export const CATEGORIES = ['read', 'write', 'destructive', 'code'] as const;
export type Category = (typeof CATEGORIES)[number];

/** Player agents act as a non-GM user, GM agents as a GM. */
export const AGENT_CLASSES = ['playerAgents', 'gmAgents'] as const;
export type AgentClass = (typeof AGENT_CLASSES)[number];

export type ClassPolicy = Record<Category, Decision>;
export type PolicyMatrix = Record<AgentClass, ClassPolicy>;

/** The GM's ceiling until the GM changes it (spec section 3). */
export const DEFAULT_WORLD_MATRIX: PolicyMatrix = {
  playerAgents: { read: 'allow', write: 'ask_owner', destructive: 'ask_gm', code: 'ask_gm' },
  gmAgents: { read: 'allow', write: 'ask_owner', destructive: 'ask_owner', code: 'ask_owner' },
};

/**
 * The owner's policy until the owner changes it: no tightening beyond the ceiling. Code is never
 * `allow`, so its floor is `ask_owner`.
 */
export const DEFAULT_OWNER_MATRIX: PolicyMatrix = {
  playerAgents: { read: 'allow', write: 'allow', destructive: 'allow', code: 'ask_owner' },
  gmAgents: { read: 'allow', write: 'allow', destructive: 'allow', code: 'ask_owner' },
};

/** What a world policy that cannot be read says: everything denied (fail strict). */
export const DENY_ALL_MATRIX: PolicyMatrix = {
  playerAgents: { read: 'deny', write: 'deny', destructive: 'deny', code: 'deny' },
  gmAgents: { read: 'deny', write: 'deny', destructive: 'deny', code: 'deny' },
};

export class PolicyError extends Error {}

const clone = (m: PolicyMatrix): PolicyMatrix => ({
  playerAgents: { ...m.playerAgents },
  gmAgents: { ...m.gmAgents },
});

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

/**
 * Read a stored matrix. Anything missing or invalid takes the default for that cell, and `code`
 * is never `allow`: a stored `allow` becomes `ask_owner`.
 */
export function loadMatrix(raw: unknown, defaults: PolicyMatrix): PolicyMatrix {
  const out = clone(defaults);
  const top = asObject(raw);
  if (!top) return out;
  for (const cls of AGENT_CLASSES) {
    const row = asObject(top[cls]);
    if (!row) continue;
    for (const cat of CATEGORIES) {
      const v = row[cat];
      if (isDecision(v)) out[cls][cat] = v;
    }
    if (out[cls].code === 'allow') out[cls].code = 'ask_owner';
  }
  return out;
}

/** Check a matrix before it is stored; throws on any invalid or missing cell and on `code: allow`. */
export function validateMatrix(raw: unknown): PolicyMatrix {
  const top = asObject(raw);
  if (!top) throw new PolicyError('Policy must be an object');
  const out = clone(DEFAULT_WORLD_MATRIX);
  for (const cls of AGENT_CLASSES) {
    const row = asObject(top[cls]);
    if (!row) throw new PolicyError(`Policy is missing "${cls}"`);
    for (const cat of CATEGORIES) {
      const v = row[cat];
      if (!isDecision(v)) throw new PolicyError(`Policy ${cls}.${cat} is not a valid decision`);
      if (cat === 'code' && v === 'allow') {
        throw new PolicyError(`Policy ${cls}.code cannot be "allow": code always asks`);
      }
      out[cls][cat] = v;
    }
  }
  return out;
}
