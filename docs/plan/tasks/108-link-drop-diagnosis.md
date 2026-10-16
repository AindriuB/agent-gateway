# 108 — Diagnose the Gamemaster link's abnormal closes (spike)

**Repo:** .
**Depends on:** none
**Status:** Ready. Spike: its deliverable is the findings below plus one diagnostic log change. No fix.
**Owns:**
- gateway/src/link/server.ts (diagnostic only: the close reason recorded when the gateway terminates a socket)
- gateway/test/link/close-cause.test.ts (new)
- e2e/link-idle/** (new, optional: a local proxy reproduction harness, excluded from the default e2e run)

## Goal
In the 0.3.0 playtest, server mode behind Caddy, the Gamemaster's link closed abnormally (code 1006)
after 435 s, 1020 s, 1020 s, 720 s and 105 s, and reconnected in about 2 s each time. Find out which
side ends the socket and why before anyone changes timeouts. Today the gateway log cannot tell its
own heartbeat termination from a proxy or browser close, because both show as 1006.

## Context
- gateway/src/link/server.ts:45-46 — `HEARTBEAT_INTERVAL_MS = 15_000`, `MAX_MISSED_PONGS = 2`.
- gateway/src/link/server.ts:376-383 — the gateway pings and calls `ws.terminate()` after two missed
  pongs. Terminate records no reason.
- gateway/src/link/server.ts:385-401 and gateway/src/app.ts:792 — the close event and its log line
  `link disconnected: <who> after Ns (code N<reason>)`.
- gateway/src/link/server.ts:403-406 — `ws.on('error')` also terminates, again with no reason.
- module/src/link/client.ts:854-855 — the module only answers pings. It sends none of its own and
  has no dead-link detection of its own. Its close handler is at `:674`.
- gateway/docker/compose.yaml:26-36 — Caddy (`caddy:2`) runs with `network_mode: "service:gateway"`
  (Caddy joins the gateway's namespace, not the other way round).
- gateway/docker/Caddyfile:6-9 and gateway/docker/byo-caddy.Caddyfile — `reverse_proxy` with no
  `stream_timeout` or `stream_close_delay`. Caddy closes proxied WebSockets on a config reload
  unless `stream_close_delay` is set.
- The live deployment uses Andrew's own Caddy (the bring-your-own route), not this repo's compose
  Caddy. Its config and logs are on his server, so ask the orchestrator to get them from Andrew; do
  not guess them.

## Acceptance
- [ ] When the gateway ends a socket because of missed pongs, the close event's `reason` is
      `heartbeat-timeout`; when it ends one from `ws.on('error')`, the reason is `socket-error`. The
      app.ts log line therefore shows them with no app.ts change (test with fake timers asserts the
      reason for each, and that a peer-initiated close keeps the peer's code and reason).
- [ ] The existing gateway/test/link/heartbeat.test.ts and connection-log.test.ts pass unmodified.
- [ ] The spike's findings, delivered in the PR description and the implementer's report (not a
      repo file; the scribe records them), contain all of these:
  1. For each close in the playtest log (or a fresh capture with the new reason), which side closed:
     gateway heartbeat, gateway socket error, proxy, or browser. Give the evidence line for each.
  2. The Caddy version and every timeout in effect on the live proxy's `/link` route, read from
     Andrew's config (or "default" with the Caddy default stated), and whether Caddy reloaded at
     or near any close time.
  3. Whether the GM's Foundry tab was hidden, backgrounded or frozen at the close times, from the
     module's link-drop console log (task 87) if Andrew can supply it.
  4. A local reproduction attempt. Gateway behind `caddy:2` with this repo's Caddyfile, one module
     client idle for 25 minutes, and once more with a Caddy reload mid-run. Record which, if either,
     reproduces 1006.
  5. Whether a pending approval survives a link drop today. Trace (code citations) what happens to a
     call that is waiting for approval when the link closes and the module reconnects: the gateway
     side (gateway/src/link/registry.ts:82-88 fails pending calls with WORLD_OFFLINE), the module
     side (module/src/approvals/manager.ts), and whether `approval_status` afterwards finds the record.
  6. A recommended fix for task 109, chosen from: shorter gateway ping interval; a module-side
     keepalive or dead-link timer; `stream_close_delay` / `stream_timeout` in the shipped
     Caddyfiles; a browser-side cause the gateway cannot fix (document only). Each comes with the
     evidence that rules the others in or out.
- [ ] `npm run verify` passes.

## Out of scope
- Changing heartbeat timing, the module client, or the Caddyfiles (task 109).
- Editing Andrew's live Caddy config or restarting anything on his server.
- Any approval persistence change (task 112).

## Findings (implementer report, 2026-10-16, branch task/108-link-drop-diagnosis)

1. All five drops were the gateway's heartbeat terminate. Every Caddy /link duration is a whole number of 15 s ticks plus ~0.1 s handshake (435.1 = 29, 1020.1/1020.2 = 68, 720.1 = 48, 105.1 = 7), and terminate fires only on a tick (server.ts:376-383), after 30-45 s without a pong. A proxy, network or socket-error close would not land on the grid. With this branch the app.ts log line shows `heartbeat-timeout` or `socket-error`.
2. Live Caddy v2.11.4 has no /link timeouts and did not reload. Locally a Caddy reload closes with a clean 1001, not 1006. Proxy ruled out.
3. Tab visibility is unknown (no task 87 console capture). The module answers pings in the ws `message` handler (client.ts:854-855), not on a timer, so timer throttling alone should not delay pongs. The likely causes are tab freeze or discard, a blocked main thread, or a >30 s machine or network stall. The operator should capture `document.visibilityState` plus a timestamp at each drop.
4. Local repro (e2e/link-idle/idle.mjs, caddy:2, stand-in ws server copying the heartbeat): idle for 25 min gave 0 closes; a reload at 10 min gave 1001 on both sides. No 1006 reproduced.
5. Approval across a drop: the module record survives and is re-presented on reconnect (live.ts:78-83). The gateway fails the in-flight call with WORLD_OFFLINE (registry.ts:82-88), so the agent never gets the outcome. If the drop comes before APPROVAL_WAIT_MS, the agent has no approval id, and its retry creates a duplicate pending record.
6. Recommendation for 109 (outside the four listed options): document the browser-side cause, and raise the pong tolerance (MAX_MISSED_PONGS or a deadline of about 2 min); keep fast reconnect; deliver the pending approval id and outcome after reconnect, and dedupe on retry. Ruled out: Caddy stream settings, which address no cause; a shorter ping interval, which would make it worse; a module keepalive, which detects but doesn't prevent. Optional hardening: treat any inbound frame as liveness, since `missed` resets only on an app-level pong (server.ts:449-451).
