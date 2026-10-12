# 29 — Add offline event reading with retention and purge

**Repo:** .
**Depends on:** 28, 15
**Status:** Source merged in PR #76; bounded GM native acceptance passed on Foundry 13.351/14.369 at `88b27ca` / bundle `d19791ab`. Source verification passed build/lint and 3,427 fast / 2,227 slow tests. Reusable-harness publication and its combined required gate remain pending; contract stays active until the validation record merges.
**Owns:**
- module/src/events/offline-setting.ts
- module/src/apps/policy/** (offline-reading section only)
- templates/policy/** (offline-reading section only)
- protocol/src/link/messages.ts (insertions only)
- gateway/src/events/**
- gateway/test/events/**
- module/src/settings/index.ts (insertions only)
- lang/en.json (insertions under `AGENT_GATEWAY.OfflineEvents.*` only)
- docs/security.md
- module/src/link/runtime.ts (offline policy installation and setting refresh only)
- module/src/link/client.ts (typed event policy/purge send and reply delivery only)
- module/src/apps/policy/model.ts (offline controls only; already within policy app scope)
- module/test/events/offline-setting.test.ts (new)
- module/test/apps/policy/policy.test.ts (offline controls/GM guards only)
- module/test/settings/settings.test.ts (new world setting registration only)
- module/test/settings/main.test.ts (faithful registered-setting count and offline-setting identity only; preserve init/ready assertions)
- module/test/link/client.test.ts (new frames/replies and protocol version fixtures only)
- module/test/link/lifecycle.test.ts (faithful new installer fixtures only if required)
- gateway/src/link/server.ts (authenticated eventPolicy/purgeEvents handling only)
- gateway/src/mcp/session.ts (gateway event offline listing/binding/dispatch only)
- gateway/src/routing/toolsets.ts (persist restrictive event-read authorization transitions)
- gateway/src/routing/binding.ts (known exact-ID offline event binding only, if needed)
- gateway/src/store/store.ts (typed persisted event policy integration only)
- gateway/src/store/migrations/004-event-policy.ts (new)
- gateway/src/store/migrations/index.ts (registration only)
- gateway/src/app.ts (retention startup/shutdown wiring only)
- gateway/test/link/server.test.ts (new authenticated frames and version fixtures)
- gateway/test/routing/events.test.ts (offline authorization/listing/pending integration)
- gateway/test/routing/binding.test.ts (exact offline identity binding only)
- gateway/test/routing/toolset.test.ts (persisted restrictive authorization only)
- gateway/test/store/store.test.ts (new migration/persistence only)
- protocol/src/link/version.ts (major 5)
- protocol/src/events/index.ts (enable history capability and bounded policy constants only)
- protocol/test/link/link.test.ts (strict new frame schemas/major compatibility)
- protocol/test/events/events.test.ts (history capability/bounds)

## Goal
Let a GM choose whether agents may read buffered events while the world is
offline, with a retention window and a purge button. Gateways honour the setting
in software; the docs must say so plainly.

## Context
- docs/plan/specs/2026-10-09-agent-gateway.md:175-178 — offline event reading setting, default off, 14-day retention, purge, honour by software

## Acceptance
- [ ] World setting `offlineEventReading {enabled:false, retentionDays:14}` edited in the policy app (GM only), with a "Purge buffered events" button
- [ ] Module sends link message `eventPolicy {enabled, retentionDays}` on connect and change; `purgeEvents` on button press; gateway deletes all buffered events for that world and replies with a count shown in a notification
- [ ] When disabled, gateway refuses `events_poll`/`events_history` while the connection is offline with `WORLD_OFFLINE`, and `events_history` is not listed
- [ ] Gateway deletes events older than the retention window hourly and on start (fake-clock test)
- [ ] `docs/security.md` gains a section stating that player gateways enforce this by software, not cryptography
- [ ] `npm run verify` passes

## Out of scope
- Offline write queueing (30)

## Bounded design and trust

- Use protocol **5.0.0** for the new strict frames; upgrade both peers together and test rejection of major4 peers in both directions. Do not introduce a second capability framework. Existing native event/cursor formats and strict public schema boundaries remain unchanged.
- Register world-scoped `offlineEventReading` as `{enabled:false, retentionDays:14}`. Retention is an integer 1–365 days. Invalid/missing values fail closed to default disabled; no caller-provided world/user/agent identity is accepted. GM-only policy UI validates and freshly checks the canonical current native GM before and after awaited setting saves/purge submission. Other owner-policy controls remain unchanged.
- `eventPolicy {enabled, retentionDays}` comes from the current authenticated paired module on each welcome and setting change. Persist the accepted world policy plus current pairing-specific read authorization (`worldId,userId,agentId`). Restrictive metadata transitions must persist even if tool definitions are rejected, retaining Task28's P1 behavior; malformed/error paths cannot leave old offline allow authority. Missing policy or permission never grants access. A fresh connection must withhold/clear older pairing read permission until that connection accepts a valid affirmative announcement; connect-then-disconnect without metadata cannot revive an earlier offline allow.
- This is cooperative **software enforcement**, not cryptographic world-policy or GM attestation. The gateway trusts its authenticated paired module's policy observation; it cannot discover world changes while unreachable. Last accepted policy is used offline until a later authenticated update arrives. This does not solve Task18's cross-owner/offline immediate invalidation blocker, and hello role hints must not be described as trusted native GM evidence.
- All event reads require an active, unrevoked exact pairing and fixed world/user/agent ownership. Online reads require fresh current-connection read allow. Offline reads additionally require persisted world enable and that exact pairing's last accepted explicit read allow. Ask/deny/disabled/missing state cannot grant offline reads. A replaced pairing cannot inherit old rows or authorization. No fallback to another connected user or name-only offline first binding; use an already-bound identity or an unambiguous persisted exact-ID selection. Recheck authorization at every completion and after awaits; revocation/disable must wake pending polls without exposing data.
- Enabled offline `events_poll` reads only already-buffered rows and returns immediately (no fictitious offline live wait or new events). Enabled `events_history` is listed and uses existing bounded receipt-time `since`, optional types and limit schema, same owner isolation and retained cursor semantics; it may be used online under the same world enable/read allow. Disabled offline calls return WORLD_OFFLINE; disabled history is hidden and directly refused. Ordinary online poll remains usable while offline reading is disabled.
- Persist settings/authorization in a statically registered migration, not runtime filesystem discovery. Initialize retention on gateway start and run one owned hourly timer; clear it on shutdown. Delete rows by gateway receipt timestamp older than the world's retention window, regardless of read enable, with bounded per-world configuration. Use fake clocks to prove startup/hourly boundaries and cleanup lifecycle.
- Retention and purge delete payload rows transactionally while preserving monotonic cursor high-water and truthful evicted-floor indicators. Never reuse cursor values or imply deleted data is complete history. Waking readers after deletion must reauthorize and report a gap when appropriate.
- `purgeEvents` contains only a bounded request ID; derive its world from the authenticated current connection. Legitimate module initiation is freshly GM-guarded. Purge all buffered event payloads for that world at this receiving gateway, across its stored users/pairings, and no other world; return `purgeEventsResult {requestId,count}` to the same current connection. Do not delete pairing credentials, world policy, authorization or cursor high-water. Match the bounded pending module request/current connection before displaying the count, and bound outstanding requests/timeouts; unsolicited/foreign/duplicate replies cannot show success. No gateway-independent GM attestation or remote gateways' purge is promised.

## Required regressions and native acceptance limits

- Exercise real authenticated link/MCP offline flows: enabled/disabled/missing policy, fresh online vs persisted offline allow, ask/deny/disabled revocation, invalid/capped toolset revocation persistence, pairing replacement/revoke, cross-world/user/agent isolation, exact-ID binding and no name fallback; pending waiters release on policy/purge/revoke/shutdown.
- Test world-only purge/count/request binding, forged identity fields/replies, stale connection/GM demotion during awaited UI operations, non-GM controls, empty purge and retained cursor progression; fake-clock retention startup/hourly and world-specific windows, SQLite reopen and static migration bundling.
- Preserve Task28's schema exception, polling caps, native stream sequence/gateway cursor separation and authenticated gateway-gap ownership. No output validation weakening or unbounded history is permitted.
- Native acceptance remains pending until a reviewed exact fixture plan receives fresh human consent. Settings changes and purge are consequential: use an isolated gateway DB with dedicated temporary Actor events, record/restore original world setting under fresh custody guards, verify actual participant permissions without changing unrelated policies, and purge only isolated test-buffer payloads. No existing gateway DB/world history deletion, credentials, public evidence upload or broad native effects are authorized by implementation permission alone.
