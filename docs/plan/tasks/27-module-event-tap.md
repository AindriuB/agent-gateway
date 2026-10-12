# 27 — Add the module event tap and event protocol

**Repo:** .
**Depends on:** 16
**Owns:**
- protocol/src/events/**
- protocol/test/events/**
- protocol/src/link/messages.ts (insertions only)
- protocol/src/link/version.ts (protocol major 3 declaration/comment only)
- protocol/test/link/link.test.ts (event parsing and major-compatibility tests only)
- module/test/link/client.test.ts (major-3 hello and older-gateway rejection tests only)
- gateway/src/link/server.ts (authenticated validated event acceptance/no-op only)
- gateway/test/link/server.test.ts (event authentication/acceptance and major-compatibility tests only)
- module/src/events/**
- module/test/events/**
- module/src/main.ts (insert the event tap install call only)

## Goal
Turn what the user's own client sees into a stream of small, sequenced events
sent to the gateway: chat and rolls, combat lifecycle, document changes for the
listed types, user presence, scene changes, approvals and agent actions. Rapid
updates to one document are coalesced.

## Context
- docs/plan/specs/2026-10-09-agent-gateway.md:265-280 — event types, shape, visibility by construction, seq, gap, coalescing
- module/src/approvals/** hooks (16)

## Acceptance
- [ ] `protocol/src/events/` defines `AgentEvent` `{seq, ts, type, userId, doc?: {uuid, type, name}, summary}` with summary max 200 chars and a type enum covering chat, roll, combat_start/end/turn/round, create/update/delete for Actor, Item, JournalEntry, Scene, Token, user_join/leave, scene_change, approval_requested/resolved, agent_action, gap; no full document payloads (test)
- [ ] New link message `event {event}`; seq strictly increasing per connection from 1, reset only on a new connection
- [ ] Hooks registered: `createChatMessage`, `combatStart`, `combatTurn`, `combatRound`, `deleteCombat`, create/update/delete for each listed type, `userConnected`, `canvasReady`, `agentGateway.approvalRequested/Resolved`; events from this module's own agent calls carry `agent_action` or a flag
- [ ] Updates to the same uuid within `COALESCE_MS` (500, shared config object) produce one event (fake-timer test)
- [ ] Events are only produced for documents visible to `game.user` (test with a hidden token and a whisper)
- [ ] `npm run verify` passes

## Bounded integration and privacy contract

- This introduces an unnegotiated link frame. Set `PROTOCOL_VERSION` to
  `3.0.0`; preserve the existing major-mismatch diagnostic and terminal client
  behavior. Test module 3/gateway 2 and module 2/gateway 3 rejection at handshake,
  before welcome or credential consumption. Historical v1/v2 records stay intact.
- The gateway validates the event through the shared link schema, then accepts
  it only after authentication and ignores it in this task. A pre-hello event
  remains an invalid first frame. Require event `userId` to match the authenticated
  connection user; a payload cannot relabel its observer. Do not introduce buffering, polling, retention,
  routing to another connection or a new capability negotiation system.
- Install one idempotent tap on the existing link client. Send only while its
  welcomed connection is live. Sequence numbers are safe positive integers,
  assigned at emission starting at 1 for each new connection. Drop pending
  timers/data on disconnect; a stale callback must never send into a replacement
  connection. Repeated connected notifications do not reset the sequence.
- Put `COALESCE_MS: 500` and bounded pending-update capacity in one exported
  event config object. Coalesce updates only, by document UUID; preserve the
  last visible state and an agent-origin flag if any coalesced update had it.
  A delete cancels its pending update. Recheck current user, connection and
  visibility before delayed emission. Overflow drops events without retaining
  full documents or inventing gap events (task 28).
- `userId` is the observing authenticated native `game.user.id`, not a claimed
  hook-payload identity. References/names and all strings are bounded. Schema
  rejects unknown fields and full document payloads. Summaries are plain short
  descriptions, never raw hook data, changed values, chat HTML, formulas/results,
  approval arguments, full code source or resolution reasons.
- Chat/roll visibility requires native `isContentVisible === true`, not merely
  `visible` (blind-roll placeholders are visible without private content).
  Hidden whispers and blind rolls yield no event/reference/name/roll metadata
  for nonrecipients. Token visibility must respect the actual client's rendered
  token visibility, hidden state, scene and current user; permission alone is
  insufficient. Other documents require native observer visibility and visible
  ancestry; exclude protected audit documents. Combat summaries do not reveal
  hidden combatant identities. Scene names use the requesting user's visible
  navigation name. Missing/throwing visibility checks fail closed.
- Approval lifecycle events use constant summaries and no document reference
  derived from arguments. Preserve native document event types for agent writes
  with an optional bounded `agent_action` boolean flag derived from the module's
  `options.agentGateway.callId`; no arbitrary arguments/audit snapshots leave
  the client. The enum includes `agent_action` and `gap`, but this task does not
  promise a synthetic action event for every read/code invocation or emit gaps.
- Regression coverage must exercise blind/whisper and hidden-token privacy,
  visibility changes during the coalesce window, create/update/delete ordering,
  disconnect/reconnect/stale timers, duplicate installation, pending bounds,
  approval/code payload redaction, agent flags and authenticated event no-op.
  Run the full required gate before publication. Any later native fixture writes
  require fresh scoped human consent; unit testing does not authorize them.

## Out of scope
- Gateway buffer, gap events and polling tools (28)
- Offline retention (29)
