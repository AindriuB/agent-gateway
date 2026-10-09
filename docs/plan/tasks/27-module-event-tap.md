# 27 — Add the module event tap and event protocol

**Repo:** .
**Depends on:** 16
**Owns:**
- protocol/src/events/**
- protocol/test/events/**
- protocol/src/link/messages.ts (insertions only)
- module/src/events/**
- module/test/events/**
- module/src/main.ts (insert the event tap install call only)

## Goal
Turn what the user's own client sees into a stream of small, sequenced events
sent to the gateway: chat and rolls, combat lifecycle, document changes for the
listed types, user presence, scene changes, approvals and agent actions. Rapid
updates to one document are coalesced.

## Context
- docs/plan/specs/2026-10-09-agent-gateway.md:163-173 — event types, shape, visibility by construction, seq, gap, coalescing
- module/src/approvals/** hooks (16)

## Acceptance
- [ ] `protocol/src/events/` defines `AgentEvent` `{seq, ts, type, userId, doc?: {uuid, type, name}, summary}` with summary max 200 chars and a type enum covering chat, roll, combat_start/end/turn/round, create/update/delete for Actor, Item, JournalEntry, Scene, Token, user_join/leave, scene_change, approval_requested/resolved, agent_action, gap; no full document payloads (test)
- [ ] New link message `event {event}`; seq strictly increasing per connection from 1, reset only on a new connection
- [ ] Hooks registered: `createChatMessage`, `combatStart`, `combatTurn`, `combatRound`, `deleteCombat`, create/update/delete for each listed type, `userConnected`, `canvasReady`, `agentGateway.approvalRequested/Resolved`; events from this module's own agent calls carry `agent_action` or a flag
- [ ] Updates to the same uuid within `COALESCE_MS` (500, shared config object) produce one event (fake-timer test)
- [ ] Events are only produced for documents visible to `game.user` (test with a hidden token and a whisper)
- [ ] `npm run verify` passes

## Out of scope
- Gateway buffer, gap events and polling tools (28)
- Offline retention (29)
