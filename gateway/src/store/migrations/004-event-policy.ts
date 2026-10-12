export default `CREATE TABLE event_policies (
  world_id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0,
  retention_days INTEGER NOT NULL DEFAULT 14
);
CREATE TABLE event_read_permissions (
  world_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  allowed INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(world_id,user_id,agent_id)
)`;
