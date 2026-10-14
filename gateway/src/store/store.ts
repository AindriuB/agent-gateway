import { createEventRepository, type EventRepository } from '../events/repository.js';
import { createQueueRepository, type QueueRepository } from '../offline-queue/repository.js';
import { createOAuthRepository, type OAuthRepository } from '../oauth/repository.js';
import { DatabaseSync } from 'node:sqlite';
import { applyMigrations } from './migrate.js';
import { MIGRATIONS } from './migrations/index.js';

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
}

export interface NewPairing {
  id: string;
  tokenHash: string;
  worldId: string;
  userId: string;
  userName?: string;
  origin: string;
}

/** Gateway persistence. Holds hashed credentials and bounded, observer-visible event summaries. */
export interface Store {
  readonly events: EventRepository;
  readonly queue: QueueRepository;
  readonly oauth: OAuthRepository;
  isPairingActive(id: string, worldId: string, userId: string): boolean;
  /** Called after a pairing is revoked, with the revoked row; in the process that revoked it. */
  onPairingRevoked(listener: (pairing: PairingRow) => void): () => void;
  createPairing(p: NewPairing): PairingRow;
  findPairingByHash(tokenHash: string): PairingRow | undefined;
  /** Pairings that are not revoked. */
  listActivePairings(): PairingRow[];
  revokePairing(id: string): boolean;
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
    'INSERT INTO pairings (id, token_hash, world_id, user_id, user_name, created_at, origin) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  const byHash = db.prepare('SELECT * FROM pairings WHERE token_hash = ?');
  const byId = db.prepare('SELECT * FROM pairings WHERE id = ?');
  const active = db.prepare('SELECT * FROM pairings WHERE revoked_at IS NULL ORDER BY created_at');
  const revoke = db.prepare(
    'UPDATE pairings SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL',
  );
  const getSetting = db.prepare('SELECT value FROM gateway_settings WHERE key = ?');
  const putSetting = db.prepare(
    'INSERT OR REPLACE INTO gateway_settings (key, value) VALUES (?, ?)',
  );
  const putSettingIfAbsent = db.prepare(
    'INSERT OR IGNORE INTO gateway_settings (key, value) VALUES (?, ?)',
  );
  const oauth = createOAuthRepository(db);
  // Grants die with their pairing, in whichever process revokes it (the gateway or a CLI).
  revokedListeners.add((p) => {
    oauth.revokeGrantsFor(p.worldId, p.userId, now());
  });
  return {
    events: createEventRepository(db),
    queue: createQueueRepository(db),
    oauth,
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
      insert.run(p.id, p.tokenHash, p.worldId, p.userId, p.userName ?? '', now(), p.origin ?? null);
      return toRow(byId.get(p.id) as unknown as Row);
    },
    findPairingByHash(tokenHash) {
      const r = byHash.get(tokenHash) as Row | undefined;
      return r ? toRow(r) : undefined;
    },
    listActivePairings() {
      return (active.all() as unknown as Row[]).map(toRow);
    },
    revokePairing(id) {
      const changed = Number(revoke.run(now(), id).changes) > 0;
      if (changed) {
        const row = toRow(byId.get(id) as unknown as Row);
        for (const listener of revokedListeners) listener(row);
      }
      return changed;
    },
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
