# 28 — Add the gateway event buffer with events_poll and events_history

**Repo:** .
**Depends on:** 27, 20
**Owns:**
- gateway/src/events/**
- gateway/test/events/**
- gateway/src/store/migrations/003-events.ts (new migration)
- gateway/src/store/migrations/index.ts (migration registration only)
- gateway/src/store/store.ts (typed event repository integration; no raw database exposure)
- gateway/src/link/server.ts (authenticated event ingress and reconnect integration only)
- gateway/src/mcp/session.ts (gateway tool listing, authorization and dispatch only)
- gateway/src/mcp/server.ts (legacy server must exclude unsupported gateway event tools)
- gateway/test/mcp/server.test.ts (legacy event-tool exclusion assertions)
- gateway/src/routing/toolsets.ts (eventReadAllowed validation/storage and authorization-change notification)
- gateway/test/routing/toolset.test.ts (authorization-only metadata refresh tests)
- gateway/src/app.ts (event service composition and shutdown only)
- gateway/test/link/server.test.ts
- gateway/test/routing/** (event authorization/session integration tests only)
- gateway/test/mcp/output-schema.test.ts (gateway event schemas only)
- gateway/test/store/store.test.ts (event migration/persistence integration only)
- protocol/src/events/index.ts (buffered event/gap schemas and bounded configuration)
- protocol/src/link/messages.ts (resume hello and event-read toolset metadata only)
- protocol/src/link/version.ts (protocol major 4)
- protocol/test/events/events.test.ts
- protocol/test/link/link.test.ts
- protocol/src/tools/rules.ts (bounded output-union/depth allowance for these two trusted core gateway definitions only)
- protocol/test/tools/rules/validate.test.ts (two canonical examples and scoped output-schema regressions only)
- module/src/link/client.ts (last successfully sent event resume metadata only)
- module/src/link/toolset.ts (event-read authorization metadata only)
- module/src/link/runtime.ts (existing policy evaluator wiring only)
- module/test/link/client.test.ts
- module/test/link/toolset.test.ts
- module/test/link/lifecycle.test.ts (faithful metadata/version fixture changes only)
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
- docs/plan/specs/2026-10-09-agent-gateway.md:264-281 — buffer size, retention, poll limits, gap event
- protocol/src/events/** (27); gateway/src/routing/** (11, 20); gateway/src/store/** (06)

## Acceptance
- [ ] Ring buffer per `(worldId, userId)` of `EVENT_BUFFER_SIZE` (10000) in SQLite; oldest dropped first
- [ ] On reconnect the gateway inserts `gap` with `missed` = count it can infer (module reports its prior connection ID and last successfully sent event seq in optional `hello` resume metadata) or `unknown`
- [ ] `events_poll` (player, read, `handledBy: 'gateway'`): args optional `after` gateway cursor, `limit` (max 100); waits up to 25 s when nothing is new; returns events and `nextAfter`
- [ ] `events_history` (player, read, gateway): args `since` ISO time, `types` filter, `limit` max 100; only listed when the bound connection has offline reading enabled (stubbed false until 29)
- [ ] `coverage.test.ts` in the module still passes (gateway tools exempt by `handledBy`)
- [ ] Tests: long-poll wake on new event, timeout empty result, gap insertion, buffer eviction
- [ ] `npm run verify` passes

## Bounded integration and authority
- Preserve native `AgentEvent.seq` as connection-local. Return buffered entries as
  `{cursor, event}` with a positive safe-integer, durable, monotonically increasing
  gateway cursor per `(worldId,userId)`. `after` and `nextAfter` refer to that cursor;
  reads never consume entries. Empty initial `nextAfter` is 0; entry cursors remain positive. No cursor reuse after eviction or re-pairing.
- Gateway-generated gap entries have explicit `missed: nonnegative integer | 'unknown'`
  and constant summary, with no invented native event sequence. Their schema is
  distinguishable from native events within the buffered-entry union. Only the
  gateway creates gap records; a module-supplied gap is refused.
- Store gateway receipt time separately from the client's event timestamp; history
  `since` uses receipt time. Validate all stored ingress with bounded protocol schemas.
  Reject duplicate/non-increasing native seq within the authenticated connection;
  never accept payload world/user identity as routing authority.
- Rows are additionally owned by the authenticated pairing `agentId`. A newly paired
  agent cannot read a previous agent's rows for the same world/user. Check the active,
  unrevoked pairing on every call and again before completing a waiting poll.
- Resume metadata is tied to the prior welcome connection ID and same gateway URL,
  world/user and credential. Infer only same-stream sent-but-unreceived trailing
  events when the prior stream is known. Missing/mismatched metadata, browser or
  gateway restart, and unobserved offline activity yield `unknown`; never claim a
  count of offline Foundry changes. First-ever connection has no reconnect gap.
- Protocol becomes `4.0.0`: strict older hello/toolset schemas cannot accept these
  fields safely. Test both mixed-major directions with the existing upgrade error.
- Toolset frames gain optional `eventReadAllowed`, defaulting false. The module
  derives it from the existing policy evaluator for `read`: true only for `allow`,
  including player/headless enable switches and world/owner policy meet. Existing
  policy/role refresh updates this metadata even when tool names are unchanged; the gateway notifies authorization subscribers on metadata-only changes.
  Do not announce these gateway tools as module handlers or forward them to Foundry. The legacy MCP server, which lacks the event service, must exclude these tools rather than advertise unsupported or unauthorized calls.
- List/call `events_poll` only for the exact bound live connection with a fresh
  affirmative metadata announcement and active pairing. Before announcement, on
  policy ask/deny/disabled, revocation, disconnect or replacement, fail closed;
  pending polls reject and release timers/listeners. No approval or module audit
  claim: ask-policy event reads remain unsupported rather than silently allowed.
- `events_history` is implemented/tested as a gateway read, but offline-reading
  capability is always false in this task: omit it from lists and refuse direct
  calls with `FORBIDDEN`. Task29 owns enabling it and retention/purge settings.
- One pending long-poll per MCP session, at most 64 gateway-wide; reject excess
  with a bounded error. All paths, cancellation, session/server close and policy
  changes release resources. Multiple sessions read independently. No extra
  module rate-budget charge is implied by these gateway concurrency limits.
- Omitted `after` reads from the retained beginning. A supplied cursor older than
  the evicted floor returns an explicit bounded cursor-gap indication; never
  silently represent an incomplete interval as complete. Future cursors are
  rejected. Limit defaults to 100 and is bounded 1..100; empty timeout preserves
  the caller cursor. SQLite append/eviction/cursor advancement is transactional.
- Preserve strict runtime native/gateway-gap union validation and truthful MCP output
  schemas. The conservative rules may allow `anyOf` with at most 2 variants and
  object depth at most 4 in these two core gateway output schemas only; inputs and pack schemas
  retain existing limits. Eligibility must come from the static trusted core
  validation entrypoint/definition identity, never a caller-supplied tool name or
  origin claim; document and test that boundary. Test excessive/recursive/malformed unions and unrelated
  definitions remain refused; keep existing traversal/byte/branch budgets bounded.
- Tests cover durable reopen/cursor monotonicity, exact 10000 eviction, receipt-time
  history/filtering, two-user/world/agent isolation, pre-auth/forged ingress,
  replay seq, honest reconnect gaps, policy refresh and revocation during poll,
  cancellation/resource bounds, direct hidden history refusal and real MCP
  gateway execution without module call forwarding. Existing gateway/toolset
  behavior and module coverage assertions remain intact.

## Native acceptance boundary
After source gates and independent review, propose a separate consent-scoped proof
on Foundry13/14. Use an isolated gateway database and exact user bindings; verify
real module events reach player-specific `events_poll`, timeout/wakeup, cursor
continuation and one owned transient reconnect gap. Deterministic temporary fixture
updates/cleanup require fresh human approval. Do not reuse Task27 consent or claim
its historical native proof tested protocol4/buffering. No native world effects are
authorized by this contract alone; history remains unavailable until Task29.

## Out of scope
- Retention window, purge and world setting (29)
