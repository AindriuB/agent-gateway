export default `
CREATE TABLE event_streams (
 world_id TEXT NOT NULL, user_id TEXT NOT NULL, next_cursor INTEGER NOT NULL DEFAULT 1,
 PRIMARY KEY(world_id,user_id)
);
CREATE TABLE event_evictions (
 world_id TEXT NOT NULL, user_id TEXT NOT NULL, agent_id TEXT NOT NULL, last_evicted INTEGER NOT NULL,
 PRIMARY KEY(world_id,user_id,agent_id)
);
CREATE TABLE event_rows (
 world_id TEXT NOT NULL, user_id TEXT NOT NULL, agent_id TEXT NOT NULL,
 cursor INTEGER NOT NULL, received_at INTEGER NOT NULL, event_type TEXT NOT NULL, payload TEXT NOT NULL,
 PRIMARY KEY(world_id,user_id,cursor)
);
CREATE INDEX event_owner_history ON event_rows(world_id,user_id,agent_id,received_at,cursor);
`;
