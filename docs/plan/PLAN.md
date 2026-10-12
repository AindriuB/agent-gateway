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
Tasks 15, 15a, 17, 21, 21a and 21b are complete and merged through PRs #54–58 and #60; that wave was verified at `9b3b05b`. Merged PR #59 records that wave's final evidence and completed-contract archive. Completed contracts are in `docs/plan/done/`; `docs/plan/tasks/` contains queued, blocked or verified work awaiting merge; merged completed contracts are archived. Earlier tasks 01–12 were already retired and remain recorded in HISTORY/its index. The completion inventory also includes merged tasks 13, 14, 16, 19, 20 and 20b–20f.

The combined task 21 head `d0a11fb` passed `npm run verify` (2,562 fast / 2,227 slow tests). Exact production bundle SHA-256 `9151dcaece963660a3c93039613b4580ded558f9c9f0d5546f4e9f59cecb33c4` passed native GM and Player1 acceptance on Foundry v14.369 and v13.351: real owner approvals, cached-SDK pending results, chat/roll AI badges, five persisted audited calls per role, three safe created targets, append before-snapshots and zero no-chat targets. Exact fixture cleanup and retained audit UUIDs were checked; local visual evidence was independently reviewed. No public screenshot upload is claimed. See the matching history entry for scope and limits.

Task 18 remains architecture-blocked: immediate gateway token invalidation for another owner, including while that owner is offline, lacks trusted cross-owner attestation. Preserve that acceptance requirement; hello role hints cannot authorize it. Design a trusted gateway-controlled observer prerequisite before implementing 18; this introduces a production browser/credential/configuration surface and needs a deliberate future contract. Do not add an 18 → 36 dependency cycle or silently substitute pending revocation.

Task 15a's atomic world-policy snapshot replaced the multi-setting save sequence after cross-GM concurrency review. Candidate `ab6b67f` and its main reconciliation `f66de98` passed 2,607 fast / 2,227 slow tests; independent focused review passed 247 tests. The harness-only envelope preflight fix `c6421ee` passed 2,626 fast / 2,227 slow and 26 independent focused tests. These later offline gates do not establish a new native bundle proof: native acceptance above remains tied to `d0a11fb` / `9151…33c4`. Last complete world writer wins; participating clients must reload, duplicate initialization fails closed, and no immediate revocation or CAS is claimed.

### Token and combat tools complete
Task 22 is merged in PR #61 (`c4ff5f0`, main `ba52acd`) and its contract is archived in `docs/plan/done/`. Both Foundry v14.369 and v13.351 passed the human-approved native six-call acceptance: owned movement/targets/turn, hidden-current privacy and three permission refusals. Each world retained six matched audits and removed ten exact fixture UUIDs with personal views/targets restored and world time unchanged. Production bundle `9ae039…6124b` was observed in both browsers; source verification passed 2,751 fast / 2,227 slow tests plus 113 independent focused checks. The harness/record follow-up is merged in PR #62, separate from the production implementation. Native partial wall/cost movement and actual Undo invocation are not claimed; view-only audit limits and the initial cleanly cancelled v14 harness attempt are recorded in HISTORY. Task 23 validation is recorded below; task 18 stays blocked.

### GM document tools and native Undo complete
Tasks 23 and 23a are complete and merged in PR #63 (head `0cf35c3`, main `83d216d`). Both contracts are archived in `docs/plan/done/`. Tasks 24–27 are also merged and archived below, bringing the archive to 23 contracts. Task 27 validation and task 28 source progress are recorded below; task 18 remains architecture-blocked.

Source `a45541af0736408c15023233fde4843d583567ac` passed `npm run verify` (2,995 fast / 2,227 slow tests) and 88 independent focused Undo checks. Both browsers served exact production SHA-256 `4a35b9e697c17ba92d4f35efb128b0ebf665c144637657c67acec083aef04b32`. Per world, eight actual approved MCP calls created/imported three roots and two children, updated Actor/Page data and deleted the three roots as one group. One human Audit UI Undo restored all five exact UUIDs and saved content. Raw update responses and fresh raw server reads confirmed three completed roots, current GM, completion time and no outstanding reservation. Each world retained eight matching audits, removed five exact fixture UUIDs, preserved the original compendium source, and restored personal views with unchanged world time.

