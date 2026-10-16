/**
 * Task 112: a write waiting for approval in the requester's tab is mirrored as a queue row keyed
 * by the module's approval id (`approval_alias`), so it can outlive that tab. `alias_report` is
 * the module's last report; `orphaned_at` is set when the requester's link closed.
 */
export default `ALTER TABLE queued_calls ADD COLUMN approval_alias TEXT;
ALTER TABLE queued_calls ADD COLUMN alias_report TEXT;
ALTER TABLE queued_calls ADD COLUMN orphaned_at INTEGER;
CREATE UNIQUE INDEX queued_calls_alias ON queued_calls(world_id,user_id,agent_id,approval_alias) WHERE approval_alias IS NOT NULL;`;
