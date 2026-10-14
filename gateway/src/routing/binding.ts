import { safeText } from './sanitize.js';
import type { LinkConnection, LinkRegistry } from '../link/index.js';

export interface UserSelector {
  /** World id. */
  world?: string | undefined;
  /** Foundry user id or recorded user name. */
  user?: string | undefined;
  /** The user is a Foundry user id from a credential's grant: never fall back to a name match. */
  exactId?: boolean | undefined;
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

/** How long the bound pair must be gone before a call may move to the only other connected pair. */
export const REBIND_GRACE_MS = 30_000;

export interface BindingHooks {
  /** Follow mode moved the session from one pairing to another. */
  onRebind?: (from: Identity, to: Identity) => void;
  /** Follow mode dropped a binding because the pairing was revoked. */
  onUnbind?: (from: Identity) => void;
  now?: () => number;
}

/**
 * Binds one MCP session to one (worldId, userId) pair.
 *
 * With `--user` the pair is fixed the first time a connection is chosen and never changes: if
 * that connection goes away the session is offline until the same pair reconnects, with no
 * fallback to another user.
 *
 * Without `--user` the session follows the one pairing that is connected (see `resolveFollow`).
 * State is a handful of scalars, so it is bounded however often pairings come and go.
 */
export class SessionBinding {
  private bound: BoundPair | undefined;
  private boundWho: Identity | undefined;
  /** When the bound pair was first seen without a connection; follow mode only. */
  private lostAt: number | undefined;
  private readonly now: () => number;
  private sawAmbiguity = false;
  private wasOnline = false;
  get offlineEventReady(): boolean {
    return !!this.bound && (this.wasOnline || this.selector.user === this.bound.userId);
  }

  constructor(
    private readonly registry: LinkRegistry,
    private readonly selector: UserSelector = {},
    /** Active paired identities, connected or not: the implicit-binding pool and what names are checked against. */
    private readonly knownIdentities: () => readonly Identity[] = () => [],
    /** Called when the session binds without a user selector. */
    private readonly onImplicitBind?: (who: Identity) => void,
    private readonly hooks: BindingHooks = {},
  ) {
    this.now = hooks.now ?? Date.now;
  }

  /** The identity the session is bound to, with the name recorded at pairing. */
  get identity(): Identity | undefined {
    return this.boundWho;
  }

  private get follow(): boolean {
    return this.selector.user === undefined;
  }

  /** A connection closed. Starts the grace clock if it was the bound pair's; never re-binds. */
  noteDisconnected(c: LinkConnection): void {
    if (!this.follow || !this.bound || idOf(c) !== idOf(this.bound)) return;
    if (!this.live(this.bound)) this.lostAt ??= this.now();
  }

  /**
   * A connection arrived. In follow mode, if the bound pair has none and this is the only
   * connected pairing in the pool, the user has moved (another world): re-bind at once.
   */
  noteConnected(c: LinkConnection): void {
    if (!this.follow || !this.bound) return;
    // The bound pair is back: its next outage starts a fresh grace period.
    if (this.live(this.bound)) {
      if (idOf(c) === idOf(this.bound)) this.lostAt = undefined;
      return;
    }
    const only = this.connectedPool();
    if (only.length === 1 && idOf(only[0]!) === idOf(c)) this.rebind(only[0]!);
  }

  get pair(): BoundPair | undefined {
    return this.bound;
  }

  /**
   * Where the session stands now. `allowBind` is false for disconnect events: losing a
   * connection must never be what binds a session.
   */
  resolve(allowBind = true, allowOfflineExact = false): Resolution {
    if (this.follow) return this.resolveFollow(allowBind, allowOfflineExact);
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
      const implicit = this.selector.user === undefined;
      // An explicit selector binds once its target connects. Without one, the single paired
      // identity is the binding whether or not it is connected yet: never decided by timing.
      const ready =
        only &&
        ((implicit && !allowOfflineExact) ||
          this.registry.get(only.worldId, only.userId) ||
          (allowOfflineExact && this.selector.user === only.userId));
      // A session that has seen several candidates never settles on the survivor.
      if (!allowBind || !only || !ready || this.sawAmbiguity) return { kind: 'unbound' };
      this.bound = { worldId: only.worldId, userId: only.userId };
      this.boundWho = only;
      if (implicit) this.onImplicitBind?.(only);
    }
    const pair = this.bound;
    const conn = this.registry.get(pair.worldId, pair.userId);
    if (conn && !conn.closed) this.wasOnline = true;
    return { kind: 'bound', pair, conn };
  }

