# Plan

What is open, in priority order. Only `scribe` edits this file.

Each item: one line of what, one line of why it matters, and its blocker if it
has one. When an item is in flight, mark it with its task ids. Delete items you
no longer want rather than letting them rot — a plan nobody trusts is worse
than no plan.

---
Inventory: 35 done in `docs/plan/done/`, 31 active in `docs/plan/tasks/` (2026-10-13).

Direction (Andrew, 2026-10-13): the dnd5e work stops after 32, which proved the
adapter abstraction; 58 is parked. The next goal is MVP A (a local install),
then MVP B (VPS/hosted).

---

## Now

### MVP A: someone else can install it locally
Goal: module zip, `npx foundry-agent-gateway`, unsigned Claude Desktop `.mcpb`, stdio, GM tab open.

- **A1: 60, 61, 63** (parallel; Owns are disjoint). 60 module zip and `relationships.systems`; 61 is done (archived in `docs/plan/done/`): the gateway builds as one esbuild bundle at `dist/bin/cli.js` with the private protocol inlined, packs to 4 files, and installs from a packed tarball (not published); 63 stdio conformance, cross-vendor schema checks and the compatibility matrix.
- **A2: 62** (after 61). Build the `.mcpb` bundle from the 61 output; unsigned, not uploaded.
- **A3: 64, 65** (after A1 and A2). 64 local release script (version bump, gates, three artefacts, stops before anything irreversible); 65 local quick start, security model and privacy statement.
- **A4: 66** (after 64 and 65). Cut 0.1.0 through a PR and the release script. It stops for Andrew at every irreversible step: GitHub draft release, publishing it, `npm publish`, any Foundry package listing. The open `relationships.systems` question from 60 must be answered first.

## Next

### MVP B: VPS / hosted (starts after 0.1.0)
- **34** Local Streamable HTTP transport with bearer auth, size limits and a status page. Runs with 37.
- **37** Headless runner (`playwright-core`, logs in as an agent user, follows world lifecycle). Owns are disjoint from 34.
- **38** Headless agent configuration and enforcement (after 37, 34).
- **35** OAuth 2.1 authorization server for remote clients (after 34).
- **67** OAuth consent page and self-service grant revocation (after 35); without it 35 auto-denies every authorization.
- **68** Server-mode pairing confirmation (after 38, 67); the impersonation defence 42 needs.
- **40** Full MCP conformance across stdio, local HTTP and OAuth (after 63, 34, 35, 67).
- **42** Server-mode Docker image (after 38, 35, 64, 68).
- **43** Full user documentation, headless and server-mode guides (last; after 65, 35, 38, 42, 67, 68).

### Deferred beyond B
- **36** remainder: needs 18, 67, 68 and 35b. The consent page moved to 67 and pairing confirmation to 68. It must use the 10b recommendation (`docs/spikes/foundry-socket-identity.md`), with identity only from server-set args.
- **35b** Metadata-only hash-chained gateway audit trail.
- **39** Quench in-world integration tests. Not a prerequisite for A or B.
- **41** Superseded by 64 for MVP A; remote gates return with 39.
- **18** Architecture-blocked. Immediate gateway token invalidation for another owner, including while that owner is offline, lacks trusted cross-owner attestation. Preserve that acceptance requirement; hello role hints cannot authorize it. Design a trusted gateway-controlled observer prerequisite before implementing 18; this introduces a production browser/credential/configuration surface and needs a deliberate future contract. Do not add an 18 to 36 dependency cycle or silently substitute pending revocation.
- **44** Native write audit correlation (architect design gate first). Owns the shipped pf2e limits accepted by Andrew: pf2e's condition API, `SpellcastingEntryPF2e#consume` and strike ammunition or thrown-weapon spending write without document options, so their targets go stale and Undo refuses them; newly applied conditions are not recorded; NPC and hazard strike messages are unaudited; the conditions output has no in-band `message`. dnd5e's `Activity#use` and `toggleStatusEffect` writes are also uncorrelated. Native acceptance ran on v14.369 / pf2e 8.6.0 only.
- **47, 48** Encounter batch tools; **50-56** GM builder (UVTT import, wall planning, presets, image upload and portraits). Planned, do not start.
- **58** dnd5e headless advancements. Parked (spike first: `AdvancementManager.forNewItem`, `forLevelChange`, `Advancement#apply`).

