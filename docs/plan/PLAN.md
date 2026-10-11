# Plan

What is open, in priority order. Only `scribe` edits this file.

Each item: one line of what, one line of why it matters, and its blocker if it
has one. When an item is in flight, mark it with its task ids. Delete items you
no longer want rather than letting them rot — a plan nobody trusts is worse
than no plan.

---

## Now

### Tool-pack foundation and v13/v14 acceptance complete
Tasks 20b–20f, the P1 toolset follow-up and bridge fix are merged through PRs #42–51. Full v14 acceptance passed all 35 tests, including the disabled Hello Pack case; enabled and disabled v14 lifecycle checks also passed separately.

Foundry v13.351 / PF2e 7.12.2 passed all 34 core/read/multi-user tests with zero failures and zero leaks (20 player results × 21 hidden strings). The optional Hello Pack test skipped; no v13 pack lifecycle claim is made. Those merged foundation checks remain separate from the new write acceptance below.

### Policy, approval and player-write wave complete
Tasks 15, 15a, 17, 21, 21a and 21b are complete and merged through PRs #54–58 and #60; that wave was verified at `9b3b05b`. Merged PR #59 records that wave's final evidence and completed-contract archive. Completed contracts are in `docs/plan/done/`; `docs/plan/tasks/` contains queued, blocked or verified work awaiting merge. Earlier tasks 01–12 were already retired and remain recorded in HISTORY/its index. The completion inventory also includes merged tasks 13, 14, 16, 19, 20 and 20b–20f.

The combined task 21 head `d0a11fb` passed `npm run verify` (2,562 fast / 2,227 slow tests). Exact production bundle SHA-256 `9151dcaece963660a3c93039613b4580ded558f9c9f0d5546f4e9f59cecb33c4` passed native GM and Player1 acceptance on Foundry v14.369 and v13.351: real owner approvals, cached-SDK pending results, chat/roll AI badges, five persisted audited calls per role, three safe created targets, append before-snapshots and zero no-chat targets. Exact fixture cleanup and retained audit UUIDs were checked; local visual evidence was independently reviewed. No public screenshot upload is claimed. See the matching history entry for scope and limits.

Task 18 remains architecture-blocked: immediate gateway token invalidation for another owner, including while that owner is offline, lacks trusted cross-owner attestation. Preserve that acceptance requirement; hello role hints cannot authorize it. Design a trusted gateway-controlled observer prerequisite before implementing 18; this introduces a production browser/credential/configuration surface and needs a deliberate future contract. Do not add an 18 → 36 dependency cycle or silently substitute pending revocation.

Task 15a's atomic world-policy snapshot replaced the multi-setting save sequence after cross-GM concurrency review. Candidate `ab6b67f` and its main reconciliation `f66de98` passed 2,607 fast / 2,227 slow tests; independent focused review passed 247 tests. The harness-only envelope preflight fix `c6421ee` passed 2,626 fast / 2,227 slow and 26 independent focused tests. These later offline gates do not establish a new native bundle proof: native acceptance above remains tied to `d0a11fb` / `9151…33c4`. Last complete world writer wins; participating clients must reload, duplicate initialization fails closed, and no immediate revocation or CAS is claimed.

### Token and combat tools complete
Task 22 is merged in PR #61 (`c4ff5f0`, main `ba52acd`) and its contract is archived in `docs/plan/done/`. Both Foundry v14.369 and v13.351 passed the human-approved native six-call acceptance: owned movement/targets/turn, hidden-current privacy and three permission refusals. Each world retained six matched audits and removed ten exact fixture UUIDs with personal views/targets restored and world time unchanged. Production bundle `9ae039…6124b` was observed in both browsers; source verification passed 2,751 fast / 2,227 slow tests plus 113 independent focused checks. The harness/record follow-up is merged in PR #62, separate from the production implementation. Native partial wall/cost movement and actual Undo invocation are not claimed; view-only audit limits and the initial cleanly cancelled v14 harness attempt are recorded in HISTORY. Task 23 validation is recorded below; task 18 stays blocked.

### GM document tools and native Undo verified; PR #63 awaiting merge
Tasks 23 and 23a passed implementation review and native acceptance on Foundry v14.369 and v13.351. PR #63 is not merged; keep both contracts in `tasks/` until Andrew merges the implementation. The next queued implementation is task 24; task 18 remains blocked.

Source `a45541af0736408c15023233fde4843d583567ac` passed `npm run verify` (2,995 fast / 2,227 slow tests) and 88 independent focused Undo checks. Both browsers served exact production SHA-256 `4a35b9e697c17ba92d4f35efb128b0ebf665c144637657c67acec083aef04b32`. Per world, eight actual approved MCP calls created/imported three roots and two children, updated Actor/Page data and deleted the three roots as one group. One human Audit UI Undo restored all five exact UUIDs and saved content. Raw update responses and fresh raw server reads confirmed three completed roots, current GM, completion time and no outstanding reservation. Each world retained eight matching audits, removed five exact fixture UUIDs, preserved the original compendium source, and restored personal views with unchanged world time.

