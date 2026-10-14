/** Operator invites for server mode (task 68): single-use, bound to one world and user. */
export default `CREATE TABLE invites (
  id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,
  world_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  origin TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  cancelled_at INTEGER,
  result TEXT,
  pairing_id TEXT
);
CREATE INDEX invites_target ON invites (world_id, user_id);`;