The merged reusable harness and documentation head `0cf35c3` passed the combined required build/lint/full gate (3,042 fast / 2,227 slow tests), 47 independent focused checks, standalone TypeScript and ESLint. This tooling gate is separate from the native proof.

The proof uses the native-executed private harness SHA `8ede52416c640d127472b2e3375846b12c7b65e14013fab42588c1a22f78a235`; a later reusable harness preparation is a separate offline change, not another native run. Images stay local. This proves grouped root deletion with embedded restoration, not direct embedded-only Undo, every class or concurrent-Undo behavior. Historical failed attempts and their cleanup remain in HISTORY.

### GM scene, token and combat tools complete
Task 24 is complete and merged in PR #65 (head `377ae79609a056d47ce094b996b10da3bb323a27`, main `a1504985a6563ae89fa0618de84541284bfc06c9`); its contract is archived in `docs/plan/done/24-gm-scene-token-combat.md`. Source `79f6d713180d021d06cda192584f045edbbfeded` passed build/lint/full verification (3,143 fast / 2,227 slow tests) and 51 focused Token/Scene checks, including the fix for native Tokens without document timestamps. Both browsers observed production SHA-256 `5e23eca373bd9728e837bc7fe9cac135b147ec210635c44ddcec93023683dee0`.

Human-approved native acceptance passed on Foundry v14.369 / PF2e 8.6.0 and v13.351 / PF2e 7.12.2. Each world ran 16 requests with 15 distinct persisted audits and one deliberate human denial with no audit. V14 outcomes were 13 successful actions and two expected handler refusals; v13 had 12 successful actions and three expected refusals because Scene Levels are unsupported. Exact cleanup removed nine fixture UUIDs on v14 and seven on v13, retained all 15 audits per world and restored baseline roots, ordinary sources, active scenes and personal scene/level/targets/combat view. World time stayed at zero throughout the tested same-round progression.

PF2e initiative automation is explicitly unsupported; its refusal is expected. These runs do not establish native Undo, arbitrary clock-changing progression, every action or concurrent-GM behavior. The v14 run required a separately reviewed zero-MCP cleanup after a harness audit-matching ambiguity; the first v13 attempt used the wrong local link port and was cleaned before the successful run. HISTORY retains those distinctions. The v14 native-executed harness SHA-256 was `9d80382faada6fbfa063714233f1675ee445483b6fb5fb4aed1aaf3831300894`. The successful v13 native-executed harness SHA-256 was `598038a43af03baf601833bcba181a21afba97ca644f3a01cd11fc102671bcb6`; later publication/generalization is separate offline tooling until independently executed. Task 25 validation is recorded below; task 18 remains blocked and the archive contains 23 contracts.

Reusable harness/documentation head `b669465671ed67baaadc507c63b85cf7f8bbd7c7` passed the combined required build/lint/full gate (3,158 fast / 2,227 slow tests), with 15 focused harness checks, standalone TypeScript, ESLint and actual-transpiled browser serialization checks. Production bundle remained unchanged. This is offline tooling verification, separate from the native-executed harnesses and the 3,143-test source gate.

### GM table, playlist and notification tools complete
Task 25 is complete and merged in PR #67 (head `aec6db346df1da208af9ff04405eef931c0ac9b3`, main `6ec99ff3d8d526e232b7b48e6cefb78e76f597ee`); its contract is archived in `docs/plan/done/25-gm-table-playlist-notify.md`. Native-tested production source remains `4d8b9d1f4520ff3d0a39fbd7f3cc9b045cd0b6b5`. Build/lint/full source verification passed 3,211 fast / 2,227 slow tests, with 90 independent focused checks and an actual Chromium inert-text probe proving no resource requests or script/event/custom-element execution. Both native runs observed production SHA-256 `ad5438ea93336082f34d9b0e4b962eef6c97eb94370aa7db437947993eb21ae6`.

