# 72 — Automate the takeover and HTTP check, and fix the reconnect after an HTTP takeover

**Repo:** .
**Depends on:** 34, 69, 70, 71
**Status:** MVP A. Filed 2026-10-13 from Andrew's manual Claude Desktop + HTTP check. Part 1 (the root cause) comes first. Do not start parts 2-4 until part 1 has an offline reproduction.
**Owns:**
- module/src/link/client.ts (close and reject handling only: the 'replaced' stop, the reject stop, the reconnect schedule)
- module/test/link/** (new files, plus insertions in client.test.ts)
- gateway/src/link/server.ts (close paths and the reject decision only)
- gateway/src/link/registry.ts (the replace and close paths only)
- gateway/test/link/** (new files, plus insertions)
- gateway/src/relay/** (the takeover order and step-down only)
- gateway/test/relay/** (new files, plus insertions in harness.ts)
- gateway/src/app.ts (the pre-role log lines and the order of takeover start only)
- gateway/test/app/** (insertions only)
- e2e/takeover/** (new)
- e2e/vitest.e2e.config.ts (insertions only: `takeover/**/*.e2e.test.ts` in `e2e-live` and `takeover/**/*.test.ts` in `e2e-unit`)
- e2e/lib/gateway.ts (insertions only: extra CLI args such as `--http`, `--http-port` and a differing setting, for a second instance)

No overlap with 64 (scripts/release.mjs, scripts/bump-version.mjs, scripts/test/*, docs/releasing.md, root package.json `scripts`) or 65 (README.md, docs/guides/*, docs/security.md, docs/privacy.md). This task edits no package.json and no docs. 67 and 68 (MVP B) also list `module/src/link/client.ts` and `gateway/src/link/**`, for other messages. 72 is MVP A and lands first, so they rebase on it.

## Goal
Andrew's manual check on 2026-10-13 found a likely bug. After gateway B (`--http`, different settings) took over from the Claude Desktop instance A, B's `/status` showed "Connected (0)" for minutes, so the Foundry module never relinked. Find the cause offline, fix it, and turn the whole manual check into tests. The takeover, reconnect, HTTP, rotate and kill-back test runs in `npm run verify`. A live `takeover` scenario runs in the e2e harness. Also fix two log problems the check exposed: the bounce through an old secondary, and the misleading pre-takeover "[error] … cannot pair" and "HTTP is served only by the primary" lines.

## Context
What the manual check saw:
- (b) A stepped down, then an A-secondary took over, then it stepped down to B (the bounce). B first logged `[error] … another gateway holds link port; this instance cannot pair` and `HTTP is served only by the primary…`, then took over and served HTTP. B's `/status` stayed at "Connected (0)".
- (c) Bearer HTTP worked: initialize returned 200, rotate gave the old token 401 and the new one 200, and `/status` leaked nothing.
- (d) and (e) were not completed. (e) covers 71's world-switch follow and the pairing code shown in `gateway_status`.

Where to look:
- module/src/link/client.ts:71-77 has the backoff (1 s to 60 s, with jitter). :527-537 has no attempt cap.
- module/src/link/client.ts:347-360 stops for good on close 1000/'replaced'. :419-440 stops for good on any `reject` frame, and PAIRING_INVALID also clears the token (:424-430). These are the main suspects.
- gateway/src/link/server.ts:421 sends close(1000,'replaced'). Its caller has not been traced; registry.ts:116 replaces a stale duplicate for the same world/user.
- gateway/src/link/server.ts:362-405 sends reject(PAIRING_INVALID) for an unknown token, a wrong world/user, a NULL origin or an origin mismatch. In Andrew's manual run, A (the Claude Desktop .mcpb) and B (`node gateway/dist/bin/cli.js --http --http-port 7431`) both used the default db, ~/.foundry-agent-gateway/gateway.db. B therefore knew A's pairing token, so a PAIRING_INVALID from a different db does not explain that run. An origin or allow-origin mismatch is still possible: neither B nor A's .mcpb had `--allow-origin`. The offline tests in parts 1 and 2 must give A and B one shared temp state dir, as in real use. A separate-dir case is optional.
- gateway/src/link/server.ts:131: `link.close()` on step-down uses `ws.terminate()` (1006), so the client should retry.
- gateway/src/relay/server.ts:173-181 holds the step-down grace, after which the app exits. :283 decides "newer" and steps down.
- gateway/src/relay/secondary.ts:111-144 is the takeover loop. An A-secondary that sees the primary go away takes over before B does (the bounce).
- gateway/src/app.ts:154-166 logs the "cannot pair" error before the role is known. :311-315 is `startSecondary`, which writes the "HTTP is served only by the primary" status.
- gateway/test/relay/harness.ts: FakeModule (:49), startCli (:146), freePort, tempState, until, pairedPrimary (:178).
- gateway/test/relay/multiprocess.test.ts:89 tests kill-primary takeover. :179 tests a newer instance with different settings replacing a stale primary. Follow this shape.
- A gateway test may import module code (precedent: gateway/test/events/native-proof.mts:18). Drive `LinkClient` through its `LinkClientDeps` and `SocketLike` (client.ts:36-80), using Node's global WebSocket or `ws`.
- Live e2e: docs/testing.md; e2e/lib/config.ts:36-53 (port 7429, the e2e db under ~/.config/agent-gateway/e2e/, refuses 7420); e2e/lib/gateway.ts:11-22 (the spawn); e2e/lib/browser.ts:147 (sets the `gatewayUrl` client setting, module/src/settings/index.ts:12); e2e/multi/resilience.e2e.test.ts and e2e/multi/rig.ts (the shape of a live recovery suite).

## Acceptance
Part 1, the root cause of "Connected (0)":
- [ ] A new offline test (in gateway/test/relay/ or module/test/link/) does the following: it starts primary A with `startCli` and links a real `LinkClient` to it; it then starts B with the same temp state dir as A (one shared db), different settings and `--http --http-port <17xxx>`; it asserts that within 30 s the client is connected to B and that B's `/status` reports exactly one connection.
- [ ] A second offline test kills B with SIGKILL after that handover. It asserts that a remaining instance takes over and that the same `LinkClient` reconnects to it within 30 s.
- [ ] The PR description names the root cause with `path:line`, either a 'replaced' close, a reject, or something else, and describes the fix. If there was no bug and the manual result was an artefact, the description gives the evidence and both tests still land.
- [ ] Each test fails when its fix is reverted. The PR description records the failing output of a run without the fix.

Part 2, the offline end-to-end takeover in `npm run verify`:
- [ ] One test file under gateway/test/relay/ covers all of the following in order:
  - A is primary with a `LinkClient` linked.
  - B (`--http`) takes over, and the real `LinkClient` reconnects to B.
  - An MCP SDK client over Streamable HTTP with the bearer token calls `world_info`, and the module side answers it. A FakeModule-style responder may supply the tool answer. The reconnect assertion must use the real `LinkClient`.
  - `--http-rotate-token` makes the old token get 401 and the new one get 200.
  - B is killed. A survivor takes over, the `LinkClient` reconnects, and a stdio MCP session on the survivor gets a `world_info` result.
- [ ] Every process in parts 1 and 2 uses `tempState` dirs and ports from `freePort` in the 17xxx range. `rg -n '7420|7421|\.foundry-agent-gateway' <new test files>` returns nothing. All spawned PIDs are killed in `afterEach` or `afterAll`.

Part 3, the logs:
- [ ] The bounce is either fixed or accepted, with evidence. If fixed: an offline test shows that when a newer instance B makes primary A step down, no A-secondary becomes primary before B. The test checks each process's stderr for a takeover line. If accepted: the PR description explains why, cites `path:line`, and shows that the client still ends up on B within the part 1 bound. Prefer the fix if it stays inside gateway/src/relay/**.
- [ ] An instance that goes on to become primary never logs `cannot pair` or `HTTP is served only by the primary`. A test asserts this on B's stderr in the part 2 run. An instance that stays secondary still logs both lines, possibly reworded, once its role is final. An existing or new test asserts this.
- [ ] `[error]` is not used for the expected "another gateway is primary" case before the role is settled.

Part 4, the live e2e `takeover` scenario (Andrew runs it with `npm run test:e2e`):
- [ ] `e2e/takeover/takeover.e2e.test.ts` runs in the `e2e-live` project. It uses the e2e gateway (link port 7429, the e2e db) and starts a second e2e gateway with a different setting and `--http --http-port <17xxx>`. It asserts:
  - The real module in the Playwright dev-gm page reconnects to B. Read it from B's `/status` or a successful tool call.
  - `world_info` over HTTP with the bearer token succeeds.
  - Rotate gives 401 for the old token and 200 for the new one.
  - After B stops, a remaining instance takes over and the module reconnects.
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
  3. Stop the HTTP instance B. The stdio instance takes over, the GM tab relinks within 60 s, and Claude Desktop's next call succeeds.
- Edits to docs/testing.md, docs/compatibility.md or any other doc. These are scribe-only, done at `/record`: add the `takeover` scenario and the checklist above.
- New link protocol messages, pairing confirmation (68) and grants (67).
- Changing the backoff numbers or adding an attempt cap to the client.
- HTTP transport, token storage or rotation behaviour (34). Only the tests here exercise them.
- Release scripts (64) and user docs (65).
