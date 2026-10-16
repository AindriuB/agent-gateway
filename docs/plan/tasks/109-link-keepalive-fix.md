# 109 — Keep the link alive through short stalls and keep in-flight approvals across a drop

**Repo:** .
**Depends on:** 108
**Status:** Ready once 108 has merged. The fix was chosen by Andrew from 108's findings (Amendment 1).
**Owns:**
- gateway/src/link/server.ts (heartbeat constants, the heartbeat loop and the pong/liveness
  handling only)
- gateway/src/link/registry.ts (`markClosed` and the WORLD_OFFLINE text it gives an in-flight call
  only)
- module/src/approvals/manager.ts (pending-record lookup on a retried call, and reattaching a
  waiter after reconnect)
- module/src/approvals/live.ts (the reconnect hook at `:75-83` only)
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
2. **Approvals across a drop.** After a reconnect, the agent can get the pending approval's id and
   its outcome, and a retry of the same call (same agent, user, session, tool and args hash)
   attaches to the existing pending record instead of creating a duplicate. See 108 Findings §5:
   registry.ts:82-88, manager.ts:447, :501-531, :637-665, live.ts:78-83.
3. **Documentation (scribe, at record time).** A hidden, frozen or discarded browser tab can still
   drop the link. The implementer puts a short paragraph for the scribe in the PR description.
4. **Optional hardening.** Treat any inbound frame as liveness, not only an app-level `pong`
   (`missed` resets only at server.ts:449-451 today).

## Context
- docs/plan/tasks/108-link-drop-diagnosis.md, "Findings" (1, 3, 5 and 6).
- gateway/src/link/server.ts:45-46, :376-383 — the heartbeat; :449-451 — `missed` reset on `pong`.
- gateway/src/link/registry.ts:82-88 — pending calls fail with WORLD_OFFLINE on close.
- module/src/approvals/manager.ts:431-447 — the waiter and `APPROVAL_WAIT_MS`
  (protocol/src/tools/approval-status.ts:9); :501-531 — `applyResolution` runs an approved call
  only when a waiter exists in this page session; :637-665 — `statusFor`.
- module/src/approvals/live.ts:75-83 — `representAll()` on reconnect.
- module/src/link/client.ts:854-855 — the module answers pings in its message handler.
- docs/plan/PLAN.md item 2 (87) — link drops are logged and recover without re-pairing; keep that.

## Acceptance
- [ ] With fake timers, a peer that answers no pings for 100 s keeps its link open, and one that
      answers none for the bound the design states (between 120 s and 150 s) is closed with reason
      `heartbeat-timeout` (heartbeat.test.ts, updated; close-cause.test.ts still passes).
- [ ] A link that is idle apart from the heartbeat stays open for 30 simulated minutes (test).
- [ ] If the optional hardening is done: an inbound non-`pong` frame resets the missed-pong count
      (test). If not done, the PR says so.
- [ ] A test drops the link while a write is waiting for approval in the requester's module, before
      `APPROVAL_WAIT_MS` has elapsed (so the agent has no id), and reconnects within 5 s. The agent's
      retry of the same call returns the existing approval id (no second pending record in the
      manager, asserted), and an approval given after the reconnect runs the call exactly once and
      returns its result to the retried call.
- [ ] A test drops the link after `APPROVAL_WAIT_MS` (the agent already has the id) and reconnects.
      `approval_status` for that id returns `pending`, then, after approval, `approved` with the
      result. The call runs exactly once.
- [ ] A test drops the link after approval but before the result frame is sent, and shows the result
      is still reachable by `approval_status` or by a retry, and the call does not run twice.
- [ ] A retry with a different args hash, tool, session or agent creates a new pending record as
      today (test).
- [ ] The WORLD_OFFLINE error an in-flight call gets on a drop tells the agent it may retry the same
      call to rejoin a pending approval (test asserts the text).
- [ ] Old-module and new-gateway (and the reverse) still interoperate: no new frame type is sent,
      and the existing gateway/test/link and module/test/link suites pass unmodified apart from
      heartbeat.test.ts. If a new link message type is needed, stop and report;
      protocol/src/link/messages.ts is not owned.
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