The proof uses the native-executed private harness SHA `8ede52416c640d127472b2e3375846b12c7b65e14013fab42588c1a22f78a235`; a later reusable harness preparation is a separate offline change, not another native run. Images stay local. This proves grouped root deletion with embedded restoration, not direct embedded-only Undo, every class or concurrent-Undo behavior. Historical failed attempts and their cleanup remain in HISTORY.

### Testing topology and prerequisites
- Implementation happens on the homelab; client-side and browser tests run in Andrew's Mac test-bed Claude session (clone at `~/workspace/foundry-modules/agent-gateway`). Use `/usr/bin/curl` there, since Anaconda curl ignores the keychain.
- The test-world users are dev-gm (GM), player1 and Player2. The harness matches user names case-insensitively on the join screen, preferring an exact match; set FOUNDRY_PLAYER2_USER=Player2 to match the world's spelling exactly. The test users have no password; the per-user `FOUNDRY_{GM,PLAYER,PLAYER2}_PASSWORD` variables are optional.
- The harness reads settings from `~/.config/agent-gateway/test.env` (KEY=value lines; the environment wins). FOUNDRY_URL, FOUNDRY_WORLD, FOUNDRY_GM_USER, FOUNDRY_PLAYER_USER, FOUNDRY_PLAYER2_USER and the optional per-user password variables can be set there or in the environment; the legacy FOUNDRY_PASSWORD is ignored with a warning. See docs/testing.md for the full list.
- Pairing is a one-time headed `npm run test:e2e:setup` in which Andrew types each pairing code; the harness never types one. State lives in `~/.config/agent-gateway/e2e/`.
- After setup the Mac runs `npm run test:e2e` unattended, under an exact allow rule from Andrew in its auto mode.
- A newly linked module only appears after `test-world` is relaunched from the setup screen (admin key, Andrew only).
- **Validated:** v13.351 and v14.369 core/read/multi-user suites passed; Hello Pack lifecycle acceptance is proven on v14. See docs/testing.md for fresh-world prerequisites.
- Criterion 11 of task 01 was checked with a console capture that missed about 617 early boot messages; a full Playwright capture from first load is in progress on the Mac and may be added to the PR.

## Next

### Audit undo acceptance follow-up
Task 19's original PR #41 evidence remains offline verification and v14 backend reservation inspection. Task 23a now supplies human Audit UI Undo and local screenshot evidence on v13.351/v14.369 for one grouped three-root deletion with exact embedded restoration, plus fresh persisted completion and reservation-release checks. That repair is verified on PR #63's unmerged source. Direct embedded-only Undo and native concurrent-reservation contention are not established by this proof; do not infer them from task 21's snapshots or the task23a stub regressions.

### Pointer for task 36
36 must use the 10b recommendation (docs/spikes/foundry-socket-identity.md); identity only from server-set args; v13 re-check list in the spike.

### Follow-ups from wave 2
- Handshake mismatch message must name "module" and "gateway", not "local/remote side" (pick up in task 06 or 07). The user needs to know which side to update.
- Link version regex is not end-anchored (`1.0.0garbage` parses as major 1); tighten when 06 or 07 touches it.
- Confirm `result.structured` being optional is what the tool framework wants.
- `hasSceneLevels()` is tree-shaken out of the bundle (unused), so its runtime result is unverified live. Verify once a task uses it, for example by exposing it through the module api or a log line.
- Compat isolation test should also catch `game['release']`, destructuring and `game.version`; `foundryGeneration()` silently returns 13 if `game.release` is missing.
- Task 04 now has live v13.351 evidence through the full core/read/multi-user gate; retain task-specific follow-ups independently.
- Task 01b's task file was never committed (only HISTORY records it). Future mid-wave tasks put their task file in their PR.

### Follow-ups from task 05
- `gateway/test/mcp/server.test.ts:70` waits a fixed 1500 ms; wait for the id:2 response line instead, or it can flake.
- The CLI tests need a prior build; `npm run verify` builds first, but a bare `npm test` on a clean tree will fail them.
- The published npm package `foundry-agent-gateway` depends on the private workspace `@agent-gateway/protocol`. Bundle it at build time (release task 41) or publish it.

### Follow-ups from task 06
- `gateway/package.json` lacks `@agent-gateway/protocol` as a dependency; bundle it for release (task 41).
- Add a rate limit on pairing-code attempts if `allowNonLoopback` is ever used; loopback-only makes guessing impractical today.
- Implementers must run the full `npm run verify` before reporting done. Two attempts in this wave failed on that alone.

