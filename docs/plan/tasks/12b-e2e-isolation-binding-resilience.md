# 12b — Add e2e multi-user isolation, binding and resilience suites

**Repo:** .
**Depends on:** 12a
**Owns:**
- e2e/multi/**
- docs/testing.md (insert one `## Multi-user and resilience` section only)

## Goal
Prove live that the guarantees from 11 and 11b hold with two Foundry users connected to the same
gateway: a session bound with `--user` only ever reaches its own user, a session with no `--user`
and several paired identities refuses every call, and the link recovers from a tab reload or a
gateway restart without re-pairing. The suites reuse 12a's harness and need no new setup.

## Context
- docs/plan/tasks/12a-e2e-harness-single-user.md: the harness, state directory, preflight and summary file this task plugs into
- e2e/lib/** (from 12a): browser, gateway-spawn, MCP-client, fixture-manifest and summary helpers. Use them, do not edit them; if one is missing, stop and report
- gateway/src/routing/binding.ts:57-86 and gateway/src/mcp/session.ts:95-104: ambiguity is `INVALID_ARGS` naming the available pairs and nothing is dispatched
- gateway/src/mcp/session.ts:39: the WORLD_OFFLINE text
- HISTORY entry "Gateway wiring, session binding and isolation (tasks 11, 11b)": implicit binding by connection timing was wrong and was only caught live; a reload gives WORLD_OFFLINE, then recovery
- HISTORY entry for task 07: reconnect backoff caps at 60 s with jitter, and a stored token reconnects to the URL that issued it
- Design constraint: one gateway process is one MCP session. "Two sessions" means two consecutive gateway processes on the same e2e port and DB, with both browsers kept connected. Observe what reaches each browser with Playwright `page.on('websocket')` frame events, not by changing the module

## Acceptance
- [ ] Every suite runs with dev-gm and player1 browsers open at once (2 browsers, the stated maximum). Suites that use player2 skip with `SKIP: player2 not configured` when `FOUNDRY_PLAYER2_USER` has no active pairing
- [ ] Bound isolation: with both browsers connected, a gateway started with `--user player1` makes `world_info`, `document_search`, `document_get` and `chat_read` calls. Every result is player1's view (`world_info` reports player1, role Player). The GM page's link WebSocket receives 0 call frames and player1's receives one per call. The same run with `--user dev-gm` reports dev-gm, role GM, with the counts reversed
- [ ] Cross-player isolation (when player2 is paired): with player1 and player2 connected and the gateway started with `--user player2`, `chat_read` excludes player1's whisper to the GM and the hidden-string leak check passes. player1's page receives 0 call frames
- [ ] No-`--user` ambiguity: with two active pairings in the DB and both browsers connected, a gateway started with `--world test-world` and no `--user` returns, for each of `world_info`, `document_search`, `document_get`, `compendium_search`, `compendium_get` and `chat_read`, an error result whose text starts `INVALID_ARGS` and names both users. Neither page receives any call frame during this suite
- [ ] Tab reload: while bound to player1, reloading player1's tab makes the next call return `WORLD_OFFLINE`, and a call succeeds within `AGENT_GATEWAY_E2E_RELOAD_S` seconds (default 30). The measured recovery time goes in the summary
- [ ] Gateway restart: the harness stops the gateway by its PID and spawns a new one on the same port and DB. A `world_info` call then succeeds within 60 s with no pairing code entered and no new row in the DB's active pairings (counted before and after). The measured time goes in the summary
- [ ] Each suite adds its results to 12a's summary file through the e2e/lib summary helper, and the printed summary lists the isolation frame counts and recovery times
- [ ] Processes are stopped only by their own recorded PID (`rg` finds no `pkill`, `killall` or name matching under e2e/multi/)
- [ ] The docs/testing.md section states that these suites need two browsers at once, the player2 skip, and the expected recovery times
- [ ] The PR description includes the passing v14 run output for these suites, together with the 12a suites in the same run

## Out of scope
- Any change to e2e/lib/**, e2e/setup/**, e2e/fixtures/**, e2e/read/** or package.json (12a)
- Concurrent MCP sessions in one gateway process (needs local HTTP, 34)
- Changing reconnect backoff, binding or error text in `module/` or `gateway/`. Report a failing guarantee as a finding; do not fix it here
- Pairing-proof identity checks (36)
