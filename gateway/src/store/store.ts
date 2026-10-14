import { createEventRepository, type EventRepository } from '../events/repository.js';
import { createQueueRepository, type QueueRepository } from '../offline-queue/repository.js';
import { createOAuthRepository, type OAuthRepository } from '../oauth/repository.js';
import { DatabaseSync } from 'node:sqlite';
import { applyMigrations } from './migrate.js';
import { MIGRATIONS } from './migrations/index.js';
import { safeText } from '../routing/sanitize.js';

export interface PairingRow {
  id: string;
  tokenHash: string;
  worldId: string;
  userId: string;
  /** Name reported when the pairing code was redeemed; '' for pairings made before it was recorded. */
  userName: string;
  createdAt: number;
  revokedAt: number | null;
  /** Exact browser origin the pairing was made from; null for pairings made before binding. */
  origin: string | null;
  /** Operator-set admin GM flag; only an admin invite creates it, only `demotePairing` clears it. */
  admin: boolean;
}

export interface NewPairing {
  id: string;
  tokenHash: string;
  worldId: string;
  userId: string;
  userName?: string;
  origin: string;
  /** Set at creation only (from an admin invite); never derived from the hello. */
  admin?: boolean;
}

export type InviteResult = 'paired' | 'mismatch' | 'expired' | 'cancelled';

export interface InviteRow {
  id: string;
  codeHash: string;
  worldId: string;
  userId: string;
  /** Browser origin the invite is pinned to; null means the first origin to redeem it wins. */
  origin: string | null;
  createdAt: number;
  expiresAt: number;
  usedAt: number | null;
  cancelledAt: number | null;
  result: InviteResult | null;
  pairingId: string | null;
  /** Operator invite that pairs an admin GM, with no vouch. */
  admin: boolean;
  /** Operator invite for a GM user, paired with no vouch (vouching cannot prove a GM). */
  gm: boolean;
  /** NULL means the operator; set by delegated invites, which can never carry `admin` or `gm`. */
  createdBy: string | null;
}

export interface NewInvite {
  id: string;
  codeHash: string;
  worldId: string;
  userId: string;
  origin: string | null;
  expiresAt: number;
  admin?: boolean;
  gm?: boolean;
  createdBy?: string | null;
}

/** Invite rows. None of these opens a transaction; callers wrap them in `Store.transaction`. */
export interface InviteRepository {
  /** Throws, writing nothing, when `createdBy` is set and `admin` or `gm` is true. */
  create(i: NewInvite): InviteRow;
  findByHash(codeHash: string): InviteRow | undefined;
  /** Spend an invite: sets `used_at` and the outcome. */
  settle(id: string, result: 'paired' | 'mismatch' | 'expired', pairingId: string | null): void;
  /** Cancel every unused invite for the target; returns how many. */
  cancelFor(worldId: string, userId: string): number;
  list(): InviteRow[];
}

/** Gateway persistence. Holds hashed credentials and bounded, observer-visible event summaries. */
export interface Store {
  readonly events: EventRepository;
  readonly queue: QueueRepository;
  readonly oauth: OAuthRepository;
  readonly invites: InviteRepository;
  /**
   * Run `fn` inside `BEGIN IMMEDIATE ... COMMIT`, so the write lock is taken first and
   * `busy_timeout` covers the wait. Rolls back and rethrows the original error on failure. Inside
   * a transaction it just runs `fn`.
   */
  transaction<T>(fn: () => T): T;
  isPairingActive(id: string, worldId: string, userId: string): boolean;
  /**
   * In-memory effects that run after a pairing revoke has committed, with the revoked row, in the
   * process that revoked it. Grants are not a listener: they are revoked inside the revoke's
   * transaction. A throwing listener is logged and never stops the others or undoes the commit.
   */
  onPairingRevoked(listener: (pairing: PairingRow) => void): () => void;
  createPairing(p: NewPairing): PairingRow;
  findPairingByHash(tokenHash: string): PairingRow | undefined;
  getPairing(id: string): PairingRow | undefined;
  /** Pairings that are not revoked. */
  listActivePairings(): PairingRow[];
  /** One query: `active` if any unrevoked row exists, `revoked` if rows exist but all are, else `none`. */
  pairingStateFor(worldId: string, userId: string): 'active' | 'revoked' | 'none';
  /** Every pairing row, revoked or not, oldest first. */
  listPairings(): PairingRow[];
  /** Clear the admin flag. The only API that writes `pairings.admin` after creation. */
  demotePairing(id: string): boolean;
  /** Revokes the row and its (world, user)'s OAuth grants in one transaction. */
  revokePairing(id: string): boolean;
  /**
   * Inside a transaction already open: revoke every active pairing for the target and its OAuth
   * grants. Returns the revoked rows; the caller fires `notifyPairingRevoked` after COMMIT.
   */
  revokeActiveFor(worldId: string, userId: string): PairingRow[];
  /** One transaction: revoke the target's pairings and grants, and cancel its unused invites. */
  revokePairingsFor(
    worldId: string,
    userId: string,
  ): { pairings: PairingRow[]; cancelledInvites: number };
  /** Fire the in-memory `onPairingRevoked` listeners for an already-revoked row. */
  notifyPairingRevoked(pairing: PairingRow): void;
  /** Hex sha256 of the local HTTP bearer token; the token itself is never stored. */
  getHttpTokenHash(): string | undefined;
  /**
   * Replace the stored hash (rotation), or with `onlyIfAbsent` set it only when none exists.
   * Returns whether a row was written.
   */
  setHttpTokenHash(hash: string, onlyIfAbsent?: boolean): boolean;
  close(): void;
}

