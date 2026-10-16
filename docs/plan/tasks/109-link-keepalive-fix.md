# 109 — Keep the link alive through short stalls and keep in-flight approvals across a drop

**Repo:** .
**Depends on:** 108 (merged)
**Status:** Ready. The fix was chosen by Andrew from 108's findings (Amendment 1) and narrowed by
Amendment 2.
**Owns:**
- gateway/src/link/server.ts (heartbeat constants at `:45-46`, the heartbeat loop at `:376-383` and
  the pong/liveness handling at `:452-454` only)
- gateway/src/link/registry.ts (the WORLD_OFFLINE message text `markClosed` gives an in-flight call
  at `:89` only; no change to what `markClosed` does)
- module/src/approvals/manager.ts (`request` at `:376-464`: before creating a record, look up an
  open pending record for the same call and attach the new waiter to it; plus a private helper for
  that lookup. Do not change the 53 hash and stored-args lines in `request` (`reviewArgs`/`callHash`
  at `:388-389`, `args: reviewed` at `:428`) or `reviewArgs`/`bindsTo` at `:286-300`)
- module/src/approvals/live.ts (the reconnect hook at `:78-82` only, and only if a test shows it
  needs a change)
- gateway/test/link/heartbeat.test.ts
- gateway/test/link/close-cause.test.ts
- gateway/test/link/approval-across-drop.test.ts (new)
- module/test/approvals/approval-across-drop.test.ts (new)
- lang/en.json — insertions under `AGENT_GATEWAY.Approvals.*` only (a shared insertion-only file)

## Goal
108 showed that every playtest drop was the gateway's own heartbeat terminate after 30-45 s
without a pong, most likely because the GM's browser stalled, and that a drop loses the outcome of
a call waiting for approval, while a retry creates a duplicate pending record. Make the gateway
tolerate a stall of about 2 minutes, and make a call that was pending at the time of a drop
recoverable by the agent, without a duplicate.

## Chosen fix
(Andrew, 2026-10-16, from 108 finding 6.)
1. **Heartbeat tolerance.** The gateway closes a link only after about 2 minutes without a pong,
   via `MAX_MISSED_PONGS` or a deadline. Today it is 30-45 s (server.ts:45-46, :376-383). Fast
   reconnect stays as it is.
2. **Approvals across a drop (narrowed by Amendment 2).** Only what the module can do with existing
   frames on a same-tab reconnect: the record is still in memory, `representAll` re-presents it
   (live.ts:78-82), `approval_status` answers from it, and a retry of the same call (same agent,
   user, session, tool and args hash, the hash being the post-53 `callHash(tool, reviewArgs)`)
   attaches to the existing pending record and returns its id instead of creating a duplicate. No
   new link frame. Gateway-side tracking (a post-hello list of pending ids, an alias row) is
   task 112's.
3. **Documentation (scribe, at record time).** A hidden, frozen or discarded browser tab can still
   drop the link. The implementer puts a short paragraph for the scribe in the PR description.
4. **Optional hardening.** Treat any inbound frame as liveness, not only an app-level `pong`
   (`missed` resets only at server.ts:449-451 today).

## Context
- docs/plan/tasks/108-link-drop-diagnosis.md, "Findings" (1, 3, 5 and 6).
- gateway/src/link/server.ts:45-46, :376-383 — the heartbeat; :452-454 — `missed` reset on `pong`.
- gateway/src/link/registry.ts:83-91 — `markClosed` fails pending calls with WORLD_OFFLINE.
- module/src/approvals/manager.ts:293-300 — `bindsTo`, the existing same-call test (53 changed its
  hash to `callHash(tool, reviewArgs)`); :376-464 — `request`, the record, the waiter and
  `APPROVAL_WAIT_MS` (:441-457); :474 — `applyResolution` runs an approved call only when a waiter
  exists in this page session; :650-688 — `statusFor`; :713-719 — `representAll`.
- module/src/approvals/live.ts:78-82 — `representAll()` on reconnect.
- module/src/link/client.ts:854-855 — the module answers pings in its message handler.
- docs/plan/PLAN.md item 2 (87) — link drops are logged and recover without re-pairing; keep that.

## Acceptance
- [ ] With fake timers, a peer that answers no pings for 100 s keeps its link open, and one that
      answers none for the bound the design states (between 120 s and 150 s) is closed with reason
      `heartbeat-timeout` (heartbeat.test.ts, updated; close-cause.test.ts still passes).
- [ ] A link that is idle apart from the heartbeat stays open for 30 simulated minutes (test).
- [ ] If the optional hardening is done: an inbound non-`pong` frame resets the missed-pong count
      (test). If not done, the PR says so.
