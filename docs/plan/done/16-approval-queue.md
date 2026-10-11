# 16 — Add the approval queue, relay and approval_status tool

**Repo:** .
**Status:** Complete; implementation merged and archived after the completion audit. See done/README.md and HISTORY for evidence.
**Depends on:** 13
**Owns:**
- module/src/approvals/**
- module/test/approvals/**
- module/src/ops/stages.ts (insertions only)
- protocol/src/tools/approval-status.ts
- protocol/src/tools/index.ts (insertions only)
- module/src/tools/approval-status.ts
- module/src/tools/index.ts (insertions only)
- module/test/stubs/** (insertions only)
- lang/en.json (insertions under `AGENT_GATEWAY.Approvals.*` only)

## Goal
Turn "ask owner" and "ask GM" into a working flow: the request is sent over the
module socket to eligible approvers, the call waits about 30 s and then returns
`pending_approval` with an id the agent polls via `approval_status`. Requests
queue while approvers are offline and are re-presented when they connect or the
module reconnects. The dialog UI is 17; this PR exposes the approver API and a
hook.

## Context
- docs/plan/specs/2026-10-09-agent-gateway.md:79-80 — queued requests relayed over the module socket to owner or GM
- docs/plan/specs/2026-10-09-agent-gateway.md:120-139 — approvers, wait then pending, approve / approve for session / deny with reason
- module/src/ops/stages.ts — stage order 40; `ctx.approval` set by policy (13)

## Acceptance
- [ ] Approval stage (order 40) acts only when `ctx.approval` is set; replaces 13's "approval required" denial
- [ ] Request record: id, agentId, sessionId, requester user, tool, args, category, approver class, createdAt, status; persisted in the requester's client storage so a reload does not lose it
- [ ] Relay uses `game.socket` on `module.agent-gateway`; eligible approvers are the agent owner (ask_owner) or any active GM (both classes); any GM may resolve any request
- [ ] Call waits `APPROVAL_WAIT_MS` (30000, in the shared config object) then returns structured `{status:'pending_approval', id}`; on approval within the wait, the handler runs and its result is returned directly
- [ ] `approval_status` (player, read, args `id`) returns `pending`, `approved` with the stored handler result, `denied` with the approver's reason, or `expired`; only the same agent may query an id
- [ ] "Approve for this session" records a grant for `(agentId, sessionId, tool)` that skips asking for later calls in that session
- [ ] On `userConnected` of an eligible approver and on link reconnect, pending requests are re-sent; duplicates are deduplicated by id
- [ ] Fires hook `agentGateway.approvalRequested` / `agentGateway.approvalResolved` and exposes `resolveApproval(id, {decision, reason, scope})`
- [ ] Two-client stub tests: owner approves, GM denies with reason, timeout to pending then approval_status approved, offline approver then connect
- [ ] `npm run verify` passes

## Out of scope
- Diff dialog and batch UI (17)
- Event-log events for approvals (27)
- Offline-world write queueing (30)
