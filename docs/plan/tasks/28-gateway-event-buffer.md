# 28 — Add the gateway event buffer with events_poll and events_history

**Repo:** .
**Depends on:** 27, 20
**Owns:**
- gateway/src/events/**
- gateway/test/events/**
- gateway/src/store/** (new migration only)
- gateway/src/routing/** (gateway-handled tool dispatch only)
- protocol/src/tools/events-poll.ts
- protocol/src/tools/events-history.ts
- protocol/src/tools/index.ts (insertions only)

## Goal
Buffer each connection's events in the gateway, mark disconnections with an
explicit gap event, and expose them to agents through `events_poll` (long-poll,
cursor-based) and `events_history`. These are the first tools handled by the
gateway rather than the module.

## Context
- docs/plan/specs/2026-10-09-agent-gateway.md:163-173 — buffer size, retention, poll limits, gap event
- protocol/src/events/** (27); gateway/src/routing/** (11, 20); gateway/src/store/** (06)

## Acceptance
- [ ] Ring buffer per `(worldId, userId)` of `EVENT_BUFFER_SIZE` (10000) in SQLite; oldest dropped first
- [ ] On reconnect the gateway inserts `gap` with `missed` = count it can infer (module reports its last sent seq in `hello`, added here as an optional field) or `unknown`
- [ ] `events_poll` (player, read, `handledBy: 'gateway'`): args optional `after` seq, `limit` (max 100); waits up to 25 s when nothing is new; returns events and `nextAfter`
- [ ] `events_history` (player, read, gateway): args `since` ISO time, `types` filter, `limit` max 100; only listed when the bound connection has offline reading enabled (stubbed false until 29)
- [ ] `coverage.test.ts` in the module still passes (gateway tools exempt by `handledBy`)
- [ ] Tests: long-poll wake on new event, timeout empty result, gap insertion, buffer eviction
- [ ] `npm run verify` passes

## Out of scope
- Retention window, purge and world setting (29)