The combined reusable-harness/documentation head `4129902262904f6f9705435f5d1d8ffc116cac7d` passed build/lint/full verification on its first run (3,222 fast / 2,227 slow tests), with 11 focused harness checks, standalone TypeScript, ESLint and actual-transpiled browser serialization. Production remains the native-tested `4d8b9d1` / `ad5438ea…21ae6`; this combined offline tooling gate is separate from the 3,211-fast source gate and is not another native execution.

Foundry v14.369 and v13.351 each passed seven human once-approved MCP calls: a two-result nonreplacement no-chat draw, a replacement blind AI chat after an approved fixture-only reset, muted playlist play/next, stop, stopped-only volume change, and a Player1-targeted escaped AI notification. Each world retained seven exact successful write audits and removed seven returned fixture UUIDs. Original table/playlist roots and sources, the public compendium reference, chat set, participant scene/level/targets/combat views and world time remained unchanged after cleanup.

GM result content and AI badge were present in native chat DOM; both players had native redacted blind-roll placeholders with hidden content, no result/reference text or exposed dice details. Player1 received the localized AI-prefixed literal notification; GM and Player2 did not. Both final successful runs used immediate completion for every call. The existing delayed approval-status API stores text only: its harness branch has offline regression coverage and an earlier partial native attempt, not proof of preserved delayed structured output. Exact native-executed private harness SHA-256 was `813ed9591f7f4cb20ad1f2a62a3a8a7c300056a0c7c0e4dae0bf4f5670c6f456`; later reusable generalization is separate offline tooling until independently executed. Private images remain local; notification screenshots support the toast, while chat privacy proof uses saved native DOM/model facts.

Two earlier v14 attempts stopped on harness assumptions: structured data after pending completion (six fixtures removed / one audit retained), then treating a legitimate blind-roll placeholder as a leak (seven removed / seven retained). Neither is an overall native pass; both restored baselines. An initial v13 environment mismatch stopped before fixture effects. No native recursive-table draw, every playlist mode, audible playback, automatic Undo or concurrent-GM behavior is claimed. Task 26 validation is recorded below; task 18 remains blocked and the archive contains 23 contracts.

### Source-bound GM code tools complete
Task 26 is complete and merged in PR #69 (head `4f00ed1dff5aefdae7d4a0c2593e7b452ed1a4c2`, main `b8eb171a8afb2e181f37840c7f900ffabd289693`); its contract is archived in `docs/plan/done/26-code-tools.md`. Native-tested source remains `7e626ebe04e5547e1ae5a4491d001e400d61fa8c`. Build/lint/full source verification passed on the first run (3,264 fast / 2,227 slow tests), with 46 independent focused checks. These include exact macro-source approval binding, changed-source/identity/permission refusal, code always asking under tampered allow policy for core and registered pack tools, once-only approval, bounded return/error handling and cached-SDK delayed completion.

Human-approved native acceptance passed on Foundry v14.369 and v13.351 with exact production SHA-256 `deadc3daef7d9c4a265f474b2155ca8a4558de51315e9ca5803c0f30ec261aa7`. Each world created one fresh harmless script Macro, then made two real MCP calls: `macro_run` with a fixed JSON argument binding and an ad-hoc read-only `script_run`. Both full sources were captured in native approval DOM and readable local screenshots before human Approve once; no session approval control was present. All four calls naturally crossed the pending boundary and completed with exact expected JSON text through the existing text-only approval-status API. This does not establish preserved structured pending output.

Each world retained two distinct exact correlated successful code audits with zero targets and removed its exact fixture Macro. Baseline root sets, all original Macro sources, world time and personal scene/level/targets/combat view were unchanged. Native-executed private proof SHA-256 was `b4646e96f7944f997075ed75871f2e73c9782a4f5df0a3bd9348dc1e13df6875`; later reusable pin generalization is separate offline tooling until independently executed. Temporary bundle routes/template cache and private screenshots are not a server deployment or public image export. Native chat macros, compendium macros, arbitrary code effects, automatic Undo, sandboxing and hard CPU limits are not established by this two-call proof. Task 27 source progress is recorded below; task 18 remains blocked and the archive contains 23 contracts.

