# 109 — Keep the link alive behind a proxy and keep in-flight approvals across a drop

**Repo:** .
**Depends on:** 108
**Status:** Waiting on 108's findings. The orchestrator writes 108's recommended fix into "Chosen
fix" below before fan-out. If 108 finds the cause is outside this repo (for example a browser
freezing the tab), this task shrinks to the approval-survival tests and the scribe documents the cause.
**Owns:**
- gateway/src/link/server.ts (heartbeat constants and loop)
- module/src/link/client.ts (keepalive or dead-link timer only, if chosen)
- gateway/docker/Caddyfile
- gateway/docker/byo-caddy.Caddyfile
- gateway/test/link/heartbeat.test.ts
- gateway/test/link/close-cause.test.ts
- module/test/link/keepalive.test.ts (new)
- gateway/test/link/approval-across-drop.test.ts (new)
- module/test/approvals/approval-across-drop.test.ts (new)

## Goal
Apply the fix 108 recommends so a quiet Gamemaster link does not close abnormally every few minutes,
and prove that a link drop and fast reconnect do not lose an approval that was pending at the time.

## Chosen fix
(Filled in from 108's findings before fan-out.)

## Context
- 108's findings (PR description and report).
- gateway/src/link/server.ts:45-46, :376-383 — the heartbeat.
- module/src/link/client.ts:674-700 — the close handler and reconnect; :854-855 — the ping reply.
- gateway/src/link/registry.ts:82-88 — pending calls fail with WORLD_OFFLINE on close.
- module/src/approvals/live.ts:78-83 — `representAll()` on reconnect.
- docs/plan/PLAN.md item 2 (87) — link drops are logged and recover without re-pairing; keep that.

## Acceptance
- [ ] The chosen change is in place, and a fake-timer test shows a link that is idle apart from the
      keepalive stays open for at least 30 simulated minutes, while a peer that stops answering is
      still detected and closed within the bound the chosen design states.
- [ ] If the Caddyfiles change, both carry the same `/link` directives, and
      `scripts/test/*.mjs` (any test that reads them) passes.
- [ ] A test drops the link while a write is waiting for approval in the requester's module and
      reconnects within 5 s. Afterwards `approval_status` for that id returns `pending`, and an
      approval given after the reconnect runs the call exactly once and reports its result.
- [ ] A test drops the link after approval but before the result frame is sent, and shows the result
      is not lost and the call does not run twice.
- [ ] Old-module and new-gateway (and the reverse) still interoperate: a ping or keepalive frame
      either side does not know is not sent to it, or is ignored without closing the link (test).
      If a new link message type is needed, stop and report; protocol/src/link/messages.ts is not owned.
- [ ] `npm run verify` passes.

## Out of scope
- Persisting approvals across a requester logout or reload (task 112).
- Andrew's live Caddy config (the scribe documents the directive; Andrew applies it).
- Link UI and indicator text.
