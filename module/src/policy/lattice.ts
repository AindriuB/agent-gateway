/** The four outcomes a policy can give a call, from most to least permissive. */
export const DECISIONS = ['allow', 'ask_owner', 'ask_gm', 'deny'] as const;
export type Decision = (typeof DECISIONS)[number];

export const isDecision = (v: unknown): v is Decision =>
  typeof v === 'string' && (DECISIONS as readonly string[]).includes(v);

/** Higher is stricter: allow < ask_owner < ask_gm < deny. */
export const strictness = (d: Decision): number => DECISIONS.indexOf(d);

/**
 * Combine the world ceiling with the owner's choice: the stricter of the two. The owner can
 * tighten the ceiling and never loosen it, whatever either value is.
 */
export function combine(world: Decision, owner: Decision): Decision {
  return strictness(owner) > strictness(world) ? owner : world;
}
