# 155 — Spike: what makes the module stop answering link pings?

**Repo:** .
**Depends on:** none
**Status:** Ready. Spike: the deliverable is findings and a recommendation. No product change.
**Owns:**
- spikes/link-drops/** (new: findings.md plus any probe scripts)
- e2e/link-idle/** (the existing local harness; extend it only if a probe needs it)

## Goal
Task 108 showed that the five abnormal (1006) closes of the GM's link in the 0.3.0 playtest were the
gateway's own heartbeat terminate after missed pongs, but not why the module stopped answering.
Task 109 raised the tolerance to about 135 s and made any inbound frame count as liveness, which
hides the symptom. Find the module-side cause (or rank the candidates with evidence) and recommend
whether anything more should be done.

## Context
- docs/plan/HISTORY-INDEX.md rows for 108 and 109, then those two `HISTORY.md` entries by heading.
- docs/plan/done/108-link-drop-diagnosis.md and docs/plan/done/109-link-keepalive-fix.md: the
  evidence (Caddy durations in whole 15 s ticks), what was ruled out (Caddy stream settings, a
  shorter ping interval, a module keepalive) and the candidate causes (tab freeze or discard, a
  blocked main thread, a stall over 30 s).
- gateway/src/link/server.ts:45-50 and :354-390: `MAX_MISSED_PONGS` and the heartbeat loop;
  :449-454 the liveness handling after 109.
- module/src/link/client.ts:891-892: the module answers an app-level `ping` frame in its ws
  `message` handler, not on a timer. :705-720 the `onclose` handling.
- e2e/link-idle/idle.mjs and Caddyfile.tmpl: 108's harness. Its stand-in ws server differs from the
  real gateway (see the comment in the file), so a "no repro" there is weak evidence.
- Chrome behaviour to test or cite: background-tab timer throttling, intensive throttling after
  5 minutes hidden, tab freezing (Page Lifecycle `freeze`/`resume`), Memory Saver discards, and
  whether a frozen page's WebSocket `message` events queue or are lost. Foundry's own long tasks
  (scene loads, compendium indexing) are a candidate for a blocked main thread.
- Live logs: the playtest gateway log and Caddy access log are on the deployed host (see task 110's
  "Live evidence" section for how the Mac session sampled them read-only). Ask the orchestrator if
  you need a new sample; never copy tokens, cookies or invite codes into findings.

## Acceptance
- [ ] spikes/link-drops/findings.md exists and, for each candidate cause (tab hidden and throttled,
      tab frozen, tab discarded, main thread blocked by a long task, network or proxy, anything new
      found), states: how it was tested or what evidence was used, the result, and whether it can
      explain a pong gap of 30-45 s (the pre-109 window) and of over 135 s (the post-109 window).
- [ ] At least one probe is reproducible: a script or numbered steps in spikes/link-drops/ that a
      reader can run against a local Foundry and gateway, with what it measured (for example the
      gap between gateway `ping` and module `pong` while the tab is hidden, frozen via
      `chrome://discards`, or blocked by a long task).
- [ ] The findings end with one recommendation, chosen from: no further action (109 suffices);
      a named, scoped module or gateway change (files and lines, why it helps, its risk); or a
      diagnostic to add first. Any change is described, not made.
- [ ] No secrets, tokens, invite codes or personal paths in the findings.
- [ ] `git diff --stat` touches only spikes/link-drops/** and, if used, e2e/link-idle/**.
- [ ] `npm run verify` passes.

## Out of scope
- Any edit under `module/src/**`, `gateway/src/**`, `protocol/**` or `lang/**`, even a trivial one or
  a diagnostic log line. `module/src/link/client.ts` and `gateway/src/link/server.ts` belong to
  task 157 in this wave; propose the change in the findings instead.
- Changing heartbeat constants (109's decision).
- docs/** (scribe records the findings).
