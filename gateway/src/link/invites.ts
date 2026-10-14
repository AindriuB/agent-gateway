import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import type { InviteRow, PairingRow, Store } from '../store/index.js';
import { PAIRING_ALPHABET } from './pairing-codes.js';

/** Three groups of four from the pairing alphabet: about 59 bits. */
export const INVITE_CODE_PATTERN = /^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/;
export const INVITE_TTL_MS = 24 * 60 * 60 * 1000;
export const MAX_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Who a hello says it is, as a redeem sees it. */
export interface InviteClaim {
  worldId: string;
  userId: string;
  /** Display only; already sanitized by the caller. */
  userName: string;
  origin: string;
}

/**
 * An in-memory invite source (task 37's headless runner mints these): single use, bound to a
 * target. Checked in both modes, before the shared code and database invites.
 */
export interface MemoryInviteProvider {
  /** `match` spends the invite; `mismatch` spends it too; `unknown` is not ours. */
  redeem(
    code: string,
    claim: { worldId: string; userId: string; origin: string },
  ): 'match' | 'mismatch' | 'unknown';
}

export const generateInviteCode = (): string => {
  const chars = Array.from(
    { length: 12 },
    () => PAIRING_ALPHABET[randomInt(PAIRING_ALPHABET.length)],
  );
  return [0, 4, 8].map((i) => chars.slice(i, i + 4).join('')).join('-');
};

export const hashInviteCode = (code: string): string =>
  createHash('sha256').update(code.trim().toUpperCase()).digest('hex');

/** `30m`, `12h` or `7d`, at most 7 days; anything else is undefined. */
export function parseTtl(value: string): number | undefined {
  const m = /^(\d{1,6})([mhd])$/.exec(value);
  if (!m) return undefined;
  const unit = { m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2] as 'm' | 'h' | 'd'];
  const ms = Number(m[1]) * unit;
  return ms > 0 && ms <= MAX_INVITE_TTL_MS ? ms : undefined;
}

/** Store a new invite and return its code, which exists nowhere else. Call inside a transaction. */
export function createInvite(
  store: Store,
  target: {
    worldId: string;
    userId: string;
    origin?: string | undefined;
    ttlMs?: number;
    /** Operator invite that pairs an admin GM with no vouch. Operator only. */
    admin?: boolean;
    /** Operator invite for a GM user, paired with no vouch. Operator only. */
    gm?: boolean;
    /** Who minted it; null/absent is the operator. A delegated invite can never be admin or gm. */
    createdBy?: string | null;
  },
  now: number,
): { code: string; id: string; expiresAt: number } {
  if ((target.createdBy ?? null) !== null && (target.admin === true || target.gm === true))
    throw new Error('only the operator can mint an invite that skips the vouch');
  const code = generateInviteCode();
  const id = randomUUID();
  const expiresAt = now + (target.ttlMs ?? INVITE_TTL_MS);
  store.invites.create({
    id,
    codeHash: hashInviteCode(code),
    worldId: target.worldId,
    userId: target.userId,
    origin: target.origin ?? null,
    expiresAt,
    admin: target.admin === true,
    gm: target.gm === true,
    createdBy: target.createdBy ?? null,
  });
  return { code, id, expiresAt };
}

export type PairingOutcome =
  | { ok: true; pairing: PairingRow; token: string; replaced: PairingRow[] }
  | { ok: false; reason: 'refused' | 'internal' };

/**
 * Pair the target, revoking its active pairings and their grants first (all in the caller's
 * transaction). Returns the new row, its token, and the rows it replaced.
 */
function pairTarget(
  store: Store,
  claim: InviteClaim,
  admin = false,
): { pairing: PairingRow; token: string; replaced: PairingRow[] } {
  const replaced = store.revokeActiveFor(claim.worldId, claim.userId);
  const token = randomBytes(32).toString('base64url');
  const pairing = store.createPairing({
    id: randomUUID(),
    tokenHash: createHash('sha256').update(token).digest('hex'),
    worldId: claim.worldId,
    userId: claim.userId,
    userName: claim.userName,
    origin: claim.origin,
    admin,
  });
  return { pairing, token, replaced };
}

