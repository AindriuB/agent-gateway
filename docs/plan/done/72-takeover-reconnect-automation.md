# 72 — Keep a stepped-down gateway alive as a secondary, and automate the takeover and HTTP check

**Repo:** .
**Depends on:** 34, 69, 70, 71
**Status:** Done on branch `claude/task-72` (PR pending). MVP A. Filed 2026-10-13 from Andrew's manual Claude Desktop + HTTP check, and reworked after the 21:06 re-run moved the root cause. Andrew approved going ahead, and approved decision (a) the same day. Part 1 comes first.
**Owns:**
- gateway/src/relay/** (step-down, the secondary and standby roles, the takeover order, the relay config check)
- gateway/src/app.ts (the step-down transition, the pre-role log lines, and the takeover start order only)
- gateway/src/bin/** (the step-down and exit wiring only, if needed)
- gateway/test/relay/** (new files, plus edits to harness.ts and to the multiprocess.test.ts case (e) that asserts the old exit)
- gateway/test/app/** and gateway/test/bin/** (insertions, plus edits to tests that assert step-down exits)
- module/test/link/** (new files only: regression tests for the reconnect)
- module/src/link/client.ts (only if a module/test/link test proves a defect; otherwise untouched)
- e2e/takeover/** (new)
- e2e/vitest.e2e.config.ts (insertions only: `takeover/**/*.e2e.test.ts` in `e2e-live` and `takeover/**/*.test.ts` in `e2e-unit`)
- e2e/lib/gateway.ts (insertions only: extra CLI args such as `--http`, `--http-port` and a differing setting, for a second instance)
- **Owns, added and approved by Andrew 2026-10-13:** gateway/test/relay/server.test.ts (the decision (a) rewrite), gateway/test/bin/link-conflict.test.ts (Part 3 line), and the existing-line edit at e2e/lib/gateway.ts:78.

**Overlap:**
- None with 64 (scripts/release.mjs, scripts/bump-version.mjs, scripts/test/*, docs/releasing.md, root package.json `scripts`).
- None with 65 (README.md, docs/guides/*, docs/security.md, docs/privacy.md).
- This task edits no package.json and no docs.
- 67 and 68 (MVP B) list `module/src/link/client.ts` and `gateway/src/link/**`. 72 touches client.ts only if a test proves a defect, and never touches gateway/src/link/**. 72 lands first, so they rebase on it.

## Goal
A gateway that steps down for a newer instance with different settings exits today. Claude Desktop does not respawn MCP servers, so the step-down silently loses Desktop's gateway. When the newer instance (for example a `--http` one from a terminal) stops, nothing holds the link port: Foundry stays disconnected and the Desktop chats stay dead until the user toggles the extension. Make the stepped-down instance stay alive as a secondary that keeps its stdio session and takes over again when the newer primary goes away. Turn Andrew's manual check into an offline test in `npm run verify` and a live e2e scenario, and fix the misleading pre-role log lines.

## Context
The re-run on 2026-10-13 at 21:06 replaces the first run's evidence:
- A, the Claude Desktop .mcpb gateway, was primary with the GM tab linked. B started with `--http --http-port 7431`.
- A logged "relay refused: http port 7421 here vs 7431 there; stepping down for the newer instance", then "stepping down: …". B became primary.
- The real module reconnected to B within 10 s, and `/status` showed "Connected (1) Gamemaster in test-world". The module reconnect works. The first run's "Connected (0)" did not reproduce, and was probably a stale GM tab.
- B was stopped with Ctrl-C. For 90+ s nothing held 7420 and no gateway process was alive. A had exited after the step-down grace. The first run hid this because a second Desktop instance happened to be alive.
- Both runs used the default db, ~/.foundry-agent-gateway/gateway.db, so A and B shared the pairing store.

Code:
- gateway/src/relay/server.ts:173-180: `stepDown` closes the relay listener and calls `onStepDown` after `STEPDOWN_GRACE_MS` (constants.ts:25, 2 s).
- gateway/src/app.ts:236-240 is that `onStepDown`. Unless `deps.onStepDown` is set (app.ts:96-99), it runs `app.stop()` then `process.exit(0)`. This is the bug.
- gateway/src/relay/server.ts:270-284: a config mismatch is refused. A strictly newer caller (by `startedAt`) gets `RELAY_CONFIG_STEPDOWN`, and any other mismatch gets `RELAY_CONFIG_MISMATCH`.
- gateway/src/relay/config.ts:9-14 and :44-48: `sameConfig` compares `httpPort`, `logLevel` and `allowOrigins`. **Consequence:** once B is primary, A has a different config, so B refuses A's relay with `RELAY_CONFIG_MISMATCH`. "A relays to B" cannot work without changing this rule. See decision (a).
- gateway/src/relay/secondary.ts:
  - :49-50: a degraded instance never re-runs startup, so it never takes over. A standby must not behave like this. See decision (b).
  - :56: `proxy.onLost` leads to recover.
  - :105-165: `acquire` tries takeover, tries to relay, and backs off within `RELAY_CONNECT_ATTEMPTS`.
- gateway/src/relay/proxy.ts:28-38 and :109: `StdioRelayProxy` replays `initialize` under `relay-replay-<uuid>` on re-attach, and hides the reply (:170). A stepping-down instance reuses this for its own stdio client.
- gateway/src/app.ts:
  - :132: the `stdioProxy` handle.
  - :201-217: `attachStdio` (the `exitWhenGone` path is at :210).
  - :222-249: `startRelay`.
  - :154-166: logs `[error] … cannot pair` before the role is known.
  - :311-315: `startSecondary` writes "HTTP is served only by the primary…".
- gateway/src/link/server.ts:131: `link.close()` uses `ws.terminate()` (1006), so the module retries. This is why the module reconnected in the re-run.
- module/src/link/client.ts:71-77 and :527-537: 1-60 s backoff with jitter and no attempt cap. :347-360 stops for good on close 1000/'replaced', and :419-440 on a `reject`.
- gateway/test/relay/:
  - harness.ts has FakeModule (:49), startCli (:146), freePort, tempState, until and pairedPrimary (:178).
  - multiprocess.test.ts:89 tests kill-primary takeover. Its case (e) at :179 asserts the stale primary exits; change it to assert the stale primary survives.
- Gateway tests may import module code (precedent: gateway/test/events/native-proof.mts:18). Drive `LinkClient` through `LinkClientDeps` and `SocketLike` (client.ts:36-80).
- Live e2e:
  - docs/testing.md.
  - e2e/lib/config.ts:36-53: port 7429, the e2e db under ~/.config/agent-gateway/e2e/, and it refuses 7420.
  - e2e/lib/gateway.ts:11-22 spawns the gateway, and `GatewayProcess` is at :47.
  - e2e/lib/browser.ts:147 sets `gatewayUrl`.
  - e2e/multi/rig.ts and e2e/multi/resilience.e2e.test.ts show the shape of a live recovery suite.

## Decisions
(a) was approved by Andrew on 2026-10-13. (b) to (g) are defaults: follow them unless the PR shows a reason not to, and give that reason in the PR description.
- (a) **What A relays to after stepping down. Approved by Andrew, 2026-10-13.**
  - Split `RelayConfig` into session-affecting and session-neutral fields. A relayed MCP session runs on the primary's link, store and selector. `httpPort` and `logLevel` do not change what a relayed session can do, so a mismatch only in those is served, and also triggers the step-down for a newer instance as today.
  - An `allowOrigins` mismatch stays unserved. In that case the stepped-down instance becomes a standby (b).
  - Document the rule in config.ts. It replaces 69's "a mismatch is never served" rule. Any other rule needs Andrew's approval first.
- (b) **Standby. Default.** A stepped-down instance that cannot relay keeps its stdio session. It answers `gateway_status` with the reason, and every other tool returns a clear "another gateway is primary with different settings" error. Unlike today's degraded role (secondary.ts:49), it keeps watching the link port and takes over when the primary goes away.
- (c) **Step-down transition. Default.** It happens in-process, with no exit:
  1. Finish the grace period.
  2. Stop HTTP, the link (terminate, so the module retries), the queue, events and the store.
  3. Keep the `StdioRelayProxy` and its client.
  4. Run the secondary `acquire` path (relay or standby). The proxy's initialize replay restores the session upstream.
  5. Calls in flight at the switch get the existing `RELAY_LOST` error (as in multiprocess.test.ts:89). They are not silently dropped.
- (d) **Taking back over. Default.** When the primary goes away, the survivor takes over with its own config. It binds the link port, opens the store and serves the relay. It starts HTTP only if it was itself started with `--http`. Its `startedAt` stays the original process start.
- (e) **No loops. Default.** "Newer" is strict on `startedAt`, so two instances cannot step down for each other. A survivor that takes back over steps down again only for a strictly newer instance that asks. A later newer instance C steps down whoever is primary in the same way, and every stepped-down instance follows (a) and (b) against C.
- (f) **Bounds. Default.**
  - At most one step-down transition runs per instance at a time, and a request that arrives during one is ignored.
  - A standby re-checks the link port with the existing relay backoff (start to cap), with no attempt cap. It holds no store, timer or socket beyond that one check.
  - Stepped-down secondaries count against `MAX_RELAY_SESSIONS` like any other relay.
- (g) **The bounce. Default.** A survivor might take over before the newer instance does. This may be subsumed by (c), because the old primary no longer exits and an A-secondary relaying to it is not orphaned. Record it as resolved or acceptable, with stderr evidence from the part 2 test.

## Acceptance
Part 1, step-down without exit:
- [ ] Default `onStepDown` no longer calls `process.exit` (app.ts:236-240). The stepping-down instance:
  - closes its link listener, HTTP listener and store within `STEPDOWN_GRACE_MS` + 5 s;
  - stays alive with its stdio session open;
  - becomes a relay secondary (decision a) or a standby (decision b).
- [ ] An offline multi-process test, with A and B sharing one temp state dir:
  1. A (stdio, no `--http`) is primary, with its own MCP stdio client.
  2. B (`--http --http-port <17xxx>`) takes over.
  3. A's PID is still alive 10 s later.
  4. A's stdio client gets a `world_info` result through the relay without reconnecting its stdio.
  5. B is killed with SIGKILL. Within 30 s A holds the link port and its stdio client's next `world_info` succeeds without a restart.
  6. A does not serve HTTP after it takes back over.
- [ ] An offline test where A and B differ in `allowOrigins`. A becomes a standby: `gateway_status` names the reason, and another tool returns an error that names it. After B is killed, A takes over within 30 s.
- [ ] A loop test with A (older), B (newer) and C (newest), all with different settings. The final primary is C, there is no step-down cycle (at most one step-down per instance per newer peer, counted from stderr), and A and B are both alive. Killing C leaves exactly one new primary.
- [ ] multiprocess.test.ts case (e) asserts that the stale primary survives instead of exiting.
- [ ] The tests in this part fail without the fix. The PR description records the failing output of a run with the fix reverted.

Part 1b, module reconnect regression (no module fix expected):
- [ ] **Baseline (A to B), run on `main`:** a test drives the real `LinkClient` against `startCli` processes. A is primary and B takes over. Within 30 s the client is connected to B, and B's `/status` (or registry) reports exactly one connection. This test is expected to pass on `main` with module code unchanged. The PR description records that run.
- [ ] **Full sequence, run with Part 1's fix applied and module code unchanged:** A is primary, B takes over, B is killed, and A takes back over. At each handover, the client is connected to the current primary within 30 s, and that primary reports exactly one connection. Do not run this on `main`, where A exits after stepping down (gateway/src/app.ts:236-240) and the sequence fails whatever the client does.
- [ ] `module/src/link/client.ts` changes only if the baseline fails on `main`, or the full sequence fails with Part 1's fix applied. The PR then names the defect with `path:line`, and the fix is limited to client.ts close and reject handling. Otherwise client.ts is unchanged in the diff, and both tests land as regression tests.

Part 2, the offline end-to-end takeover in `npm run verify`:
- [ ] One test file under gateway/test/relay/ covers all of the following, in order and with one shared temp state dir:
  1. A is a stdio instance with a real `LinkClient` linked and its own MCP stdio client.
  2. B (`--http`, different settings) takes over. A stays alive as a secondary, and A's stdio client gets `world_info` via the relay.
  3. The `LinkClient` reconnects to B.
  4. An MCP SDK client over Streamable HTTP with the bearer token gets `world_info`. The module side may answer the tool with a FakeModule-style responder. The reconnect assertions must use the real `LinkClient`.
  5. `--http-rotate-token` makes the old token get 401 and the new one get 200.
  6. B is killed. A takes over, the `LinkClient` reconnects to A, and A's stdio client's `world_info` works with no restart.
- [ ] Every process in parts 1 and 2 uses `tempState` dirs and `freePort` ports in the 17xxx range. `rg -n '7420|7421|\.foundry-agent-gateway' <new and changed test files>` returns nothing. Every spawned PID is killed in `afterEach` or `afterAll`.

Part 3, the logs:
- [ ] An instance that goes on to become primary never logs `cannot pair` or `HTTP is served only by the primary`. A test asserts this on B's stderr in the part 2 run.
- [ ] An instance that settles as a secondary or standby logs one line naming its role and the reason once the role is final (wording may change). An existing or new test asserts this.
- [ ] `[error]` is not used for the expected "another gateway is primary" case.
- [ ] The bounce (decision g) is recorded in the PR description as resolved or acceptable, quoting stderr lines from the part 2 run.

Part 4, the live e2e `takeover` scenario (Andrew runs it with `npm run test:e2e`):
- [ ] `e2e/takeover/takeover.e2e.test.ts` runs in the `e2e-live` project, with the e2e gateway A (link port 7429, the e2e db) as a stdio `GatewayProcess`. In order, it:
  1. starts B against the same e2e db with a different setting and `--http --http-port <17xxx>`;
  2. asserts that the real module in the Playwright dev-gm page reconnects to B (from B's `/status` or a tool call);
  3. asserts that A's process is still alive and A's stdio `world_info` works via the relay;
  4. asserts that `world_info` over HTTP with the bearer token succeeds;
  5. asserts that rotate gives 401 for the old token and 200 for the new one;
  6. stops B and asserts that A takes back over, the module reconnects to A, and A's stdio `world_info` works.
- [ ] The scenario reuses e2e/lib/config.ts's port and db guards and never targets 7420, 7421 or ~/.foundry-agent-gateway. Any pure helpers it adds have `e2e-unit` tests in e2e/takeover/.
- [ ] `npx vitest run --project e2e-unit -c e2e/vitest.e2e.config.ts` passes.

Overall:
- [ ] `npm run verify` passes.
- [ ] The real gateway is untouched: no test or script reads or writes ~/.foundry-agent-gateway, and none binds 7420 or 7421. The PR description shows the `rg` check over the diff.
- [ ] `git diff --stat main` lists only files in Owns.

## Out of scope
- The world-switch follow from task 71 and the pairing code in `gateway_status` / not_connected stay manual, because Andrew relaunches worlds by hand. Manual checklist, for the record step to put in docs/testing.md:
  1. Gateway primary, with the GM tab linked. Switch the world in Foundry. The GM tab relinks and `world_info` names the new world in the same MCP session.
  2. With no tab linked, `gateway_status` and a not_connected tool error both show the current pairing code.
  3. With Claude Desktop's gateway stepped down for a `--http` instance, stop that instance. Desktop's gateway takes back over, the GM tab relinks within 60 s, and the next Desktop call succeeds without toggling the extension.
- Edits to docs/testing.md, docs/compatibility.md or any other doc. These are scribe-only, done at `/record`: add the `takeover` scenario, the checklist above, and the changed step-down behaviour.
- Any change under gateway/src/link/**. If the reconnect turns out to need one, stop and report.
- New link protocol messages, pairing confirmation (68) and grants (67).
- Changing the module backoff numbers or adding an attempt cap to the client.
- HTTP transport, token storage or rotation behaviour (34). Only the tests here exercise them.
- Respawn or keep-alive on the Claude Desktop side.
- Release scripts (64) and user docs (65).

## Outcome (recorded 2026-10-14)

**Decisions.** (a) was approved by Andrew: a relay is refused only on an HTTP port or log level mismatch, and an allowOrigins mismatch makes a standby. (b) to (g) were implemented as written. One deviation: a demoted instance becomes a standby for every refusal, selector mismatch included, while a fresh instance keeps the degraded behaviour.

**Root cause.** gateway/src/app.ts:236-240 on main: step-down called `process.exit`. In `config.ts`, `sameConfig` compared `httpPort` and `logLevel`. A degraded instance never re-ran startup.

**Review rounds.**
- R1: a demoted instance with a selector mismatch went degraded and was stranded; standby polling spammed the primary's log (about 1,800 lines an hour); the holds text was stale.
- R2: the refusal-log key included `startedAt` (fixed with a code+text key in a capped Set); the A/B/C loop test flaked under load.
- R3: the test had been loosened rather than fixed. The race was real: the newest instance could exhaust its attempts and end degraded while an older one stayed primary.
- R4: a handover claim (`<stateDir>/relay-heir-<port>.json`, 0600, atomic, expires after 12 s), and STEPDOWN refusals no longer spend attempts until a 60 s deadline. Strict bounds restored: A at most 2, B at most 1, C 0. Approved apart from test port literals.
- R5: 17555 port literals, the deadline test, and lstat hardening against a planted FIFO.

**Remaining `rg` hits for 7420/7421.** Pre-existing config values or text fixtures in server.test.ts:40, app.test.ts:8 and link-conflict.test.ts:17,25 (none binds). New: e2e/takeover/helpers.test.ts:8, which tests the guard that refuses the real ports.

**Known gaps.** A small lstat-then-read race on the claim file (same user only). The pre-existing e2e-unit hygiene failure in conformance.sh is a separate follow-up, not from 72.

**Gates.** Tester PASS at 421497b (verify x3; stepdown 10/10, claim 5/5, takeover 3/3, multiprocess 3/3; scripts and conformance ok; real gateway untouched). ce21c72 re-run by the implementer (verify x1, claim, stepdown and app tests 3/3). Reviewer approved.

**Manual, pending Andrew.** Run the live e2e `takeover` scenario (`npm run test:e2e`), and the 3-step manual checklist above for the 71 world-switch follow and the Desktop take-back.
