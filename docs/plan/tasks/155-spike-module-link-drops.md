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

## Review round 1 — findings

1. **[P2] The recommended diagnostic can't detect a freeze.** spikes/link-drops/findings.md:69-79. A forced 10 s freeze shows 0.5 ms drift between `Date.now()` and `performance.now()`, so the clock-drift rule would class a freeze as a long task. After a freeze the server sees a 1001 close and no queued ping is ever delivered, so a check inside the ping `message` handler never runs for the frozen case. Rework the recommendation to use signals that survive a freeze: document `freeze`/`resume` events, and logging in `onclose` the time since the last inbound frame and the last ping. Keep the clock-drift check only for the long-task and sleep case. State which signal separates which candidate.
2. **[P3] The probe summary undercounts silences.** spikes/link-drops/probe.mjs:115-127: `maxGapMs` covers only answered pings, so `frozen` and `discarded` print 0 and `min Infinity max -Infinity`. Report the age of the oldest unanswered ping (or the silence length) as well.
3. **[P3] The hidden row reports the wrong quantity.** findings.md:37 says the "worst gap equalled the 5 s ping interval", but the probe measures time from ping to pong (about 1 ms). Report what the probe actually measured.
4. **[P3] A claim isn't backed by the probe.** findings.md:62-64 says the module saw 1001/1006 on resume and reconnected in about 2 s. The probe has no reconnect logic and logs nothing on the page side. Say that only the stand-in server saw the 1001, and cite `backoffDelay` (module/src/link/client.ts:159-165, first retry at 1 s) for the reconnect timing.
5. **[P3] The probe leaks Chrome profiles.** probe.mjs:50 creates a profile directory with `mkdtempSync` and never removes it. Remove it on exit.
6. **[NOTE, do it] Discard and freeze are mixed up.** findings.md:41: the discard row cites Chrome's freeze exclusion for pages with open connections. Correct it, or mark the statement as unverified and about freezing.

## Review round 2 — findings

1. **[P2] The freeze-drift figure can't be reproduced.** findings.md:75-78 cites "0.5 ms drift over a 10 s freeze", but that came from the round-1 reviewer's measurement, which isn't committed. Add a drift readout to the probe's `frozen` scenario: record the page's `Date.now()` and `performance.now()` just before the freeze and just after resume, and print the wall time and the drift. Run it, then cite that run's own figures in the findings. If the readout can't be added, attribute the figure to the round-1 review and say probe.mjs doesn't measure it.
2. **[STYLE] Two lines are too long, and one line is orphaned.** findings.md:22 and :53 run past 100 columns; wrap them, along with the orphaned line after "split;" in the "Which signal separates which candidate" paragraph.
3. **[NOTE, do it] One discard statement isn't marked as unverified.** findings.md:43: mark "A discarded page loses its socket and reconnects on reload" as unverified, like the sentence before it.

## Review round 3 — findings

1. **[STYLE] Two paragraphs are filled unevenly.** Refill the "A frozen tab explains both windows" bullet (findings.md:54-57) and the "The probe's `frozen` scenario" paragraph (:79-83) to 100 columns, with no short orphan lines. Do not change the wording.
