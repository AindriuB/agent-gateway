# 73 — Connect the ambiguity suite's MCP client only after both pages are linked

**Repo:** .
**Depends on:** 71, 72
**Status:** Open. Filed 2026-10-14 from the 0.1.0 release gate, where e2e/multi/ambiguity.e2e.test.ts failed all 7 tests. Blocks 66. This is a test bug: the suite is stale against task 71. The product is correct.
**Owns:**
- e2e/lib/gateway.ts (the new "start without a client" option and `connectClient()` only; the existing `start()` behaviour is unchanged for every other caller)
- e2e/multi/rig.ts
- e2e/multi/ambiguity.e2e.test.ts
- e2e/lib/gateway.test.ts (insertions only)
- e2e/multi/rig.test.ts (new, if the rig option is testable offline)

## Goal
The ambiguity suite starts an unbound gateway and connects its MCP client before any page joins. The first page to connect then binds the session in follow mode (task 71), so the second page never makes it ambiguous, and every call goes to the GM. Make the harness create the MCP session only after both pairings are connected, so the session's first resolve sees two connected pairings and returns the ambiguity error. Also cover 71's second rule: once one page leaves, the next call binds to the survivor.

## Context
- e2e/multi/rig.ts:26-38: `open()` calls `startGateway()` first, then joins each page in turn and waits for every welcome.
- e2e/lib/gateway.ts:72-96: `GatewayProcess.start()` spawns the process and calls `client.connect(transport)` at :89, so the MCP session exists before any page joins. Note the PID handling at :90-95. `connectClient()` must keep it, so that `stop()` can still reap a child whose connect failed.
- gateway/src/mcp/session.ts:472-480: the first `connected` event calls `binding.resolve(true)`.
- gateway/src/routing/binding.ts:219-221: follow mode binds to the only connected pairing (dev-gm). binding.ts:104-107: `noteConnected` returns early while the bound pair is live, so player1 joining causes no ambiguity.
- docs/plan/done/71-pairing-usability-follow-connected.md:83: ambiguity applies only when the session is unbound (or its pair is offline) and two or more pairings are connected. :184: when one disconnects, the next call binds to the survivor.
- e2e/multi/rig.ts:7: `RECONNECT_MS`, the existing reconnect tolerance.
- e2e/multi/frames.ts: `FrameCounter` and `waitFor`.
- e2e/lib/gateway.test.ts: the existing offline tests (`gatewayArgs`, `parsePairingCode`) to follow.
- The stdio transport spawns the child inside `connect`. If the process has to start before the client connects, the implementer chooses the mechanism, for example spawning the CLI and attaching the client later, or a deferred transport. The only constraint: the link listener is up before the pages join, and no MCP session exists until `connectClient()` runs.

## Acceptance
- [ ] `GatewayProcess` has an option to start the process without connecting the MCP client, plus a separate `connectClient()`. `start()` with no option behaves as today, and the other suites' call sites are unchanged in the diff.
- [ ] `call()` before `connectClient()` throws a clear error instead of hanging. `stop()` reaps the child whether or not the client connected, by its recorded PID only.
- [ ] Rig has an open mode that starts the gateway process, joins every listed page, waits for all of them to be welcomed, and only then connects the MCP client. The existing `open()` is unchanged.
- [ ] ambiguity.e2e.test.ts uses that mode. Its `AMBIGUITY_CALLS` refusals and its frame-counter assertions (closes, opens, and call frames 0 / 0) are kept.
- [ ] A new test in ambiguity.e2e.test.ts, run after the refusal tests: close one page (the player), wait until its link has closed, then call `world_info`. Within `RECONNECT_MS` the call succeeds and is served by the survivor. The survivor's call-frame counter goes up, and the closed page's does not.
- [ ] e2e-unit tests cover the new `GatewayProcess` option wherever it can be tested offline (at least: `call()` before `connectClient()` rejects, and `stop()` without a client is safe). If a rig piece is pure, it gets a test in e2e/multi/rig.test.ts.
- [ ] `npx tsc -p e2e/tsconfig.json --noEmit` passes.
- [ ] The e2e-unit project passes (`npx vitest run --config e2e/vitest.e2e.config.ts --project e2e-unit`). The only allowed failure is the known one in e2e/lib/hygiene.test.ts on scripts/conformance.sh, which has its own follow-up.
- [ ] `npm run verify` passes.
- [ ] The implementer does NOT run live e2e. Andrew runs `npm run test:e2e -- --foundry v14`, and the ambiguity suite is green. The PR description states that the live run is pending Andrew.

## Out of scope
- gateway/src/routing/binding.ts and every other product file. The binding logic is correct according to 71.
- The other suites (isolation, resilience, stale-token, takeover, and the per-system suites) and their use of `open()` and `start()`.
- e2e/vitest.e2e.config.ts. `multi/**/*.test.ts` is already in `e2e-unit`.
- The opt-in env flags. Note for task 66: the 0.1.0 gate run will set `AGENT_GATEWAY_E2E_PF2E=1` (pf2e reads, Andrew 2026-10-14). Task 73 changes nothing for it.
- The scripts/conformance.sh hygiene failure.

## Outcome

- **Cause:** the e2e ambiguity suite was stale against task 71. The stdio session is built at process start and binds in follow mode as soon as the first page connects (gateway/src/app.ts:517-518, gateway/src/mcp/session.ts:491, gateway/src/routing/binding.ts:221). The product is correct.
- **Design change:** the planned deferred-client design was rejected in review for that reason. The final design is a relayed second gateway S (`Rig.openWithRelayedSession`), whose session is created on relay attach with both pages connected.
- **Owns:** `e2e/takeover/**` was added, approved by Andrew 2026-10-14. The takeover live test assumed B prints its HTTP token, but tokens print only once per db, so it now rotates via `--http-rotate-token` first.
- **Live result (Andrew, 2026-10-14 07:55, v14 at foundry.local):** 35 passed, 0 failed, 23 skipped (opt-in suites). Ambiguity was 8/8 with frames 0/0, and takeover passed. The first live run at 03958b4 had ambiguity green but takeover failing on the token.
- **Context:** this unblocks task 66's e2e gate, which failed on 2026-10-14 06:22Z on this suite. The 0.1.0 gate run will set `AGENT_GATEWAY_E2E_PF2E=1` (Andrew).
- **Known:** the pre-existing e2e-unit hygiene failure on scripts/conformance.sh is a separate follow-up chip.
