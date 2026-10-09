export default `CREATE TABLE pairings (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  world_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
)`;
