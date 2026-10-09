import { DatabaseSync } from 'node:sqlite';

export interface PairingRow {
  id: string;
  tokenHash: string;
  worldId: string;
  userId: string;
  createdAt: number;
  revokedAt: number | null;
}

export interface NewPairing {
  id: string;
  tokenHash: string;
  worldId: string;
  userId: string;
}

/** Gateway persistence. Holds hashed credentials and gateway state, never world data. */
export interface Store {
  createPairing(p: NewPairing): PairingRow;
  findPairingByHash(tokenHash: string): PairingRow | undefined;
  revokePairing(id: string): boolean;
  close(): void;
}

/** Append-only: later tasks add migrations at the end. */
export const MIGRATIONS: readonly string[] = [
  `CREATE TABLE pairings (
     id TEXT PRIMARY KEY,
     token_hash TEXT NOT NULL UNIQUE,
     world_id TEXT NOT NULL,
     user_id TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     revoked_at INTEGER
   )`,
];

interface Row {
  id: string;
  token_hash: string;
  world_id: string;
  user_id: string;
  created_at: number;
  revoked_at: number | null;
}

function toRow(r: Row): PairingRow {
  return {
    id: r.id,
    tokenHash: r.token_hash,
    worldId: r.world_id,
    userId: r.user_id,
    createdAt: r.created_at,
    revokedAt: r.revoked_at,
  };
}

export function openStore(path: string, now: () => number = Date.now): Store {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = DELETE');
  const current = (db.prepare('PRAGMA user_version').get() as { user_version: number })
    .user_version;
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v] as string);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
  const insert = db.prepare(
    'INSERT INTO pairings (id, token_hash, world_id, user_id, created_at) VALUES (?, ?, ?, ?, ?)',
  );
  const byHash = db.prepare('SELECT * FROM pairings WHERE token_hash = ?');
  const byId = db.prepare('SELECT * FROM pairings WHERE id = ?');
  const revoke = db.prepare(
    'UPDATE pairings SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL',
  );
  return {
    createPairing(p) {
      insert.run(p.id, p.tokenHash, p.worldId, p.userId, now());
      return toRow(byId.get(p.id) as unknown as Row);
    },
    findPairingByHash(tokenHash) {
      const r = byHash.get(tokenHash) as Row | undefined;
      return r ? toRow(r) : undefined;
    },
    revokePairing(id) {
      return Number(revoke.run(now(), id).changes) > 0;
    },
    close() {
      db.close();
    },
  };
}
