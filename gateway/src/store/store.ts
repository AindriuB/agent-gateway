import { DatabaseSync } from 'node:sqlite';
import { applyMigrations } from './migrate.js';
import { MIGRATIONS } from './migrations/index.js';

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
  applyMigrations(db, MIGRATIONS);
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