interface Row {
  id: string;
  token_hash: string;
  world_id: string;
  user_id: string;
  user_name: string;
  created_at: number;
  revoked_at: number | null;
  origin: string | null;
  admin: number;
}

interface InviteDbRow {
  id: string;
  code_hash: string;
  world_id: string;
  user_id: string;
  origin: string | null;
  created_at: number;
  expires_at: number;
  used_at: number | null;
  cancelled_at: number | null;
  result: InviteResult | null;
  pairing_id: string | null;
  admin: number;
  gm: number;
  created_by: string | null;
}

function toInvite(r: InviteDbRow): InviteRow {
  return {
    id: r.id,
    codeHash: r.code_hash,
    worldId: r.world_id,
    userId: r.user_id,
    origin: r.origin,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    usedAt: r.used_at,
    cancelledAt: r.cancelled_at,
    result: r.result,
    pairingId: r.pairing_id,
    admin: Number(r.admin) === 1,
    gm: Number(r.gm) === 1,
    createdBy: r.created_by,
  };
}

function toRow(r: Row): PairingRow {
  return {
    id: r.id,
    tokenHash: r.token_hash,
    worldId: r.world_id,
    userId: r.user_id,
    userName: r.user_name,
    createdAt: r.created_at,
    revokedAt: r.revoked_at,
    origin: r.origin,
    admin: Number(r.admin) === 1,
  };
}