### Follow-ups from task 07
- A rejected code is never visible when a token is stored: status goes Connecting to Connected in about 0.3 s. Show a one-off notification that the code was not accepted.
- After a rejected code, retries keep re-sending it before the token fallback. Drop the code once it is rejected.
- Verify Local Network Access behaviour once in Andrew's everyday Chrome profile. The live proof used a fresh profile only.
- Foundry test stubs: `ApplicationV2` is empty, so pairing app rendering is covered only by the live check.
- Rename the test at `module/test/link/client.test.ts:276`; it covers the throw path only, not all reply paths.
- Add a dedicated "replaced" close code in `protocol/`, shared by gateway and module, instead of matching 1000 plus the reason string `replaced`.
- Submitting an empty gateway URL in the pairing app is a silent no-op; show a message.
- The `gatewayUrl` setting has no `onChange`; editing it in Foundry's core settings does nothing until Connect or a reload.
- One unexplained Tab-B load stall was seen once with bfcache enabled; it did not reproduce with diagnostics on. Watch for it.
- The pairing test's fake `querySelector` is permissive; tighten it so a wrong selector fails.
- The reload test should also assert the registered setting type is String and that the token is sent in hello after a reload.
- The `stringStorage` stub change replaced an existing line; keep stubs additive.
- A newer code entered between two stops during a pending welcome write is dropped in favour of the older-issued token. Same gateway, nothing leaks.
- A socket closing during the welcome write retries the used code once before the token fallback (one extra round trip).

### Follow-ups from task 08
- Separators after empty cells in flattened tables (`/ /`, `; ;`).
- A UUID split across cells is stitched with a separator.
- The deep-nesting scaling test misses cheap O(depth)-per-node work.
- A quadratic `@UUID` scan is detected only as a hang, since synchronous code cannot be interrupted by a vitest timeout; it is not a clean failure.
- `_` and `*` are escaped intra-word and inside bare URLs, which hurts readability.
- `#` and `>` after newlines inside `<pre>` are not handled.
- Relative links are resolved against a dummy root, so deep `../` is normalised.
- GFM autolinks of bare URLs are typed as text.
- Other-module data outside `flags` is still not filtered: ActiveEffect `changes[].key`, `_stats.compendiumSource`/`duplicateSource`, and module-written `system` fields, including objects named `system` outside schema system data.
- Duplicate SPACING oracle cases: the second template ignores `b`, and no case has trailing whitespace inside the second element.
- The generated-case skip filter can narrow to text containing `](`, because marked mis-parses `\](` in link text.
- `<pre>` content inside indented code blocks shows escape backslashes literally (`\<`, `\&`, `\*`); readability only.
- Intra-word emphasis fidelity: `x<em>*star </em>y` becomes `x*\*star* y`, where emphasis does not open after a word character (it reads `x**star*`).
- Fidelity: literal `**` or `*` can appear from nested same-delimiter emphasis or punctuation-adjacent emphasis.
- Multi-segment words can split across pages at small limits.
- The scaling oracle samples every 2nd/8th/16th/80th item of some corpora (half of SPLIT_TAGS, PROBES and ANCHORS are uncovered) to fit the time budget.
- Full verify takes about 65 s (slow suite about 51 s); review the budget if it grows.
- The paging oracle tolerates `*` in word comparison.

### Follow-ups from wave 4
- `chat_read` drops roll flavour, even for the GM.
- `chat_read` renders only the first roll of a message.
- Plain tool text shows markdown escapes (`8\.6.0`).
- LIMITED journals are "not found" for players, stricter than Foundry, which shows the title.
- Players cannot get the active Scene without ownership, stricter than Foundry.
- A same-millisecond duplicate can appear after a deleted paging anchor.
- A scene-layout/vision read API remains unimplemented; completed task 22 provides guarded movement, targeting and combat tools, not a scene-layout read API.
- `gateway/src/mcp/server.ts` and `EmptyModuleConnections` are unused; remove them.
- Name-collision denial of service on `--user <name>`: bind by id instead.
- Task 36 must prove the claimed identity at pairing per spike 10b, and must add pairing revocation (11b already ignores revoked pairings).
- v13 core/read/multi-user evidence for 09, 10 and 11 passed; retain the separate task-specific follow-ups above.

### Follow-ups from task 12
- The summary JSON should include the run duration and the e2e-unit count.
- The seed counts do not list Tokens.
- The roles suite takes about 44 s because of per-role gateway restarts.
- Lint e2e with `npx eslint e2e`; `scripts/` holds only .sh files, so `npx eslint e2e scripts` no longer applies.
- v13 core/read/multi-user acceptance passed; optional v13 Hello Pack lifecycle remains unproven.

## Someday
