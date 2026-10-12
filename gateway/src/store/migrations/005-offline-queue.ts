export default `CREATE TABLE queued_catalogs (
 world_id TEXT NOT NULL, user_id TEXT NOT NULL, agent_id TEXT NOT NULL,
 tools TEXT NOT NULL, PRIMARY KEY(world_id,user_id,agent_id)
);
CREATE TABLE queued_calls (
 id TEXT PRIMARY KEY, world_id TEXT NOT NULL, user_id TEXT NOT NULL, agent_id TEXT NOT NULL,
 session_id TEXT NOT NULL, tool TEXT NOT NULL, definition TEXT NOT NULL, args TEXT NOT NULL,
 args_hash TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
 state TEXT NOT NULL, connection_id TEXT, result TEXT, resolved_at INTEGER
);
CREATE INDEX queued_calls_owner ON queued_calls(world_id,user_id,agent_id,state);`;