/** Run a transactional pairing step; an error rolls everything back and is an `internal` failure. */
function inTransaction(
  store: Store,
  step: () => PairingOutcome,
  onError?: (err: unknown) => void,
): PairingOutcome {
  let out: PairingOutcome;
  try {
    out = store.transaction(step);
  } catch (err) {
    onError?.(err);
    return { ok: false, reason: 'internal' };
  }
  // After COMMIT: in-memory effects only.
  if (out.ok) for (const r of out.replaced) store.notifyPairingRevoked(r);
  return out;
}

/** A redeem that needs an admin GM's vouch before it can pair: nothing is spent yet. */
export type RedeemOutcome = PairingOutcome | { ok: false; reason: 'vouch'; invite: InviteRow };

function claimMatches(invite: InviteRow, claim: InviteClaim): boolean {
  return (
    invite.worldId === claim.worldId &&
    invite.userId === claim.userId &&
    (invite.origin === null || invite.origin === claim.origin)
  );
}

/**
 * Check a database invite. One `BEGIN IMMEDIATE` transaction: unknown, used, cancelled and expired
 * invites are refused; a mismatch spends the invite and is refused. A matching invite flagged `gm`
 * or `admin` revokes the target's old pairings and creates the new one (the stored row alone
 * decides; the hello's `isGM` is never read). Any other matching invite is returned as `vouch` and
 * left unspent: it pairs only through `completeVouchedInvite`. Synchronous, so two sockets cannot
 * both win.
 */
export function redeemInvite(
  store: Store,
  code: string,
  claim: InviteClaim,
  now: number,
  onError?: (err: unknown) => void,
): RedeemOutcome {
  const refused: PairingOutcome = { ok: false, reason: 'refused' };
  let vouch: InviteRow | undefined;
  const out = inTransaction(
    store,
    () => {
      const invite = store.invites.findByHash(hashInviteCode(code));
      if (!invite || invite.usedAt !== null || invite.cancelledAt !== null) return refused;
      if (invite.expiresAt <= now) {
        store.invites.settle(invite.id, 'expired', null);
        return refused;
      }
      if (!claimMatches(invite, claim)) {
        store.invites.settle(invite.id, 'mismatch', null);
        return refused;
      }
      if (!invite.gm && !invite.admin) {
        vouch = invite;
        return refused;
      }
      const paired = pairTarget(store, claim, invite.admin);
      store.invites.settle(invite.id, 'paired', paired.pairing.id);
      return { ok: true, ...paired };
    },
    onError,
  );
  return vouch ? { ok: false, reason: 'vouch', invite: vouch } : out;
}

/**
 * Settle a vouched invite as paired, in one transaction: the invite must still be unused,
 * uncancelled and unexpired (an operator may have cancelled it while the player waited). The new
 * pairing is never admin.
 */
export function completeVouchedInvite(
  store: Store,
  inviteId: string,
  claim: InviteClaim,
  now: number,
  onError?: (err: unknown) => void,
): PairingOutcome {
  const refused: PairingOutcome = { ok: false, reason: 'refused' };
  return inTransaction(
    store,
    () => {
      const invite = store.invites.getById(inviteId);
      if (
        !invite ||
        invite.usedAt !== null ||
        invite.cancelledAt !== null ||
        invite.expiresAt <= now ||
        invite.admin ||
        invite.gm ||
        !claimMatches(invite, claim)
      )
        return refused;
      const paired = pairTarget(store, claim, false);
      store.invites.settle(invite.id, 'paired', paired.pairing.id);
      return { ok: true, ...paired };
    },
    onError,
  );
}

/** Spend a vouched invite as a mismatch, if it is still unused. */
export function settleInviteMismatch(store: Store, inviteId: string): void {
  store.transaction(() => {
    const invite = store.invites.getById(inviteId);
    if (invite && invite.usedAt === null && invite.cancelledAt === null)
      store.invites.settle(invite.id, 'mismatch', null);
  });
}

/** Pair after an in-memory invite matched: the same replacement rules, no database invite row. */
export function pairFromMemoryInvite(
  store: Store,
  claim: InviteClaim,
  onError?: (err: unknown) => void,
): PairingOutcome {
  return inTransaction(store, () => ({ ok: true, ...pairTarget(store, claim) }), onError);
}