The integrated reusable harness and validation record at `260a1581e594eb0dfe3cdc8b717cf10312ab5bbb` passed the single combined `npm run verify` on its first run (3,268 fast / 2,227 slow tests, build/lint). Its four focused harness checks, standalone types, lint and serialization probe passed. Production remains the same native-tested bundle; generalized proof SHA-256 `71c20cfb07b4024ab26a3999f5fce61f4724c46579e6d72d6d113494a7d205ea` was checked offline and is not a new native execution.

### Visible-client event tap complete
Task 27 is complete and merged in PR #71 (head `e58590e9ea551587b920a1cfa740651887a82875`, main `d0093d981dde04b31310822a355f0df689aaf902`). Source `0a5835b137527398eb5b5bdb7ceead40575a1b70` passed build/lint/full verification (3,302 fast / 2,227 slow), 123 independent focused checks and 130 local checks. Its contract is archived at `docs/plan/done/27-module-event-tap.md`; the archive contains 23 and task 18 stays blocked.

Both Foundry v14.369 / PF2e 8.6.0 and v13.351 / PF2e 7.12.2 observed production SHA-256 `80625451b6db75f19c2b95c0a6c6b158fb16d8e69f80d46d1b35b03c45a041ad`. Three authenticated clients proved observer identity and per-connection sequence, Actor update coalescing, visible Token updates, private-chat/hidden-Token redaction and a public agent-action flag. An abnormal loss of only the owned GM link discarded its pending update and rewelcomed with sequence one. One real human once-approved `chat_post` per world produced one matched retained audit: v14 completed through pending text-only status, v13 immediately with structured output. Cleanup removed eight exact fixture UUIDs on v14 and seven on v13, restored all three personal views and preserved original roots/sources and world time.

Executed proof SHA-256 was `971a5b433e173cc4b454638bbc5d9c9713cbe9413c07ab1d4100ccf8bc7bcdc8`. Native state helpers differed: v14 `35604f8cb5a5d7f225cbb90dcd368eb986701b6a97866aaf5059ffe477805521`, v13 `c9cfcb4faf4feea8de72ba262a0305c5cdb25cd0d1ed42e267ba0d0c223ca93f` after narrowly normalizing proven empty linked Token delta representations. Independent harness checks passed 16 tests with strict TypeScript, ESLint and actual-transpiled serialization. Historical stopped attempts and exact reconciliation cleanup are preserved in HISTORY. Later reusable tooling and its required combined gate are separate from these native runs.

Combined reusable-harness/documentation verification passed at `23115f5d1544b1662c0c60607db1b87c23842710`: build/lint, 3,318 fast / 2,227 slow tests, plus 16 independent focused harness checks, standalone TypeScript, ESLint and actual-transpiled serialization. The first combined run exposed a client/server close-event scheduling race; two rejection tests now await bounded actual registry removal with unchanged assertions, and all 23 targeted gateway tests passed before the final full gate. Production remains the native-tested source/bundle; this is offline tooling verification, not another native run.

The PR #71 Scene-privacy follow-up `17facbaddaef72cb26225988d9bf7ddee6f66485` passed build/lint/full verification on its first run (3,328 fast / 2,227 slow tests) and 21 independently reviewed focused event tests. Scene event admission and delayed flush now reuse the existing tool visibility rule in addition to OBSERVER permission: a non-GM must have the Scene active, in navigation or personally viewed. Regressions suppress inactive/non-navigation/unviewed create/update/delete events, preserve active/navigation/viewed/GM visibility and player navigation names, and drop queued updates when each visibility route is lost. New bundle SHA-256 `cefa4a00d6fa1e136464d9703a696179326a32c7239eaa63b38f9b6b77de3238` has offline verification only. The native runs above remain historical proof of `0a5835b` / `80625451…041ad`; this fix was not rerun against native worlds.

