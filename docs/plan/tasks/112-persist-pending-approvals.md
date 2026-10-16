# 112 — Keep pending approvals when the requesting player logs out or reloads

**Repo:** .
**Depends on:** 109, 117
**Status:** Ready after 109 merges. Decisions recorded below (2026-10-16). Owns follows the
architect pass of 2026-10-16, plus the server.ts dispatch, the version gate and the module send
method that the new frame implies.
**Owns:**
- protocol/src/link/messages.ts — insertion only (a shared insertion-only file): the new
  `ApprovalStateMessage` schema and its entry in the `LinkMessage` union (:366)
- protocol/src/link/version.ts (`PROTOCOL_VERSION` 7.1.0 -> 7.2.0 and its doc comment only)
- protocol/test/link/approval-state.test.ts (new)
- gateway/src/store/migrations/014-approval-alias.ts (new; a shared folder, one new file)
- gateway/src/store/migrations/index.ts (insertions only: one import, one array entry)
- gateway/src/offline-queue/repository.ts (new methods for alias rows; `disconnected` at :215-219
  may exclude alias rows from its `unknown` sweep, nothing else in the existing statements changes)
- gateway/src/offline-queue/service.ts (the `disconnected` handler at :37-43, a new `approvalState`
  entry point, and the requeue of orphans; `enqueue` only for the offline-retry dedupe)
- gateway/src/link/server.ts (insertion only: one `case 'approvalState'` in the inbound switch at
  :452, beside `queuedStatus` at :509, forwarding to the queue like that case does)
- gateway/src/mcp/session.ts (the `approval_status` branch at :431-461, and the `registry.call`
  success return at :520-560 for row creation on `pending_approval` only)
- gateway/test/offline-queue/approval-alias.test.ts (new)
- gateway/test/link/approval-state.test.ts (new)
- gateway/test/mcp/approval-alias-session.test.ts (new)
- module/src/approvals/manager.ts (emitting `approvalState` on each transition of a record created
  in this page session; no change to `load()`, `bindsTo`, `reviewArgs` or the 109 retry lookup)
- module/src/approvals/live.ts (the reconnect hook at :78-82: send the post-hello list)
- module/src/link/client.ts (insertion only: one public method that sends an `approvalState` frame
  when `protocolAtLeast(this.gatewayProtocol, '7.2.0')`, as at :935, and drops it otherwise)
- module/test/approvals/approval-state.test.ts (new)

## Goal
A write waiting for approval lives only in the requesting player's tab: in memory, with its
history in that browser's localStorage. If that player logs out or reloads, the request is gone.
On load, stored pending records are marked expired, a GM who connects later sees nothing, and the
agent must call again. Make a pending approval survive the requester's tab going away, so that it
is asked again when they return, without ever letting stored or replayed data run anything a human
has not approved in a live session.

## Decisions (2026-10-16, Andrew, relayed via the Mac session)
1. **Decision (2026-10-16, Andrew, relayed via the Mac session): option A**, the gateway via the
   offline queue.
2. **Decision (2026-10-16, Andrew, relayed via the Mac session): always re-ask.** A carried-over
   approval is asked for again; a module-reported earlier approval is never honoured.
3. **Decision (2026-10-16, Andrew, relayed via the Mac session): the offline queue's existing
   retention.** A carried-over row lives until its existing `expires_at` (`QUEUE_CONFIG.ttlMs`,
   7 days, gateway/src/offline-queue/repository.ts:10) and is cleaned up after `retainMs`.

## Approach (from the architect pass, 2026-10-16)
Facts it rests on: a live approval's id is made by the module (module/src/approvals/manager.ts:172,
:421), not a queue id; the gateway never learns when a live approval resolves; and the queue's
disconnect hook turns `pending` and `claimed` rows into `unknown`
(gateway/src/offline-queue/service.ts:37-43, repository.ts:215-219).

