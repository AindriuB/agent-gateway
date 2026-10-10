import { safeText } from './sanitize.js';
import type { LinkConnection, LinkRegistry } from '../link/index.js';

export interface UserSelector {
  /** World id. */
  world?: string | undefined;
  /** Foundry user id or recorded user name. */
  user?: string | undefined;
}

export interface BoundPair {
  readonly worldId: string;
  readonly userId: string;
}

/** A paired Foundry user. `userName` is the name recorded at pairing, never a later hello's. */
export interface Identity extends BoundPair {
  readonly userName: string;
}

export type Resolution =
  /** Bound to a pair; `conn` is whatever is connected for exactly that pair right now. */
  | { kind: 'bound'; pair: BoundPair; conn: LinkConnection | undefined }
  /** Not bound, and several identities match with no way to choose. */
  | { kind: 'ambiguous'; available: Identity[]; permanent: boolean }
  /** Not bound, and nothing matches yet. */
  | { kind: 'unbound' };

const idOf = (i: BoundPair): string => JSON.stringify([i.worldId, i.userId]);

export const identityOf = (c: LinkConnection): Identity => ({
  worldId: c.worldId,
  userId: c.userId,
  userName: c.info.userName,
});

/**
 * Binds one MCP session to one (worldId, userId) pair. The pair is fixed the first time a
 * connection is chosen and is never changed afterwards: if that connection goes away the session
 * is offline until the same pair reconnects. There is deliberately no fallback to another user.
 */
export class SessionBinding {
  private bound: BoundPair | undefined;
  private sawAmbiguity = false;

  constructor(
    private readonly registry: LinkRegistry,
    private readonly selector: UserSelector = {},
    /** Paired identities beyond the connected ones, so a name is checked against all of them. */
    private readonly knownIdentities: () => readonly Identity[] = () => [],
    /** Called when the session binds without a user selector. */
    private readonly onImplicitBind?: (conn: LinkConnection) => void,
  ) {}

  get pair(): BoundPair | undefined {
    return this.bound;
  }

  /**
   * Where the session stands now. `allowBind` is false for disconnect events: losing a
   * connection must never be what binds a session.
   */
  resolve(allowBind = true): Resolution {
    if (!this.bound) {
      const matched = this.matching();
      if (matched.length > 1) {
        this.sawAmbiguity = true;
        // Several paired users sharing a name or id stay ambiguous until the operator picks by id.
        return {
          kind: 'ambiguous',
          available: matched,
          permanent: this.selector.user !== undefined,
        };
      }
      const only = matched[0];
      const conn = only ? this.registry.get(only.worldId, only.userId) : undefined;
      // A session that has seen several candidates never settles on the survivor.
      if (!allowBind || !conn || this.sawAmbiguity) return { kind: 'unbound' };
      this.bound = { worldId: conn.worldId, userId: conn.userId };
      if (this.selector.user === undefined) this.onImplicitBind?.(conn);
    }
    const pair = this.bound;
    return { kind: 'bound', pair, conn: this.registry.get(pair.worldId, pair.userId) };
  }

  private matching(): Identity[] {
    const { world, user } = this.selector;
    const connected = this.registry.list().map(identityOf);
    let pool: Identity[] = connected;
    if (user !== undefined) {
      // Names are checked against every paired identity, connected or not.
      const byKey = new Map<string, Identity>();
      for (const i of this.knownIdentities()) byKey.set(idOf(i), i);
      for (const i of connected) byKey.set(idOf(i), i);
      pool = [...byKey.values()];
    }
    if (world !== undefined) pool = pool.filter((i) => i.worldId === world);
    if (user === undefined) return pool;
    // An exact id match wins over any name match.
    const byId = pool.filter((i) => i.userId === user);
    if (byId.length > 0) return byId;
    return pool.filter((i) => i.userName !== '' && i.userName === user);
  }
}

export function describePairs(pairs: readonly Identity[]): string {
  return pairs
    .map((c) => `world ${safeText(c.worldId)} / user ${safeText(c.userName || c.userId)}`)
    .join('; ');
}