- [ ] A module test drops the link while a write is waiting for approval in the requester's tab,
      before `APPROVAL_WAIT_MS` has elapsed (so the agent has no id), and reconnects within 5 s in
      the same tab. The record is re-presented to the eligible approvers. The agent's retry of the
      same call attaches to the existing pending record: the manager holds one pending record for
      that call, not two (asserted), and an approval given after the reconnect runs the call
      exactly once and returns its result to the retried call (or, if the approval comes after
      `APPROVAL_WAIT_MS`, the retried call gets `pending_approval` with the same id).
- [ ] A test drops the link after `APPROVAL_WAIT_MS` (the agent already has the id) and reconnects.
      `approval_status` for that id returns `pending`, then, after approval, `approved` with the
      result. The call runs exactly once.
- [ ] A test drops the link after approval but before the result frame is sent. `approval_status`
      for the id returns the result, and the call does not run twice. A retry of the same call
      after the record has left `pending` does not reuse it (it asks again, as today).
- [ ] A retry with a different args hash, tool, session, agent or user creates a new pending
      record as today (test).
- [ ] The WORLD_OFFLINE error an in-flight call gets on a drop tells the agent it may retry the same
      call to rejoin a pending approval (test asserts the text). `markClosed` otherwise behaves as
      before (close-cause.test.ts and the existing registry tests pass).
- [ ] No new link frame type: `git diff main -- protocol/` is empty. Old-module and new-gateway
      (and the reverse) still interoperate, and the existing gateway/test/link and module/test/link
      suites pass unmodified apart from heartbeat.test.ts. If a new link message type seems needed,
      stop and report; it belongs to task 112.
- [ ] The existing module/test/approvals/* tests pass unmodified.
- [ ] The PR description carries the paragraph for the scribe: a hidden, frozen or discarded tab
      can still drop the link, and what the operator should capture (`document.visibilityState`
      and a timestamp at each drop).
- [ ] `npm run verify` passes.

## Out of scope
- Any Caddyfile change (gateway/docker/Caddyfile, gateway/docker/byo-caddy.Caddyfile): 108 ruled
  the proxy out.
- A module-side keepalive or dead-link timer, and module/src/link/client.ts generally: it detects
  a stall but does not prevent one.
- A shorter ping interval.
- Persisting approvals across a requester logout or reload (task 112).
- Any new link frame, a post-hello list of pending ids, or gateway-side approval tracking or alias
  (task 112). protocol/src/link/messages.ts and protocol/src/link/version.ts are not owned.
- The 53 redaction and hashing (`reviewArgs`, `callHash` inputs, `bindsTo`): reuse, do not change.
- Recovering an outcome the agent never got an id for after a full drop (the approval ran but the
  result frame and the waiter were lost): a retry asks again. Not fixable without 112's frames.
- gateway/src/mcp/session.ts (task 102 and task 112 edit it). If `approval_status` needs a gateway
  change, stop and report.
- Andrew's live Caddy config.
- Link UI and indicator text.
- The docs paragraph itself (the scribe writes it).

## Amendment 1 (2026-10-16, decided by Andrew)
The chosen fix is 108 finding 6: raise the heartbeat tolerance to about 2 minutes without a pong;
after a reconnect, deliver the pending approval's id and outcome to the agent and dedupe a retry of
the same call; the scribe documents that a hidden or frozen tab can still drop the link; optionally
treat any inbound frame as liveness. The Caddyfile and module-keepalive options are removed from
scope, and Owns, Acceptance and Status are rewritten to match (Ready once 108 has merged).
Reason: 108's live evidence shows every drop was the gateway's own heartbeat terminate, and that
the proxy was not involved.

## Amendment 2 (2026-10-16, orchestrator, from the architect pass on 112)
109 adds no new link frame. Its "redeliver the approval id and outcome after reconnect, recognise a
retry" part is limited to what the module can do with existing frames on a same-tab reconnect: the
record is still in memory, `representAll` re-presents it (live.ts:78-82), and a retry of the same
call (same tool and args hash, same owner) attaches to the existing pending record and returns its
id instead of creating a duplicate. The gateway-side tracking (the post-hello list of still-pending
ids, the `approvalState` frame and the alias) is task 112's. 112 depends on 109 and must not change
`markClosed`. The heartbeat tolerance (about 2 minutes) and the docs note are kept. 53 has merged
(PR #171), so Owns was rechecked against current main: the manager.ts lines are re-cited and the
53 hash and stored-args lines are excluded. Status: Ready.
