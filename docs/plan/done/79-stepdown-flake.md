# 79 — Stabilise the relay step-down test under load

**Repo:** .
**Depends on:** none
**Status:** Requested by Andrew on 2026-10-14. Written against main 72561f9. Diagnose first. If the cause is in relay source, stop and report before changing anything.
**Owns:**
- gateway/test/relay/stepdown.test.ts

## Goal
The test "A (oldest), B and C with different settings settle on C without a step-down cycle" in gateway/test/relay/stepdown.test.ts fails under full-suite load but passes when run alone. Find out whether the test is wrong (a timing assumption or a fixed count) or the relay really fails to converge under load. If the test is wrong, make it deterministic.

## Context
- **Seen failures:**
  - `worldInfoEventually` (gateway/test/relay/stepdown.test.ts:36-46, called from :209) gave up after about 49.9 s. Its last error was `LINK_UNAVAILABLE` "another gateway is primary with different settings … this standby instance cannot serve world_info". So the instance the test picked as the new `primary` at :205 was a standby by then.
  - `expected 7 to be 5` and `expected 6 to be 5` at :204, `holds(a) + holds(b) === ha + hb + 1`. After C is killed, the survivors logged one or two extra "holds link port" lines in the 4 s window (:203). The port changed hands more than once.
- **Both failures happen after C is killed (:200-209)**, which suggests one question: after C dies, does A (older, different settings) take the port and then step down for B (newer)? Check that against the rule in the comment at :190-193 and in the relay code.
  - If yes, that is a designed handover. The test's "exactly one new primary" (+1) and its choice of `primary` from a snapshot are then wrong.
  - If the port moves more times than the design allows, or never settles, that is a relay bug.
- **Use the systematic-debugging approach:**
  1. Reproduce under load.
  2. Capture the stderr of A, B and C (`c.stderr()`) for a failing run.
  3. Count the handover lines from that capture.
  4. State a hypothesis and test it before changing anything.
- **Relay source (read only):** gateway/src/relay/claim.ts (heir claim file), standby.ts, secondary.ts, endpoint.ts, upstream.ts, constants.ts (timings). Test harness (read only): gateway/test/relay/harness.ts (`until`, `startCli`, `pairedPrimary`).
- **How the tests run:** gateway/vitest.config.ts. `npm test` runs the protocol, module and gateway projects (package.json `test`). To run this file alone: `npx vitest run --project gateway gateway/test/relay/stepdown.test.ts`.

## Acceptance
- [ ] The PR description states the root cause with evidence: the stderr lines and the counts from a failing run. It says whether the cause is in the test or in relay source.
- [ ] If the cause is in relay source, the implementer stops before editing anything outside the Owns list and reports the finding with a proposed fix. That becomes a spec decision.
- [ ] If the cause is in the test, the fix waits on observable state, not on fixed sleeps and exact counts. The test still checks:
  - no step-down cycle: the `steps`/`asked` bounds at :186-198 are unchanged or tightened, never loosened;
  - C holds the port and serves `world_info` before it is killed;
  - after C is killed, exactly one survivor ends up as primary and serves `world_info`, and both survivors stay alive.
- [ ] The file passes 20 consecutive runs while `npm test` runs alongside it in a loop. An equivalent CPU-load harness is also acceptable, for example `stress-ng --cpu <cores>` or `yes > /dev/null` processes, one per core, started and then stopped by PID. The PR gives the command used and the pass count.
- [ ] CI on ubuntu-latest is green on the PR.
- [ ] `npm run verify` passes.

## Out of scope
- Any change to gateway/src/relay/** or gateway/test/relay/harness.ts. Report instead.
- Other relay tests in gateway/test/relay/, even if they look similarly fragile. List them in the PR.
- The fixed 1500 ms wait in gateway/test/mcp/server.test.ts:70 (an open PLAN item).
- The CI workflow and package.json.

## Outcome

Done on branch `claude/task-79`, 2026-10-14, rebased onto `origin/main` c34a1f2 with the implementer commit unchanged in content. `/review` was CLEAN, with the root cause confirmed against the source. `/verify`: tester PASS (build, lint, 4396 fast, 2227 slow, 0 failed; the step-down file alone 5/5), reviewer APPROVE.

Root cause, in the test; the relay is correct:
- The test's `holds()` counted the bare `holds link port`, which also appears in the standby warning (`gateway/src/app.ts:171`, `:201`, `:414`). The primary banner is at `:459`.
- After C was killed, A (the oldest) sometimes took the port, then by design stepped down for B (newer, different settings). That counted +3 rather than +1.
- `primary` was chosen from a snapshot.
- Reproduced under load: about 1 run in 4 failed, with 16 `yes` processes on 8 cores.

Fix: match only the primary banner; wait for B to serve; poll A until it reports `LINK_UNAVAILABLE` / "different settings"; remove the fixed 4 s sleep. The `steps` and `asked` bounds are unchanged. Load run: 20/20 passes. In a mutation where the relay fails to hand over, the test fails.

Residuals:
- The worst-case sum of the waits (about 295 s) exceeds the 180 s test timeout, so a slow convergence shows as a timeout, not the named message.
- `toBe(hb + 1)` at `stepdown.test.ts:212` is exact. That is safe only because B has no newer live peer; a comment saying so would help.
- The other bare `holds link port` waits are a PLAN follow-up (from task 81 review): `stepdown.test.ts:89`, `:107`, `:121`, `:149`; `link-reconnect.test.ts:76`; `takeover.test.ts:138`, `:140`. Most are vacuous rather than wrong, because later gates catch them.