export function openStore(
  path: string,
  now: () => number = Date.now,
  warn: (line: string) => void = (l) => void process.stderr.write(`${l}\n`),
): Store {
  const db = new DatabaseSync(path);
  try {
    // Wait briefly for a concurrent reader instead of failing with SQLITE_BUSY.
    db.exec('PRAGMA busy_timeout = 5000');
    // WAL lets readers (the rotate check, --backup) run beside the gateway's writes. It is stored
    // in the file; an older binary converts it back to DELETE and this one converts it again.
    const mode = (db.prepare('PRAGMA journal_mode = WAL').get() as { journal_mode: string })
      .journal_mode;
    if (mode !== 'wal' && mode !== 'memory')
      warn(
        `SQLite journal mode is ${mode}, not wal (this filesystem may not support it); continuing`,
      );
    applyMigrations(db, MIGRATIONS);
  } catch (err) {
    db.close();
    throw err;
  }
  const revokedListeners = new Set<(pairing: PairingRow) => void>();
  const insert = db.prepare(
    'INSERT INTO pairings (id, token_hash, world_id, user_id, user_name, created_at, origin, admin) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  );
  const byHash = db.prepare('SELECT * FROM pairings WHERE token_hash = ?');
  const byId = db.prepare('SELECT * FROM pairings WHERE id = ?');
  const active = db.prepare('SELECT * FROM pairings WHERE revoked_at IS NULL ORDER BY created_at');
  const revoke = db.prepare(
    'UPDATE pairings SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL',
  );
  const demote = db.prepare('UPDATE pairings SET admin = 0 WHERE id = ? AND admin = 1');
  const getSetting = db.prepare('SELECT value FROM gateway_settings WHERE key = ?');
  const putSetting = db.prepare(
    'INSERT OR REPLACE INTO gateway_settings (key, value) VALUES (?, ?)',
  );
  const putSettingIfAbsent = db.prepare(
    'INSERT OR IGNORE INTO gateway_settings (key, value) VALUES (?, ?)',
  );
  const activeFor = db.prepare(
    'SELECT * FROM pairings WHERE world_id = ? AND user_id = ? AND revoked_at IS NULL',
  );
  const stateFor = db.prepare(
    'SELECT COUNT(*) AS total, COALESCE(SUM(revoked_at IS NULL), 0) AS live FROM pairings WHERE world_id = ? AND user_id = ?',
  );
  const allPairings = db.prepare('SELECT * FROM pairings ORDER BY created_at, id');
  const oauth = createOAuthRepository(db);
  const inviteByHash = db.prepare('SELECT * FROM invites WHERE code_hash = ?');
  const inviteById = db.prepare('SELECT * FROM invites WHERE id = ?');
  const inviteInsert = db.prepare(
    'INSERT INTO invites (id, code_hash, world_id, user_id, origin, created_at, expires_at, admin, gm, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  const inviteSettle = db.prepare(
    'UPDATE invites SET used_at = ?, result = ?, pairing_id = ? WHERE id = ?',
  );
  const inviteCancel = db.prepare(
    "UPDATE invites SET cancelled_at = ?, result = 'cancelled' WHERE world_id = ? AND user_id = ? AND used_at IS NULL AND cancelled_at IS NULL",
  );
  const inviteList = db.prepare('SELECT * FROM invites ORDER BY created_at, id');
  let inTx = false;
  const transaction = <T>(fn: () => T): T => {
    if (inTx) return fn();
    db.exec('BEGIN IMMEDIATE');
    inTx = true;
    try {
      const out = fn();
      db.exec('COMMIT');
      return out;
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // Report the original error, never one raised by the rollback.
      }
      throw err;
    } finally {
      inTx = false;
    }
  };
  const notify = (row: PairingRow): void => {
    for (const listener of [...revokedListeners]) {
      try {
        listener(row);
      } catch (err) {
        warn(
          `pairing revoked listener failed for ${safeText(row.worldId)}/${safeText(row.userId)}: ${safeText((err as Error).message ?? String(err))}`,
        );
      }
    }
  };
  const revokeActiveFor = (worldId: string, userId: string): PairingRow[] => {
    const rows = (activeFor.all(worldId, userId) as unknown as Row[]).map(toRow);
    const at = now();
    const revoked: PairingRow[] = [];
    for (const r of rows) {
      if (Number(revoke.run(at, r.id).changes) > 0) revoked.push({ ...r, revokedAt: at });
    }
    oauth.revokeGrantsFor(worldId, userId, at);
    return revoked;
  };
  const invites: InviteRepository = {
    create(i) {
      const createdBy = i.createdBy ?? null;
      if (createdBy !== null && (i.admin === true || i.gm === true))
        throw new Error('only the operator can mint an invite that skips the vouch');
      inviteInsert.run(
        i.id,
        i.codeHash,
        i.worldId,
        i.userId,
        i.origin,
        now(),
        i.expiresAt,
        i.admin === true ? 1 : 0,
        i.gm === true ? 1 : 0,
        createdBy,
      );
      return toInvite(inviteById.get(i.id) as unknown as InviteDbRow);
    },
    findByHash(codeHash) {
      const r = inviteByHash.get(codeHash) as InviteDbRow | undefined;
      return r ? toInvite(r) : undefined;
    },
    settle(id, result, pairingId) {
      inviteSettle.run(now(), result, pairingId, id);
    },
    cancelFor(worldId, userId) {
      return Number(inviteCancel.run(now(), worldId, userId).changes);
    },
    list() {
      return (inviteList.all() as unknown as InviteDbRow[]).map(toInvite);
    },
  };
  return {
    events: createEventRepository(db),
    queue: createQueueRepository(db),
    oauth,
    invites,
    transaction,
    onPairingRevoked(listener) {
      revokedListeners.add(listener);
      return () => {
        revokedListeners.delete(listener);
      };
    },
    isPairingActive(id, worldId, userId) {
      const r = byId.get(id) as Row | undefined;
      return !!r && r.revoked_at === null && r.world_id === worldId && r.user_id === userId;
    },
    createPairing(p) {
      insert.run(
        p.id,
        p.tokenHash,
        p.worldId,
        p.userId,
        p.userName ?? '',
        now(),
        p.origin ?? null,
        p.admin === true ? 1 : 0,
      );
      return toRow(byId.get(p.id) as unknown as Row);
    },
    findPairingByHash(tokenHash) {
      const r = byHash.get(tokenHash) as Row | undefined;
      return r ? toRow(r) : undefined;
    },
    getPairing(id) {
      const r = byId.get(id) as Row | undefined;
      return r ? toRow(r) : undefined;
    },
    listActivePairings() {
      return (active.all() as unknown as Row[]).map(toRow);
    },
    pairingStateFor(worldId, userId) {
      const r = stateFor.get(worldId, userId) as { total: number; live: number };
      return Number(r.live) > 0 ? 'active' : Number(r.total) > 0 ? 'revoked' : 'none';
    },
    listPairings() {
      return (allPairings.all() as unknown as Row[]).map(toRow);
    },
    demotePairing(id) {
      return Number(demote.run(id).changes) > 0;
    },
    revokePairing(id) {
      const row = transaction(() => {
        if (Number(revoke.run(now(), id).changes) === 0) return undefined;
        const r = toRow(byId.get(id) as unknown as Row);
        oauth.revokeGrantsFor(r.worldId, r.userId, now());
        return r;
      });
      if (!row) return false;
      notify(row);
      return true;
    },
    revokeActiveFor,
    revokePairingsFor(worldId, userId) {
      const out = transaction(() => ({
        pairings: revokeActiveFor(worldId, userId),
        cancelledInvites: invites.cancelFor(worldId, userId),
      }));
      for (const p of out.pairings) notify(p);
      return out;
    },
    notifyPairingRevoked: notify,
    getHttpTokenHash() {
      return (getSetting.get('http_token_hash') as { value: string } | undefined)?.value;
    },
    setHttpTokenHash(hash, onlyIfAbsent = false) {
      return (
        Number(
          (onlyIfAbsent ? putSettingIfAbsent : putSetting).run('http_token_hash', hash).changes,
        ) > 0
      );
    },
    close() {
      db.close();
    },
  };
}
