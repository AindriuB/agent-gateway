import { randomBytes } from 'node:crypto';
import type { InviteRow } from '../store/index.js';
import type { InviteClaim } from './invites.js';

/** How long a player has to post the vouch message and an admin GM to attest it. */
export const PAIRING_CHALLENGE_TTL_MS = 120_000;
/** Pending vouches per world, and in all; a hello beyond either gets RATE_LIMITED, unspent. */
export const MAX_PENDING_PAIRINGS_PER_WORLD = 8;
export const MAX_PENDING_PAIRINGS_TOTAL = 64;
/**
 * Attest budgets, per fixed window, known nonce or not.
 *
 * Per attested author: 5. A real player needs one attest, and a few retries (a
 * re-posted message, a flaky link) fit in five; a world member who spams flagged
 * whispers burns only their own five, so another player's vouch still goes through.
 * Per connection (the outer ceiling): 120, i.e. 24 authors' full budgets. One author
 * can never reach it, so exhausting it takes 24 or more colluding accounts in one
 * world, far past the 8 pending pairings a world may hold at once. Over-budget
 * attests from an author are refused before they touch the ceiling.
 * Memory: at most MAX_ATTEST_AUTHORS keys per connection (keys are at most 64 chars
 * by the schema); expired windows are pruned, and a new author is refused while
 * the table is full of live windows.
 */
export const MAX_ATTESTS_PER_AUTHOR = 5;
export const MAX_ATTESTS_PER_WINDOW = 120;
export const MAX_ATTEST_AUTHORS = 256;
export const ATTEST_WINDOW_MS = 60_000;

export interface PendingPairing<H> {
  nonce: string;
  invite: InviteRow;
  claim: InviteClaim;
  /** Client key of the pending socket, charged when a vouch names the wrong author. */
  client: string;
  expiresAt: number;
  /** What the owner needs to finish or refuse the pending socket. */
  handle: H;
}

export type ReserveResult<H> =
  { ok: true; pending: PendingPairing<H> } | { ok: false; reason: 'reserved' | 'capacity' };

/**
 * In-memory pending vouches, bound to an open socket (`owner`). A restart drops them and the
 * invites stay unused. An invite is reserved while it is pending, so a second hello with the same
 * code cannot disturb the first.
 */
export class PendingPairings<H> {
  private readonly byNonce = new Map<string, PendingPairing<H>>();
  private readonly owners = new Map<string, unknown>();
  private readonly reserved = new Set<string>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly caps = {
      perWorld: MAX_PENDING_PAIRINGS_PER_WORLD,
      total: MAX_PENDING_PAIRINGS_TOTAL,
    },
    private readonly ttlMs = PAIRING_CHALLENGE_TTL_MS,
  ) {}

  get size(): number {
    return this.byNonce.size;
  }

  reserve(
    invite: InviteRow,
    claim: InviteClaim,
    client: string,
    owner: unknown,
    handle: H,
  ): ReserveResult<H> {
    this.sweep();
    if (this.reserved.has(invite.id)) return { ok: false, reason: 'reserved' };
    let inWorld = 0;
    for (const p of this.byNonce.values()) if (p.claim.worldId === claim.worldId) inWorld++;
    if (this.byNonce.size >= this.caps.total || inWorld >= this.caps.perWorld)
      return { ok: false, reason: 'capacity' };
    // 128 random bits.
    const nonce = randomBytes(16).toString('base64url');
    const pending = { nonce, invite, claim, client, expiresAt: this.now() + this.ttlMs, handle };
    this.byNonce.set(nonce, pending);
    this.owners.set(nonce, owner);
    this.reserved.add(invite.id);
    return { ok: true, pending };
  }

  /** The live pending vouch for `nonce`; an expired one is not returned (see `sweep`). */
  get(nonce: string): PendingPairing<H> | undefined {
    const p = this.byNonce.get(nonce);
    return p && p.expiresAt > this.now() ? p : undefined;
  }

  /** Remove and return it, releasing the invite reservation. */
  take(nonce: string): PendingPairing<H> | undefined {
    const p = this.byNonce.get(nonce);
    if (!p) return undefined;
    this.byNonce.delete(nonce);
    this.owners.delete(nonce);
    this.reserved.delete(p.invite.id);
    return p;
  }

  /** Drop everything the closed `owner` held. */
  release(owner: unknown): void {
    for (const [nonce, o] of this.owners) if (o === owner) this.take(nonce);
  }

  /** Remove and return the expired ones. */
  sweep(): PendingPairing<H>[] {
    const out: PendingPairing<H>[] = [];
    for (const p of [...this.byNonce.values()]) {
      if (p.expiresAt <= this.now()) {
        const t = this.take(p.nonce);
        if (t) out.push(t);
      }
    }
    return out;
  }

  /** Earliest expiry among the pending, for scheduling the next sweep. */
  nextExpiry(): number | undefined {
    let min: number | undefined;
    for (const p of this.byNonce.values())
      if (min === undefined || p.expiresAt < min) min = p.expiresAt;
    return min;
  }
}

/** Fixed-window counters per attested author, inside an outer per-connection one. */
export class AttestLimiter {
  private start = 0;
  private count = 0;
  private readonly authors = new Map<string, { start: number; count: number }>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly max = MAX_ATTESTS_PER_WINDOW,
    private readonly windowMs = ATTEST_WINDOW_MS,
    private readonly maxPerAuthor = MAX_ATTESTS_PER_AUTHOR,
    private readonly maxAuthors = MAX_ATTEST_AUTHORS,
  ) {}

  allow(authorId: string): boolean {
    const t = this.now();
    let a = this.authors.get(authorId);
    if (!a || t - a.start >= this.windowMs) {
      if (!a && this.authors.size >= this.maxAuthors) {
        for (const [k, v] of this.authors) if (t - v.start >= this.windowMs) this.authors.delete(k);
        if (this.authors.size >= this.maxAuthors) return false;
      }
      a = { start: t, count: 0 };
      this.authors.set(authorId, a);
    }
    if (++a.count > this.maxPerAuthor) return false;
    if (this.count === 0 || t - this.start >= this.windowMs) {
      this.start = t;
      this.count = 0;
    }
    this.count++;
    return this.count <= this.max;
  }
}