  private live(p: BoundPair): LinkConnection | undefined {
    const c = this.registry.get(p.worldId, p.userId);
    return c && !c.closed ? c : undefined;
  }

  /** C: active pairings in the pool that have an open connection. */
  private connectedPool(): Identity[] {
    return this.matching().filter((i) => this.live(i));
  }

  private rebind(to: Identity): void {
    const from = this.boundWho;
    this.setBound(to);
    if (from) this.hooks.onRebind?.(from, to);
  }

  private setBound(to: Identity): void {
    this.bound = { worldId: to.worldId, userId: to.userId };
    this.boundWho = to;
    this.lostAt = undefined;
    this.wasOnline = !!this.live(this.bound);
  }

  private boundResolution(): Resolution {
    const pair = this.bound!;
    const conn = this.live(pair);
    if (conn) {
      this.wasOnline = true;
      this.lostAt = undefined;
    } else this.lostAt ??= this.now();
    return { kind: 'bound', pair, conn };
  }

  /**
   * Follow mode. K is the active pairings in the pool, C those with an open connection, P the
   * bound pair. An unbound session binds to the only member of C, answers ambiguity for several,
   * and binds to the only member of K when C is empty (so offline queueing still works). A bound
   * session stays on P while P is connected; it moves to the only member of C at once when that
   * pairing connects while P is away, or at a call after P has been away REBIND_GRACE_MS. A
   * disconnect alone never moves it.
   */
  private resolveFollow(allowBind: boolean, allowOfflineExact: boolean): Resolution {
    const k = this.matching();
    const c = k.filter((i) => this.live(i));
    const p = this.bound;
    if (p && this.boundWho) {
      if (k.some((i) => idOf(i) === idOf(p))) {
        const res = this.boundResolution();
        if (res.kind !== 'bound' || res.conn || !allowBind) return res;
        if (c.length > 1) return { kind: 'ambiguous', available: c, permanent: false };
        if (c.length === 1 && this.now() - (this.lostAt ?? this.now()) >= REBIND_GRACE_MS) {
          this.rebind(c[0]!);
          return this.boundResolution();
        }
        return res;
      }
      // Revoked: the session is unbound again.
      if (!allowBind) return { kind: 'bound', pair: p, conn: undefined };
      const gone = this.boundWho;
      this.bound = this.boundWho = this.lostAt = undefined;
      this.wasOnline = false;
      this.hooks.onUnbind?.(gone);
    }
    if (!allowBind) return { kind: 'unbound' };
    if (c.length > 1) return { kind: 'ambiguous', available: c, permanent: false };
    const only = c.length === 1 ? c[0] : k.length === 1 && !allowOfflineExact ? k[0] : undefined;
    if (!only) return { kind: 'unbound' };
    this.setBound(only);
    this.onImplicitBind?.(only);
    return this.boundResolution();
  }

  private matching(): Identity[] {
    const { world, user, exactId } = this.selector;
    // Every active pairing counts, connected or not, so binding never depends on who connects
    // first. Without a user selector only active pairings count, so a pairing revoked while its
    // connection lingers cannot be bound implicitly.
    const byKey = new Map<string, Identity>();
    for (const i of this.knownIdentities()) byKey.set(idOf(i), i);
    if (user !== undefined) for (const c of this.registry.list()) byKey.set(idOf(c), identityOf(c));
    let pool: Identity[] = [...byKey.values()];
    if (world !== undefined) pool = pool.filter((i) => i.worldId === world);
    if (user === undefined) return pool;
    // An exact id match wins over any name match.
    const byId = pool.filter((i) => i.userId === user);
    if (byId.length > 0 || exactId) return byId;
    return pool.filter((i) => i.userName !== '' && i.userName === user);
  }
}

export function describePairs(pairs: readonly Identity[]): string {
  return pairs
    .map((c) => `world ${safeText(c.worldId)} / user ${safeText(c.userName || c.userId)}`)
    .join('; ');
}
