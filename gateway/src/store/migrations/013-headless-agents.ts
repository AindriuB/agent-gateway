/**
 * Headless agents managed by `headless add|list|remove` (task 38). One row per agent; the
 * password is never stored here, it comes from the 0600 config file or the environment.
 */
export default `CREATE TABLE headless_agents (
  name TEXT PRIMARY KEY,
  foundry_url TEXT NOT NULL,
  world_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  owner_user_id TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (world_id, user_id)
);`;