## Done so far
Every item below has its evidence in `HISTORY.md`; find it through `docs/plan/HISTORY-INDEX.md` (grep the heading). Contracts are archived in `docs/plan/done/`.

- Tasks 01-12b: scaffold, link protocol, tool framework, module and gateway skeletons, link server and pairing, read tools, session binding, e2e harness.
- Tasks 13-21b: policy engine, rate limits, policy settings, atomic world-policy snapshot (15a), approval queue and dialog, audit log with Undo, role tool sets, tool-pack API and example pack (20b-20f), player writes.
- Tasks 22-26 (23a): token and combat tools, GM document tools with native Undo, GM scene/token/combat tools, table/playlist/notify, source-bound code tools. Native v13.351 and v14.369 acceptance recorded.
- Tasks 27-30 (28a): visible-client event tap, gateway event buffer, offline event reading and retention, offline write queue.
- Tasks 31-33: adapter interface, pf2e adapter, dnd5e adapter (native v14 7/7 each; v13 not run for adapters).
- Tasks 45, 46, 49, 57: compendium embed in an actor, character-build interface, pf2e ChoiceSet answers, link port bind error.
- Verified bundle for the player-write wave: `d0a11fb`, SHA-256 `9151dcaece963660a3c93039613b4580ded558f9c9f0d5546f4e9f59cecb33c4`, native on v14.369 and v13.351 (see the 2026-10-11 policy entry).

## Carried notes

### Testing topology and prerequisites
- Agent sessions run on the Mac (clone `~/workspace/foundry-modules/agent-gateway`): implementation, `npm run verify` and e2e all happen there. Use `/usr/bin/curl` there, since Anaconda curl ignores the keychain. The homelab is only the deploy target for module updates: `ssh andrew@homelab.local`, then under `bash -lc` (node/npm live in `~/.local`) in the Foundry dev checkout `/srv/dev/projects/foundry-modules/agent-gateway` (linked as `/dev-modules/agent-gateway`), `git fetch` and fast-forward (or check out the branch under test), then `npm run build` for all workspaces (`npm run build -w module` alone fails because the protocol package must build first). Clients reload to load the new `dist/module/main.js`. Checked 2026-10-12: homelab fast-forwarded to `3868bfe` and built; served bundle SHA-256 `cde74e8bd0252019a53cdfad410fe08ebc3ce041b67460e55430379bbe48e945`.
- The test-world users are dev-gm (GM), player1 and Player2. The harness matches user names case-insensitively on the join screen, preferring an exact match; set FOUNDRY_PLAYER2_USER=Player2 to match the world's spelling exactly. The test users have no password; the per-user `FOUNDRY_{GM,PLAYER,PLAYER2}_PASSWORD` variables are optional.
- The harness reads settings from `~/.config/agent-gateway/test.env` (KEY=value lines; the environment wins). FOUNDRY_URL, FOUNDRY_WORLD, FOUNDRY_GM_USER, FOUNDRY_PLAYER_USER, FOUNDRY_PLAYER2_USER and the optional per-user password variables can be set there or in the environment; the legacy FOUNDRY_PASSWORD is ignored with a warning. See docs/testing.md for the full list.
- Pairing is a one-time headed `npm run test:e2e:setup` in which Andrew types each pairing code; the harness never types one. State lives in `~/.config/agent-gateway/e2e/`.
- After setup the Mac runs `npm run test:e2e` unattended, under an exact allow rule from Andrew in its auto mode.
- A newly linked module only appears after `test-world` is relaunched from the setup screen (admin key, Andrew only).
- **Validated:** v13.351 and v14.369 core/read/multi-user suites passed; Hello Pack lifecycle acceptance is proven on v14. See docs/testing.md for fresh-world prerequisites.
- Criterion 11 of task 01 was checked with a console capture that missed about 617 early boot messages; a full Playwright capture from first load is in progress on the Mac and may be added to the PR.

### Audit Undo validation scope
Task 19's original PR #41 evidence remains offline verification and v14 backend reservation inspection. Task 23a now supplies human Audit UI Undo and local screenshot evidence on v13.351/v14.369 for one grouped three-root deletion with exact embedded restoration, plus fresh persisted completion and reservation-release checks. The repair is now merged through PR #63; this supplies task 19's requested successful native Undo UI/screenshot evidence. Direct embedded-only Undo and native concurrent-reservation contention are evidence limits, not invented unfinished task19 requirements. Do not infer those cases from task 21's snapshots or the task23a stub regressions.

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

