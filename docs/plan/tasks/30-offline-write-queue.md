# 30 — Queue writes attempted while the world is offline

**Repo:** .
**Depends on:** 21, 28
**Status:** Source `57adb9ac24903db62a5ffc1d38887133dcda4d7c` / bundle `84ea050e388ad8b105987ffd9cb988c5bc486c73181dbc005fe0bd7e1964cd0d` passed bounded GM native acceptance on Foundry 13.351/14.369. Final harness `682c2915d875db23d3ec222cbb5170a4afad2061` passed build/lint, 3,509 fast / 2,227 slow tests and both reviews. Final harness/validation publication pending; task remains active until merge. Further native writes require fresh scoped consent.
**Owns:**
- gateway/src/offline-queue/**
- gateway/test/offline-queue/**
- gateway/src/store/** (new migration only)
- gateway/src/routing/** (offline branch only)
- protocol/src/link/messages.ts (insertions only)
- module/src/approvals/** (accept replayed requests only)
- gateway/src/mcp/session.ts (owned offline write admission and queued approval_status only)
- gateway/src/link/server.ts (authenticated queued receipt/status ingress and reconnect delivery only)
- gateway/src/link/registry.ts (trusted queued delivery metadata/correlation only)
- gateway/src/app.ts (queue service/catalog persistence lifecycle wiring only)
- gateway/src/store/store.ts (typed queue/catalog repository access only)
- gateway/src/store/migrations/005-offline-queue.ts (new)
- gateway/src/store/migrations/index.ts (static registration only)
- gateway/src/routing/toolsets.ts (accepted validated per-pair replay catalog and restrictive invalidation only)
- gateway/test/mcp/** (offline write/status binding only)
- gateway/test/link/server.test.ts (queue frames/authentication/version only)
- gateway/test/routing/toolset.test.ts (validated catalog/restrictive invalidation only)
- gateway/test/store/store.test.ts (queue migration/persistence only)
- module/src/link/client.ts (strict queuedCalls receipt/status send and replay callback only)
- module/src/link/bridge.ts (trusted replay ingress with current native user identity only)
- module/src/link/runtime.ts (queue callback installation only, if required)
- module/src/ops/types.ts (trusted dispatcher replay metadata only)
- module/src/ops/dispatch.ts (fresh admission/category validation and forced approval provenance only)
- module/src/policy/stage.ts (forced owner approval floor after ordinary policy decision; deny/disabled remain stricter)
- module/src/tools/approval-status.ts (same replay receipt lookup only, if required)
- module/src/apps/approval/index.ts (replay request view sessionAllowed derivation only)
- module/test/apps/approval/view.test.ts (replay hides session action; preserve ordinary/code behavior)
- module/test/link/client.test.ts (queue frames/major6 only)
- module/test/link/bridge.test.ts (trusted replay identity/provenance only)
- module/test/ops/dispatch.test.ts (replay admission/provenance only)
- module/test/approvals/** (forced once-only replay, durable receipts, status and recovery)
- module/test/policy/** (replay policy floor and current deny/disabled only)
- protocol/src/link/version.ts (major6)
- protocol/src/tools/approval-status.ts (honest queued/uncertain receipt status only)
- protocol/test/link/link.test.ts (strict replay messages/major6)
- protocol/test/tools/rules/** (canonical approval_status schema fixtures only)
- lang/en.json (insertions under AGENT_GATEWAY.Approvals.* for replay/uncertain UI text only)


## Goal
When an agent attempts a non-read tool while its world is offline, the gateway
stores the call and returns `pending_approval`; on the next connection it
submits the queued calls, which go through normal policy and approval.

## Context
- docs/plan/specs/2026-10-09-agent-gateway.md:173 — writes attempted offline queue for approval on next launch
- gateway/src/routing/** (11, 20, 28); module/src/approvals/** (16)

## Acceptance
- [x] Offline non-read calls are stored in SQLite (args capped by the frame limit) and return `{status:'pending_approval', id}` with text explaining the world is offline
- [x] On reconnect the gateway sends `queuedCalls [...]`; module submits each as an approval request (never auto-allowed, even if policy is `allow`) and keeps the same id so `approval_status` works across the gap
- [x] Ordinary module-owned reads while offline still return `WORLD_OFFLINE`; preserve Task29-authorized gateway event reads and owner-scoped queued `approval_status` as explicit exceptions.
- [x] Queue entries expire after 7 days (named constant) and report `expired`
- [x] Integration test with the fake module client from 11
- [x] `npm run verify` passes

## Out of scope
- Event buffering (28, 29)

## Bounded replay contract

- Use protocol **6.0.0** for strict `queuedCalls` and correlated queue receipt/status frames; upgrade both peers and test rejection of major5 in both directions. Preserve Task29 policy/purge/event frames. Queue IDs are gateway-generated bounded random IDs, distinct from transport call IDs and passed unchanged to module approval and `approval_status`. Caller arguments cannot supply replay provenance, approved state, identity or receipt ID.
- Queue only well-formed known module-owned non-read tools for an exact active authenticated pairing `(worldId,userId,agentId)`. Freeze original session ID, canonical tool definition/category/schema snapshot and exact bounded serialized argument bytes/hash at gateway receipt. Persist a per-pair catalog only from accepted validated fresh announcements; unknown/unseen tools, reads, malformed input, rejected or restrictive-invalidated catalog state cannot enter the queue. Support core and previously announced pack tools without name-only trust. Queueing records intent, never current write permission; read-allow metadata cannot grant writes. No fallback to another user/agent, implicit name-only offline binding or inherited replacement-pair rows. Existing exact-ID/session pinning rules apply and every status lookup remains owner-isolated.
- Bound named constants to 20 nonterminal entries per pairing, 500 globally, and 7 days from gateway receipt clock. Apply frame limits to each serialized call and bounded delivery batches (at most five entries, total encoded frame within MAX_FRAME_BYTES). Transactional cap enforcement, static migration, startup expiry and one owned periodic cleanup timer must survive restart and close cleanly. Reject over-cap work with RATE_LIMITED before commit. Keep bounded terminal/status receipts for a named 7-day period and refuse additional storage rather than unbounded growth; no silent eviction of executable pending intent.
- Return `{status:'pending_approval',id}` immediately after durable commit, with text explicitly saying the world is offline, the intent is queued and no human has approved or execution occurred. A persistent receipt survives MCP session close. Request abort before the synchronous commit prevents insertion; after an accepted receipt there is no new public cancellation tool in this scope. Do not present transport disconnection as cancellation. Expire undelivered entries after 7 days and report `expired` without replay; an approval's existing shorter lifetime may expire it sooner after presentation, never extend the original queue deadline.
- On reconnect, require the exact current authenticated pairing and fresh valid announced tool definition/category/schema matching the stored bounded canonical snapshot. Revalidate current native user, role, agent enablement, tool availability, arguments, effective category and policy through the ordinary dispatcher. Run existing core read-only source admission before showing the approval, including complete current macro/script source; pack admission and unsafe tool changes must fail closed. Caller values never override core preparation or immutable approval hashes. No stale offline policy, earlier session grant or prior read permission authorizes execution.
- Every replay that survives current policy requires a **fresh explicit once approval**. Policy deny/disabled remains deny; ask_gm remains GM; allow is raised to an owner-approval floor, with any stricter effective-category rule preserved. Session grants cannot auto-approve or be created from replay. The native replay request view must hide the session action, and the manager must independently reject forged session decisions. Bind the unchanged queue ID to exact owner/tool/args/prepared-source/category and recheck them plus policy/permission immediately before execution. Replay metadata enters only through the authenticated link bridge and dispatcher-owned context; direct public args, pack handlers and ordinary calls cannot forge it. Preserve code's existing full-source once-only restrictions and normal audit correlation for actual executions.
- Record a durable module replay receipt/in-progress guard before dispatching an executable replay, and transactionally claim gateway entries before delivery. Duplicate batches/frames, ID collisions, reordered replies and replaced connections cannot re-execute a live handler or alter another receipt. Correlated status updates are accepted only from the exact current owner connection for the claimed immutable receipt. Gateway `approval_status` can report queued/pending/expired/terminal state while offline, but must distinguish queued intent and uncertain outcome from native approval. Preserve existing ordinary module approval semantics and text-only delayed-result limits.
- Do not promise exactly-once effects across browser/gateway crashes. A delivered/claimed entry whose execution outcome cannot be established must become an explicit bounded `unknown` receipt, with text requiring reconciliation; never blindly resend an executable replay after restart/disconnect or receipt eviction. No automatic retry, rollback or new cancellation API is implied. Known terminal outcomes may be returned idempotently from retained receipts. Expiry/revocation/stale policy must prevent pending execution; active-pair checks and session ownership rechecks apply on status, delivery and completion. Immediately before executable continuation, recheck the original queue deadline plus the exact current authenticated replay connection/agent and native policy/permission. Disconnect or observed pairing revocation invalidates pending replay; uncertain outcomes remain unknown and are never retried. This does not claim Task18-style discovery of remote revocation while unreachable.

## Required regression and native limits

- Real SQLite reopen/receipt-clock expiry/caps and fake-clock cleanup lifecycle; exact world/user/agent/session binding, revoked/replaced/multiple pairings, no name fallback, cross-owner status privacy and no read queueing. Validated core/pack catalogs must cover malformed/capped/restrictive updates and exact definition/schema changes without stale admission.
- Real link/MCP replay tests using the existing fake module client: durable immediate receipt, reconnect approval with unchanged ID, forced once under allow and existing session grants, stricter GM/deny/disabled after queueing and during approval, full macro/script source admission, changed args/source/definition/category, forged provenance/replies, duplicate batches, pending/terminal status and text-only delayed results.
- Abort before commit versus accepted receipt surviving session close; expiry before replay and during pending approval, disconnected/restarted uncertain delivery with no re-execution, durable duplicate/in-progress guard and honest unknown outcome. Verify actual handler/audit invocation counts, not only queued records. All existing online calls and Task29 offline gateway reads must retain their behavior.
- Native validation is not authorized by implementation permission. After source gates/review, propose fresh exact human consent for isolated gateway storage and harmless temporary world fixtures, a real owner/GM once approval and exact cleanup. Do not replay arbitrary existing offline writes, mutate production queue/history or export private evidence. No native Task30 result or deployment may be inferred from Task29 acceptance.

## Resolved review defect — queued result failure state

PR #80 review identified that an explicitly approved replay whose handler fails loses the existing `storedResult.failed` flag across queued status, persistence and gateway `approval_status`. The repair preserves a strict optional boolean `resultFailed` through the correlated protocol, browser receipt/duplicate response, SQLite receipt and gateway status response. Approval state remains distinct from execution success: an approved failed call must retain its failure evidence. Static migration006 upgrades existing migration005 databases without rewriting their installed schema. Legacy receipts keep an unset failure flag instead of inventing success. Regression checks cover failed approved handlers, durable reopen and duplicate terminal responses, while successful/pending receipts retain their existing semantics. PR #80’s queued execution-failure repair is verified at source `57adb9ac24903db62a5ffc1d38887133dcda4d7c`. Combined source/harness `acd25697fd44e881014d138f75066db0d67f53c0` passed build/lint and 3,505 fast / 2,227 slow tests; both independent reviews passed. The prepared harness is pinned to that source and bundle `84ea050e388ad8b105987ffd9cb988c5bc486c73181dbc005fe0bd7e1964cd0d`, with 13 offline harness checks including actual tsx browser-callback serialization. At that source-only checkpoint, native acceptance was pending and Task30 live writes were not authorized. The later consented bounded runs are recorded below.

## Bounded native acceptance record

Human-approved bounded Task30 acceptance passed on Foundry 14.369 and 13.351 at source `57adb9ac24903db62a5ffc1d38887133dcda4d7c` / bundle `84ea050e388ad8b105987ffd9cb988c5bc486c73181dbc005fe0bd7e1964cd0d`. Each passing run used one temporary GM-private NPC, two name-only offline queued updates and an isolated gateway database with read-only credential import. Twelve SDK calls settled: two queued intents, eight owner receipt reads, one cross-owner status refusal and one ordinary offline-read refusal. Receipts survived isolated database reopen before delivery. A fresh native once approval executed one rename and returned `resultFailed:false`; a deliberate native denial retained its complete reason identically in the gateway receipt. Exact duplicate terminal delivery and a final reconnect left the Actor version and single matched mutation audit unchanged. Exact fixtures were deleted, original documents/settings/views/world time and credential databases remained unchanged, and each passing run retained one audit.

The initial v14 attempt failed before human approval because a 15-second harness pending wait was shorter than the real 25-second approval wait. No queued tool mutation or audit occurred; its two isolated receipts became unknown. The fenced recovery started no gateway, blocked every WebSocket except native Foundry Socket.IO, verified expired nonexecutable native metadata and exact unchanged fixture custody, then deleted only that fixture. The initial v13 attempt executed one approved rename and a deliberate denial, then failed a strict reason assertion because the human added a trailing comma. It retained one audit and cleaned up; duplicate/final-reconnect checks were not reached. The reviewed correction compares the full bounded native reason exactly with the gateway result and requires the run tag, preserving punctuation. Both failed attempts remain failures and are fully cleaned up. Total retained audits across failed and passing runs are one on v14 and two on v13.

Native coverage uses the actual GM `ask_owner` policy. Forced approval under allow/session grants, TTL/caps, claimed-crash unknown recovery, policy/source/definition tightening and native failed-execution results remain offline-test coverage. No installed deployment, exactly-once crash guarantee or Task18 resolution is claimed. Final verification and exact per-version harness pins are recorded in `docs/plan/HISTORY.md`. Private fixture identifiers and raw evidence are not published.
