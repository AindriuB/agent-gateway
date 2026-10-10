import type { LinkConnection, LinkRegistry } from '../link/index.js';

export interface UserSelector {
  /** World id. */
  world?: string | undefined;
  /** Foundry user name or id. */
  user?: string | undefined;
}

export interface BoundPair {
  readonly worldId: string;
  readonly userId: string;
}

export type Resolution =
  /** Bound to a pair; `conn` is whatever is connected for exactly that pair right now. */
  | { kind: 'bound'; pair: BoundPair; conn: LinkConnection | undefined }
  /** Not bound, and several connections match with no way to choose. */
  | { kind: 'ambiguous'; available: LinkConnection[] }
  /** Not bound, and nothing matches yet. */
  | { kind: 'unbound' };

/**
 * Binds one MCP session to one (worldId, userId) pair. The pair is fixed the first time a
 * connection is chosen and is never changed afterwards: if that connection goes away the session
 * is offline until the same pair reconnects. There is deliberately no fallback to another user.
 */
export class SessionBinding {
  private bound: BoundPair | undefined;

  constructor(
    private readonly registry: LinkRegistry,
    private readonly selector: UserSelector = {},
  ) {}

  get pair(): BoundPair | undefined {
    return this.bound;
  }

  resolve(): Resolution {
    if (!this.bound) {
      const candidates = this.registry.list().filter((c) => this.matches(c));
      // With no selector this is "exactly one connection exists"; with one, a single match binds.
      if (candidates.length === 1 && candidates[0]) {
        this.bound = pairOf(candidates[0]);
      } else if (candidates.length > 1) {
        return { kind: 'ambiguous', available: candidates };
      } else {
        return { kind: 'unbound' };
      }
    }
    const pair = this.bound;
    return { kind: 'bound', pair, conn: this.registry.get(pair.worldId, pair.userId) };
  }

  private matches(c: LinkConnection): boolean {
    const { world, user } = this.selector;
    if (world !== undefined && c.worldId !== world) return false;
    if (user !== undefined && c.userId !== user && c.info.userName !== user) return false;
    return true;
  }
}

export const pairOf = (c: LinkConnection): BoundPair => ({
  worldId: c.worldId,
  userId: c.userId,
});

export function describePairs(pairs: readonly LinkConnection[]): string {
  return pairs.map((c) => `world ${c.worldId} / user ${c.info.userName || c.userId}`).join('; ');
}