The later PR #71 Token-ancestor privacy fix `930ee51150f6befe6a0cc4f4f76010b92ff52bc4` passed build/lint/full verification on its first run (3,340 fast / 2,227 slow tests) and 33 independently reviewed focused event tests. Synthetic Actor and Item events now require current rendered Token perception throughout their bounded parent ancestry, both at capture and delayed flush; OBSERVER permission cannot bypass a hidden, unrendered, imperceptible, destroyed or off-scene Token ancestor. Twelve new regressions cover those five refusal states at capture/flush plus positive GM/player visibility and refusal when native GM perception is unavailable. Existing Scene visibility and the earlier `17facba` / 3,328-fast gate remain recorded separately. New bundle SHA-256 `3c7dd2e96dd875f6246ab9eea7a3bac7b5ac67b7c9dc7a0c7e0e24f9c1a1d0c9` is offline-verified only; native proof remains historical `0a5835b` / `80625451…041ad`, without a native rerun of either privacy follow-up.

Upgrade both peers to protocol 3.0.0. The gateway validates authenticated observer-matched events and discards them; buffering, polling and gaps remain task 28, offline retention task 29. Combat/all CRUD hooks, unavailable-view v13 Token deletion, native Undo, every approval transition and installed deployment are not established by this bounded proof. Private images remain local. Task 28 source progress follows below.

### Gateway event buffer source verified; native pending
Task 28 source `5059015ce17480f65dbe3629bb8db3a1a60c9782` passed required build/lint/full verification (3,380 fast / 2,227 slow tests); bundle `8cf825b62772e7efd76a1b1d6162d8443b5047b90fa1c3fb8df05f06214b8dbf` is offline-verified only. Focused checks passed 354 before the final narrow regressions, followed by 71 independent, six targeted and 17 corrected-fixture checks. The first full gate's module-announcement fixture mismatch was corrected without weakening assertions before the fresh passing gate.

Protocol4 adds SQLite-backed, pairing-isolated event rows with durable gateway cursors, honest reconnect gaps and bounded online `events_poll`. Fresh policy metadata must explicitly allow read access; ask/deny/disabled agents cannot read, and authority is rechecked when a waiting poll completes. `events_history` stays hidden/refused until task 29; no offline retention or approval bypass is claimed. Upgrade module and gateway to **4.0.0** together. Task27 native evidence remains historical and does not prove this new source. Task28 is published in draft PR #73 and remains active, with fresh native acceptance and merge pending; archive23 and task18's blocker are unchanged. Task29 follows after completion.

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

### Audit Undo validation scope
Task 19's original PR #41 evidence remains offline verification and v14 backend reservation inspection. Task 23a now supplies human Audit UI Undo and local screenshot evidence on v13.351/v14.369 for one grouped three-root deletion with exact embedded restoration, plus fresh persisted completion and reservation-release checks. The repair is now merged through PR #63; this supplies task 19's requested successful native Undo UI/screenshot evidence. Direct embedded-only Undo and native concurrent-reservation contention are evidence limits, not invented unfinished task19 requirements. Do not infer those cases from task 21's snapshots or the task23a stub regressions.

### Pointer for task 36
36 must use the 10b recommendation (docs/spikes/foundry-socket-identity.md); identity only from server-set args; v13 re-check list in the spike.

### Follow-ups from wave 2
- Handshake mismatch message must name "module" and "gateway", not "local/remote side" (pick up in task 06 or 07). The user needs to know which side to update.
- Link version regex is not end-anchored (`1.0.0garbage` parses as major 1); tighten when 06 or 07 touches it.
- Confirm `result.structured` being optional is what the tool framework wants.
- Task 24 now exercises `hasSceneLevels()` through native v14 level selection and the explicit v13 unsupported refusal; this resolves the earlier unused-helper runtime check within that scope.
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
