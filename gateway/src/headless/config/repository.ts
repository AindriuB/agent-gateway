import type { DatabaseSync } from 'node:sqlite';

/** Names are lowercase so the env form (uppercase, `-` to `_`) maps back unambiguously. */
export const AGENT_NAME = /^[a-z0-9][a-z0-9-]{0,31}$/;

export interface HeadlessAgentRow {
  name: string;
  foundryUrl: string;
  worldId: string;
  userId: string;
  /** The Foundry user id that approvals for this agent reach; null for none. */
  ownerUserId: string | null;
  createdAt: number;
}

/** Stored headless agents. There is no password column; see the config file and env keys. */
export interface HeadlessRepository {
  list(): HeadlessAgentRow[];
  get(name: string): HeadlessAgentRow | undefined;
  getByIdentity(worldId: string, userId: string): HeadlessAgentRow | undefined;
  /** Throws on a duplicate name or (world, user). */
  add(row: Omit<HeadlessAgentRow, 'createdAt'>, createdAt?: number): HeadlessAgentRow;
  remove(name: string): boolean;
}

interface Raw {
  name: string;
  foundry_url: string;
  world_id: string;
  user_id: string;
  owner_user_id: string | null;
  created_at: number | bigint;
}

const toRow = (r: Raw): HeadlessAgentRow => ({
  name: r.name,
  foundryUrl: r.foundry_url,
  worldId: r.world_id,
  userId: r.user_id,
  ownerUserId: r.owner_user_id,
  createdAt: Number(r.created_at),
});

export function createHeadlessRepository(db: DatabaseSync): HeadlessRepository {
  const all = db.prepare('SELECT * FROM headless_agents ORDER BY name');
  const byName = db.prepare('SELECT * FROM headless_agents WHERE name = ?');
  const byIdentity = db.prepare('SELECT * FROM headless_agents WHERE world_id = ? AND user_id = ?');
  const insert = db.prepare(
    'INSERT INTO headless_agents (name, foundry_url, world_id, user_id, owner_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  );
  const del = db.prepare('DELETE FROM headless_agents WHERE name = ?');
  return {
    list: () => (all.all() as unknown as Raw[]).map(toRow),
    get: (name) => {
      const r = byName.get(name) as unknown as Raw | undefined;
      return r ? toRow(r) : undefined;
    },
    getByIdentity: (worldId, userId) => {
      const r = byIdentity.get(worldId, userId) as unknown as Raw | undefined;
      return r ? toRow(r) : undefined;
    },
    add: (row, createdAt = Date.now()) => {
      insert.run(row.name, row.foundryUrl, row.worldId, row.userId, row.ownerUserId, createdAt);
      return { ...row, createdAt };
    },
    remove: (name) => Number(del.run(name).changes) > 0,
  };
}