1. **Migration 014** adds `approval_alias` (the module's approval id) to `queued_calls`, with a
   unique index on (world, user, agent, approval_alias), and optionally `orphaned_at`.
2. **New link frame `approvalState`** (module to gateway; protocol 7.2.0). Two forms in one strict
   schema: a transition (`id`, `state` in pending/approved/denied/expired), sent on each
   transition of a record created in this page session; and a list of still-pending ids, sent
   once after each `welcome`. Bounded: ids at most 64 chars, the list at most a named constant
   no larger than 256. The module sends it only to a gateway
   whose `welcome.protocolVersion` is at least 7.2.0. The gateway treats a connection that has
   sent the list as capable; it creates alias rows only on capable connections.
3. **Row creation.** When `registry.call` in session.ts returns `structured.status ===
   'pending_approval'` with an `id`, the gateway records a row: owner (world, user, agent),
   session, tool, the validated args, args_hash, `approval_alias = id`, the live connection id,
   state `pending`, and the existing `expires_at`. It skips the row when the tool's core definition
   declares a non-empty `redactArgs` (image_upload, task 53) or the args carry image bytes, and
   when the queue's own admission checks (validated catalog, definition match) would refuse the
   tool. A retry that returns the same alias (109's attach) does not create a second row: dedupe
   by (owner, tool, args_hash, alias).
4. **Tracking.** `approvalState` transitions update the alias row's last report: `approved`,
   `denied`, `expired` as reported. A row whose alias the gateway does not hold for that owner is
   ignored.
5. **Disconnect.** The disconnected handler orphans live alias rows instead of the `unknown`
   sweep: last report `pending` -> orphaned (still `pending`, `orphaned_at` set); last report
   `approved` -> `unknown` (never `queued`: it may have run). Non-alias rows keep today's
   behaviour.
6. **Next hello.** When the owner's next capable connection sends its post-hello list, orphans
   whose alias is in the list go back to live on the new connection (same-tab reconnect, 109).
   Orphans not in the list become `queued` and are delivered through task 30's replay path, so the
   module asks for approval again (Decision 2). Expiry is the row's `expires_at` (Decision 3).
7. **approval_status.** For an alias id, while the row is live the call is forwarded to the module
   as today; once orphaned or requeued it answers from the row (the queued text from task 102,
   `unknown` text for an `unknown` row, the replay's receipt once it has one). Owner-bound like
   `status` today.
8. **Offline retry dedupe.** While an orphaned or requeued alias row is open, an offline admission
   of the same call (owner, tool, args_hash) returns that row's alias id instead of a new row.

Residual risk (accepted): an `approved` frame lost as the socket dies leaves the row's last report
`pending`, so it is requeued and asked again; the module's replay guard still stops a second run of
the same queue id, but a human may see a second ask for a call that already ran. This is bounded
cooperative persistence (docs/architecture.md:99), not exactly-once.

## Context
- module/src/approvals/manager.ts:57-63 — the in-memory `records`, `waiters` and `inbox` maps.
- module/src/approvals/manager.ts:88-116 — `load()`: browser storage is untrusted history, so after
  a reload every unfinished record is expired. Unchanged by this task.
- module/src/approvals/manager.ts:172 `newId`, :376-464 `request` (record id at :421, `replayOf`
  for a queue replay), :286-300 `reviewArgs`/`bindsTo` (53).
- module/src/approvals/live.ts:78-82 — the reconnect hook (`representAll`).
- module/src/link/client.ts:208, :769, :935 — `gatewayProtocol` and the 7.1.0 gate pattern.
- gateway/src/offline-queue/repository.ts:10-22 (config and states), :133 (insert), :193-219
  (receipts and `disconnected`); service.ts:26-45 (connect and disconnect hooks), :89 (`enqueue`),
  :140 (`deliver`).
- gateway/src/link/server.ts:509-516 — `queuedStatus` forwarding, the pattern for `approvalState`.
- gateway/src/mcp/session.ts:431-461 — `approval_status` from the queue; :462-485 offline
  admission; :520-560 the live `registry.call` return.
- protocol/src/tools/define.ts:22-23 `redactArgs`; protocol/src/tools/image-upload.ts:16.
- docs/plan/done/30-offline-write-queue.md:74 — replay through the normal approval path, with
  claim and receipt guards against double execution.
- docs/architecture.md:95-101 — offline intent replay; bounded cooperative persistence.
- docs/conventions.md#shared-insertion-only-files.

## Acceptance
- [ ] Migration 014 adds `approval_alias` (and `orphaned_at` if used) with a unique index on
      (world, user, agent, approval_alias); existing rows and the existing repository tests are
      unaffected (`npm run verify` and the existing gateway/test/offline-queue suites pass
      unmodified).
- [ ] `ApprovalStateMessage` is added to protocol/src/link/messages.ts by insertion only
      (`git diff main -- protocol/src/link/messages.ts` shows only added lines), is a strict
      object, rejects an unknown state, an id over 64 chars and an over-long list
      (protocol test), and `PROTOCOL_VERSION` is 7.2.0.
- [ ] A module connected to a gateway that reports protocol 7.1.0 sends no `approvalState` frame
      (module test); a gateway receiving none creates no alias rows for that connection, so old
      module and new gateway (and the reverse) interoperate (gateway test).
- [ ] A live write that returns `pending_approval` on a capable connection creates exactly one
      alias row with `approval_alias` equal to the returned id; a retry returning the same id
      does not create a second (test).
- [ ] An `image_upload` call (core `redactArgs: ['data']`) that returns `pending_approval` creates
      no row; nor does any core tool with non-empty `redactArgs` (test).
- [ ] After the module reports `approved`, `denied` or `expired` for an alias, the row records it;
      a report for an alias the owner does not hold, or from another owner's connection, changes
      nothing (test).
- [ ] The requester's link closes with the alias row's last report `pending`: the row is orphaned,
      not `unknown`, and `approval_status` for the alias returns the queued text from task 102
      while the user is offline (test).
- [ ] The link closes with the last report `approved`: the row becomes `unknown` and is never
      requeued (test).
- [ ] On the owner's next capable connection, an orphan whose alias is in the post-hello list goes
      back to live and is not replayed (no second request in the module, asserted); an orphan not
      in the list becomes `queued`, is replayed through task 30's path and appears for approval
      again; approving it runs the call exactly once, and `approval_status` for the original alias
      returns the result (integration test).
- [ ] A record found in browser storage still never runs by itself: `load()` is unchanged and the
      existing module/test/approvals/* tests pass unmodified; records loaded from storage produce
      no `approvalState` transition (test).
- [ ] An orphaned row past its `expires_at` is `expired` and never replayed (test, fake clock).
- [ ] While an orphaned or requeued alias row is open, an offline call with the same owner, tool
      and args_hash returns that row's alias id and creates no new row (test).
- [ ] Rows carry the (world, user, agent) owner. Another user or another agent cannot read them
      through `approval_status`, update them through `approvalState`, or claim them (test,
      mirroring task 30's cross-owner refusal).
- [ ] `markClosed` in gateway/src/link/registry.ts is unchanged (`git diff main --
      gateway/src/link/registry.ts` is empty).
- [ ] `npm run verify` passes. A live check on Foundry v14 (player requests, logs out, logs back in,
      GM approves, the call runs once) is listed in the PR as done or pending Andrew.

## Out of scope
- GM-side inbox persistence (option B) and gateway-routed approvals (option C).
- Honouring an approval given before the tab closed (Decision 2: always re-ask).
- `markClosed`, the heartbeat and the module's same-tab retry attach (task 109).
- The existing offline admission of tools with `redactArgs` (session.ts:462-485 `enqueue`): this
  task only skips alias rows for them; changing offline admission is a separate task.
- The approval dialog UI, the policy matrix, and audit/undo.
- The offline-queue reply wording (task 102).
- Any change to `load()` or browser-storage trust.

## Amendment 1 (2026-10-16, orchestrator)
Andrew's three decisions are recorded above (option A, always re-ask, existing queue retention).
The approach, Owns and Acceptance are rewritten from the architect pass: migration 014, the
`approvalState` frame (insertion-only in protocol/src/link/messages.ts, protocol 7.2.0), alias row
creation on the `pending_approval` path, orphan and requeue on disconnect and next hello, and the
53 `redactArgs` exclusion. Depends on 109 only (102 has merged). Status: Ready after 109 merges.


## Options as put to Andrew (kept for the record; see Decisions)
1. **Where a pending approval is persisted.**
   - A. **Gateway, reusing the offline queue.** When the module replies `pending_approval` for a
     live call, the gateway records the intent (tool, args hash and args, owner) as a pending
     queue row. If the requester's link closes while the row is still pending, the gateway turns it
     into a `queued` intent. On that user's next connection it is replayed through task 30's path
     and asked for approval again. `approval_status` keeps answering the same id throughout.
     Execution stays in the requester's browser, under their Foundry identity.
   - B. **GM side.** The GM's client stores its inbox in its own browser storage. This does not
     help when the GM was offline when the request was made, and the requester must still be online
     to execute. It fixes only "GM reloads".
   - C. **Gateway routes approvals.** The gateway holds pending approvals and presents them to
     any eligible approver who connects, even while the requester is offline. The approval is
     executed when the requester returns. This changes who carries the approval (the link instead
     of the Foundry socket), so approver identity must come from the gateway's pairing, not
     Foundry's `senderId`. It is a larger security review.
   - D. **Requester browser.** Instead of expiring stored pending records on reload, re-ask them.
     Storage is untrusted, but a human still approves the args shown. Lost if the player switches
     machine or clears storage, and a GM still sees nothing while the player is away.
   - **Recommendation: A.** It reuses durable, reviewed machinery (task 30), keeps execution
     and identity where they are, survives logout, machine switch and gateway restart, and needs at
     most one queue state or column. C is the only option that lets a GM approve while the player is
     away, but nothing can run until the player returns anyway, so its cost buys little.
2. **Re-ask or keep the earlier approval?** If an approval was given but the tab closed before it
   ran: re-ask (consistent with 30 and the `load()` rule), or honour it. **Recommendation:
   re-ask.** Honouring it needs the gateway to trust a module-reported approval it cannot verify.
3. **Expiry.** How long a carried-over pending approval lives (today pending records expire
   after the approval wait). **Recommendation:** the offline queue's existing retention.

## Amendment 2 (orchestrator, 2026-10-16): Owns extended; restart survival

The implementer stopped before coding: the 7.2.0 bump breaks hard-coded version assertions outside Owns (the same situation task 122 had).
- Added to Owns, for the version change only:
  - protocol/test/link/link.test.ts:142 and :260, protocol/test/link/vouch.test.ts:8 (7.1.0 → 7.2.0);
  - module/test/link/client.test.ts:259 (the hello `protocolVersion` → 7.2.0);
  - protocol/test/link/result-images.test.ts:9, which becomes a floor check: retitle it "is at least protocol 7.1.0" and assert the version is >= 7.1.0 by semver comparison, since images arrived in 7.1.0.
  - module/test/link/result-images.test.ts:228 needs no change.
- Restart survival (ruling): orphaned approval rows whose last report was `pending` must survive a gateway restart. They have never executed, so marking them `unknown` loses a never-run approval and contradicts decision 3 (queue retention). Add to Owns a one-clause change to `recover()` in gateway/src/offline-queue/repository.ts that excludes rows with `orphaned_at` set and last report `pending` from the pending→unknown sweep. Rows whose last report is `approved` or `executing` are still swept to `unknown`, as before. Add a test: orphan, simulated restart (new repository over the same DB), the owner's hello → requeued and asked again.
- The implementer's other plans are accepted as within Owns: `expireOrphans` called before `cleanup`; capable-connection tracking in a Set inside OfflineQueue keyed by connection id; ApprovalManager setters (`onApprovalState`, `pendingApprovalIds`) instead of editing types.ts.

## Amendment 3 (orchestrator, 2026-10-16): Owns extended for the migration count

Migration 014 raises the migration count from 13 to 14 and breaks hard-coded assertions outside Owns. Added to Owns, for the 13 → 14 change only:
- gateway/test/store/store.test.ts:147 (length and test title) and :171 (`user_version`);
- gateway/test/store/admin-flag.test.ts:69-70;
- gateway/test/store/retire-legacy-pairings.test.ts:47.
Prefer deriving the expected count from the migrations registry where that is a one-line change; otherwise use the literal 14.

## Amendment 4 (2026-10-16, decided by Andrew): hold approved calls until reconnected

Code review found two paths to a double run that the residual didn't cover: (a) the GM approves or denies while the requester's link is down, the `approvalState` frame is dropped, and `reconcile` requeues and re-asks; (b) a second tab takes over the link while the first tab still holds the record. Andrew chose "hold until reconnected":
- The requester's module never executes an approved call while its gateway link isn't connected. It keeps the record pending and approved locally, waits for the link (usually about 2 s), sends `approvalState{approved}`, then runs. The pending-id list sent on hello includes such held records, so `reconcile` doesn't requeue them. A denial during an outage is likewise held and reported on reconnect before anything else.
- When a tab's link is replaced (closed with the replacement reason), that tab withdraws its pending approval records and stops offering them, so the gateway's row is the only copy. It tells the user it moved to another tab.
- Tests:
  - an approval during an outage → no execution until reconnect → `approved` reported → runs once → the row ends `unknown` and is never requeued;
  - a denial during an outage → reported on reconnect → not re-asked;
  - takeover by a second tab → the first tab's records withdrawn → re-asked once in the second tab → approving runs once.
- The residual shrinks back to: an `approved` frame lost as the socket dies after it was sent.

## Review round 1 — findings

Reviewed HEAD: 316a48a

- [P2] repository.ts `report` (approved branch) and the `insertAlias`/`enqueue` cap counts: rows reported `approved` stay `state='pending'` until disconnect or expiry and count against perOwner (20), global (500) and receipt caps. After 20 approvals the 21st mirror throws RATE_LIMITED, is swallowed and is lost. Fix: on an `approved` report, move the row to `unknown` with `resolved_at` set (spec step 5 needs only that it ends `unknown`, never `queued`); `approval_status` still forwards to the module while live. Add a test: 25 mirror+approve cycles leave capacity free. route: implementer
- [P3] service.ts `recordLive`, `live ? c.id : null` branch: unreachable, because `disconnected` already removed the connection from `capableIds`. Use the capability captured before the call (session.ts holds it) so the orphan-at-insert branch works; add a same-tick close test. route: implementer
- [P3] session.ts:537 / service.ts `approvalState`: an `approved` report arriving before its row exists is dropped. Hold early reports per connection for unknown aliases, with a bounded count and time, and apply them in `insertAlias`. route: implementer
- [P3] service.ts `carriesImage`: misses `data:<any>;base64,` prefixes, leading whitespace and numeric byte arrays. Strip any `data:[^,]*;base64,` prefix and whitespace before sniffing, and treat arrays of more than 8 integers whose first bytes match image magic as images. route: implementer
- [P3] gateway/test/store/admin-flag.test.ts:70 and store.test.ts:147: use the literal 14, as Amendment 3 allows, not `>=` floors. route: implementer
- [NOTE] `pendingApprovalIds()` caps at 256: document it in a code comment. Optional.

## Amendment 5 (2026-10-16, decided by Andrew): the gateway confirms ownership on reconnect

Re-review found a double run outside the residual. Tab A's link dies without a REPLACED close (laptop sleep). Tab B takes over, gets X requeued, and the GM approves it, so it runs. Then A reconnects, evicts B, and releases its held answer for X (or re-presents X), so X runs a second time. Andrew chose "the gateway confirms ownership":
- A new gateway-to-module frame in the same 7.2.0 protocol bump, `approvalOwnership` (insertion-only in protocol/src/link/messages.ts). It is sent in reply to the module's post-hello pending list, and lists which of those aliases are still owned by this connection: rows still `pending` and live or orphaned for the same (world, user, agent), which reconcile re-attaches to this connection.
- After hello, the module waits for `approvalOwnership` before releasing any held answer or re-presenting any mirrored record. For each listed alias it keeps the record and releases held answers (report, then run). For each alias not listed it withdraws the record and drops its held answer, with nothing run or reported.
- If no `approvalOwnership` arrives within a bounded time (say 10 s), the module withdraws all its mirrored records. That fails safe: the gateway's row is authoritative and gets re-asked.
- A gateway that reports a protocol below 7.2.0 is never sent the list and never replies. A 7.2.0 module talking to an older gateway keeps the pre-112 behaviour (no mirroring), as now.
- Owns: protocol/src/link/messages.ts (insertion), gateway/src/offline-queue/service.ts and repository.ts (the reply after reconcile), gateway/src/link/server.ts (send helper or case insertion only), and module manager.ts, live.ts and client.ts (receive and gate).
- Tests, each failing on the current code:
  - the stale-tab scenario above runs X exactly once;
  - a normal blip reconnect keeps and releases a held answer;
  - a missing reply withdraws everything after the timeout;
  - ownership is scoped: another user or agent's aliases are never confirmed.

## Review round 2 — findings

Reviewed HEAD: 156852e

- [P2, orchestrator] the stale-tab double run is settled by Amendment 5 above.
- [P2] module/src/approvals/live.ts:80-95: no test drives the Amendment 4/5 wiring through `startApprovals`/`onState`. Add tests in the style of module/test/approvals/approval-across-drop.test.ts:170 with a fake `onState`:
  - connected, disconnected (ERROR), approve: nothing runs;
  - reconnect: the frames go list, then ownership, then `approved`, then the run;
  - disconnected with REPLACED: withdrawal, nothing sent.
  The tests must fail when the gate is replaced by `holdWhile(() => false)` or when the REPLACED branch is removed. route: implementer
- [P3] service.ts:85 and :227-232: don't delete early reports on disconnect. Let them expire by their own 30 s bound, and apply them to a row inserted as an orphan too. route: implementer
- [P3] live.ts:87: the REPLACED warning also fires on pairing revocation and store failures (same 1000/'replaced' close). Reword it neutrally: "Agent Gateway: this tab's link was closed; its pending approvals were moved to the gateway and will be asked again where you are connected." It stays an English literal for now; lang/ is a follow-up. route: implementer

## Amendment 6 (orchestrator ruling, 2026-10-16): don't withdraw records the gateway never mirrored

Amendment 5 as built withdraws every listed record that isn't confirmed. That includes records the gateway never mirrored: redactArgs or image tools, rows skipped at a queue cap, and calls made to an older gateway. Such records used to survive a same-tab blip (task 109) and now don't. No other tab can hold a copy of a record the gateway never stored, so keeping it can't cause a double run.
- `approvalOwnership` carries two lists: `ids` (owned by this connection: keep and release) and `unknown` (listed aliases for which the gateway has no row at all for this (world, user, agent): keep and release, with the pre-112 behaviour). The module withdraws only the listed aliases that appear in neither list, meaning ones the gateway knows but that belong elsewhere or are already resolved or requeued.
- The 10 s timeout still withdraws everything, which fails safe.
- Tests: an image_upload record held through a blip is kept and runs once after the reply; the stale-tab scenario still runs X exactly once; an alias whose row was requeued to another tab is withdrawn.
