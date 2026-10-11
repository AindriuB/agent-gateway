# History

What was built, newest first. Append-only. Only `scribe` edits this file.

**Read this before redesigning anything.** The `Cost` line on each entry is the
point of the file — it is where the sessions that already tried the obvious
approach tell you what happened.

Do not load this file to find out whether something exists. It grows without
bound. `HISTORY-INDEX.md` carries one row per entry; scan that, then grep this
file for the exact heading it names. Every entry added here gets its index row
in the same commit.

<!--
## YYYY-MM-DD — <what landed>
<Two or three sentences: what it does now that it did not before.>
**Cost:** <what was hard, what was tried and abandoned, what not to retry.>
-->

## 2026-10-11 — Tool-pack PRs merged and installed pack synchronized; live acceptance pending (tasks 20b–20f)

PR #47 merged head `87d050e47340b536131c2161019762bff79c32af` at
2026-10-10 23:21:46 UTC, followed by P1 security PR #49 head
`d7cb64bdb3dc2923ceb8e686040bdb6b7b98542c` at 23:21:47 UTC. Both are
2026-10-11 in Europe/Dublin. Record PR #48 merged head
`4f7ec6f12e50603e9590c3d6379d372baab5c08a` at 2026-10-11 06:30:53 UTC.
Together with already merged PRs #42–46, the task20 implementation, reviewed
security fixes and prior record are now on main (`1283470`). This supersedes
older open-PR and pending-P1 statements in the preceding historical entry.

The remote chat confirmed synchronization of all four Hello Pack files from
`14b6c3bb08fbb2a5d050bf6054290aef2d29a1b4`, byte for byte, at
`/srv/data/foundry/data/Data/modules/agent-gateway-hello-pack`. The prior
`dfd8a04` installation was unmodified before replacement; README and main
script were updated. The prior directory was backed up at
`/tmp/hello-pack-backup-ovppwkva/agent-gateway-hello-pack`. Manifest and script
both returned HTTP 200 with exact expected content. This supersedes the
pending-synchronization statement; it establishes installation, not runtime
activation or a live test pass.

The combined implementation previously passed 2,355 fast and 2,227 slow tests;
the reviewed protocol-2 exact bundle passed 21 v14.369 read/role tests with zero
leaks. A subsequent enabled-mode attempt on actual Foundry v14.369 confirmed
that the genuine runtime still reports Hello Pack installed `false`, active
`false`, version `null`, despite the installed server files. Suite setup failed
while waiting for the core `world_info` call, which returned `INTERNAL` with
`n is not a function`; its one pack test skipped after the failed setup.
Sessions were cleaned up. This was a blocked attempt, not an enabled-mode pass.
The subsequent diagnosis found an eager dispatcher binding in the bridge
initialization cycle, which captured `undefined` in the production bundle.

Bridge fix PR #50 (`43cea16b25837f1b67485d4d0065b1351547c8ca`) is published,
open, mergeable and clean, with independent review PASS. Its production-bundle
regression reproduces the old failure and passes with the fix; full verification
passed 2,356 fast + 2,227 slow tests. A player probe using the exact fixed local
bundle on Foundry v14.369 then returned successful `world_info` for `test-world`
(`isError: false`). Bundle SHA-256:
`27efa51c11498137fd6de60b73bb5e88408db2ebb3a6a6fe240ff9f2c94add2a`.
This confirms recovery for that fixed-bundle probe; PR #50 is not claimed merged
or deployed as the core's server files. The final recording branch includes the
fix as a dependency and introduces no direct runtime edits.

The genuine runtime still reports Hello Pack absent/inactive and lists no
`hello-` tools. Real enabled/disabled acceptance remains pending owner-driven
setup relaunch for discovery, activation/deactivation and the required world
relaunches. Foundry v13 remains pending its instance.
Task files and worktrees remain for that acceptance work. The docs-only final
record on main `1283470` passed the required full verification: 2,355 fast +
2,227 slow tests. After incorporating PR #50, the final record branch passed
2,356 fast + 2,227 slow tests.

## 2026-10-10 — Tool-pack foundation implemented locally; review and live evidence pending (tasks 20b–20f)

The tool-pack foundation is implemented on local branches and integrated in the
20f tree. This entry records implementation and verification, **not completion of every review or live acceptance check**. Andrew subsequently approved the source uploads, live
v14 checks and Hello Pack installation. The task PRs are published for review;
installation is now verified, while live pack acceptance remains open. Preserve the task files and worktrees;
do not archive them while acceptance, publication and review remain open.

| Task | Verified local commit | Independent verification | Review / live evidence |
| --- | --- | --- | --- |
| 20b | `5790043` | PASS: 2,226 fast + 2,227 slow | Code review PASS; runtime schema/name/plain-text rules, bounded argument validator and vendor naming documentation |
| 20c | `ca82e63` | PASS: 2,253 fast + 2,227 slow | Code review PASS; v14 final read suite 21 passed, zero leaks; unified registry with private handlers and synchronous core parity |
| 20d | `669672e` | PASS: 2,295 fast + 2,227 slow | Code review PASS; frozen registration API, lifecycle seal, isolated context and validated pack results |
| 20e | `438e447` | PASS: 2,281 fast + 2,227 slow | Code review PASS; dynamic definitions/provenance and gateway argument checks; exact-bundle v14.369 read/role suite PASS (21 tests, zero leaks) |
| 20f | `dfd8a04` | Integrated independent verify PASS: 2,335 fast + 2,227 slow | Code review PASS; free Hello Pack and reconciled author docs; enabled/disabled live evidence pending |

20f's integrated verification covers the assembled predecessors; its final docs
reconciliation passed formatting, local link, public PackError-code coverage
and diff checks. Final independent example ESLint and e2e TypeScript checks passed at the clean
`dfd8a04` head; the default opt-in pack suite skipped its one test as expected.
No live pack test was run. A default opt-in skip does not prove the pack's
enabled or disabled behavior. The example restricts dice target to 1–2001 and
journal stamping to HTML text pages (`text.format === 1`), requires ownership
of both page and journal, escapes appended text, awaits snapshots and forwards
audit mutation options.

Publication state: contract PR #42 (`08c8325`) and runtime-rules PR #43
(`5790043`) are now merged. Local
20c incorporates its contract corrections and necessary cycle-breaking scope
amendments. After Andrew explicitly approved the upload, runtime-rules PR #43
was updated and its remote head verified as
`57900438e3777d120903fde309cd0c490bc96795`; it was subsequently merged. Andrew then explicitly approved the remaining publication: 20c is PR #44
(`ca82e63`), 20d PR #45 (`669672e`), 20e PR #46 (`438e447`) and 20f PR #47
(verified head `dfd8a04481780afa885d3b9317cb82625d7a4105`). All are attached
and PRs #44–46 subsequently merged: 20c at `2c87d9e`, 20d at
`09b6444` (including the strict-code fix), and 20e at `871bf5` (protocol 2).
PR #47 and record PR #48 remain open. The P1 guard described below was
developed after the PR #46 merged head and is not yet landed through that PR. Every implementation still lands through
its own PR to `main`, reviewed by Andrew; predecessor commits identify the
per-task review boundary.

After Andrew approved live v14 checks, task 20e's exact bundle passed on
Foundry v14.369: three files, 21 tests (GM 6, player 11, roles 4), seven tools
for GM and player; 20 results × 21 hidden strings yielded zero leaks. Bundle
SHA-256: `282e5bff8cc0b4a3adf0b39e0f97cf33f85f64b9e8ceaa1e7459de045da989e5`.
This supersedes the earlier delivery-approval block and older deployed bundle's
`WORLD_OFFLINE`; neither is a remaining blocker or evidence against this bundle.

Before installation, the genuine Foundry v14.369 browser runtime `game.modules` probe confirmed
`agent-gateway-hello-pack`: installed `false`, active `false`, version `null`.
The manifest URL also returned 404. No enabled/disabled pack acceptance run is
claimed; absence alone is not an enabled-to-disabled lifecycle test.

After Andrew approved installation, the Mac delivery initially failed configured
homelab SSH hostname resolution, including an escalated attempt. A remote chat
subsequently installed Hello Pack at
`/srv/data/foundry/data/Data/modules/agent-gateway-hello-pack` from commit
`dfd8a04481780afa885d3b9317cb82625d7a4105`: all four files were byte-exact and
the manifest returned HTTP 200 with the expected content. No core, world or
admin settings were changed. This supersedes the installation/DNS blocker;
it does not establish discovery or activation in Foundry's current runtime.

Conflict reconciliation incorporated updated main `e29a823` and predecessor
merge heads 20c `2c87d9e`, 20d `414b6c2`, 20e `fd41b8e`, 20f `5f63eba`.
Original test evidence above belongs to the original source heads. The final
20f post-merge gate passed at `5f63eba463800919369cee9a066144b099089d1b`:
2,335 fast and 2,227 slow tests; its runtime source is byte-identical to the
previously reviewed `dfd8a04`. No runtime code was changed by
the recording branch's reconciliation. Its final full `npm run verify` passed
with 2,335 fast and 2,227 slow tests after all predecessor gates.

Pending live pack work: Andrew must relaunch through setup so Foundry discovers
the installed module, enable it and run `AGENT_GATEWAY_E2E_HELLO_PACK=1`, then
disable it and relaunch for `AGENT_GATEWAY_E2E_HELLO_PACK=disabled`. No real
enabled/disabled live pack pass is claimed. Foundry v13 evidence remains pending
its instance.
No task files were moved and no worktrees were removed.

Subsequent security review fix (2026-10-10): PR #45 commit `09b6444`
requires an actual string for a pack's returned error code. Malformed array
codes `['FORBIDDEN']` and `['INVALID_ARGS']` now return `INTERNAL` for that call;
following core and pack calls still succeed. The fix passed 44 focused tests,
full verification (2,297 fast + 2,227 slow) and independent review. These are
new post-review counts, not replacements for the earlier source-head evidence.
PR #47 propagated the fix at `7a390f46451de3fd2677552c13dce857015136f7`,
and PR #48 incorporated that predecessor through a clean merge with no direct
runtime edits. The subsequent integrated gates passed at PR #47 and the
record branch: 2,337 fast + 2,227 slow tests each, after the security fix.

Subsequent protocol compatibility review fix (2026-10-10): PR #46 commit
`871bf5` bumps `PROTOCOL_VERSION` to `2.0.0` because full tool-definition objects
are incompatible with protocol 1.x tool-name arrays. A 1.x peer is rejected
before welcome or credential consumption, with an upgrade diagnostic. The
module's existing fatal mismatch path stops automatic reconnect and preserves
its token. Old/new handshake regression tests passed; task20e verification
passed 2,287 fast + 2,227 slow tests and independent review. These are new
post-review results, not replacements for the earlier source-head evidence.
PR #47 propagated the fix at `8679c7280f588b558565f3c3934f24bf0b85ce11`,
and the recording branch incorporated it through a clean merge with no direct
runtime edits. The exact protocol-2 bundle from `871bf5` subsequently passed
on Foundry v14.369: 21 read/role tests (GM 6, player 11, roles 4), seven tools
for each role, and 20 results × 21 hidden strings with zero leaks. Bundle
SHA-256: `0856561e7690dcc9870d3e71f0f407c331165fee50a08e5cacfc3fe9ec9d22de`.
This is the current live compatibility evidence; the earlier protocol-1 result
remains historical. Subsequent integrated verification at PR #47 head
`8679c7280f588b558565f3c3934f24bf0b85ce11` and this recording branch each
passed 2,343 fast + 2,227 slow tests after the exact protocol-2 live gate.

Subsequent P1 untrusted-toolset review fix (2026-10-10): PR #46 commit
`d7cb64b`, published in open follow-up PR #49 to the already merged PR #46,
guards toolset representations with an iterative JSON snapshot,
bounded at depth 32 with explicit work and size caps, before recursive schema
parsing, stringify or cloning. Invalid depth is not eligible for count/byte-only
recovery. A deeply nested pre-authentication frame is safely rejected and a
following healthy connection can call a core tool; direct hostile store input
is refused without throwing or replacing its prior listing. Independent
verification passed 32 focused tests, review PASS and full task20e verification
of 2,295 fast + 2,227 slow tests. Earlier counts above remain historical.

Subsequent Hello Pack concurrency fix (2026-10-10): commit `791994a` queues a
canonical page UUID's fresh read, permission check, snapshot and update within
one browser instance. The instance caps all outstanding stamps at 64, including
identity lookups; overflow returns `FORBIDDEN`. Failures release turns and idle
entries, while different pages can run in parallel. This does not make other
browsers' or manual edits atomic. Sixteen example tests and 60 focused combined
checks passed with independent review PASS. Documentation commit `c97d298`
records these limits. Combined PR #47 predecessor
`14b6c3bb08fbb2a5d050bf6054290aef2d29a1b4` carries both fixes, retaining strict
error-code validation and protocol 2. This record branch merges that source
without direct runtime edits. On 2026-10-11, PR #47 and this recording branch
passed the combined gate with 2,355 fast + 2,227 slow tests. Subsequent
reconciliation merged main `4aa8ce63` through PR #47 head
`87d050e47340b536131c2161019762bff79c32af` without file changes. That final
PR #47 head and the final reconciled record branch each passed 2,355 fast +
2,227 slow tests. PR #47 was confirmed open, mergeable and clean.

The remote Hello Pack installation last confirmed above is from `dfd8a04`,
before the journal queue fix. Synchronization of the four pack files from
`14b6c3bb08fbb2a5d050bf6054290aef2d29a1b4` was dispatched to the remote chat;
confirmation is still pending. No updated installation or live enabled/disabled
pass is claimed.

Author docs distinguish project publishing requirements from primary-source
facts checked 2026-10-10: the Publisher Handbook names a fee without a public
amount or cadence; the AI policy has an older-premium-agreement transition and
does not establish the claimed AI Tools category or blanket other-module
context wording. The project still requires rights and opt-in for such context.
The release builder is not implemented, so example ZIP exclusion remains the
release packaging contract, not verified release-artifact evidence.

## 2026-10-10 — E2E multi-user isolation, binding and resilience suites (task 12b)
The suites in `e2e/multi` prove live what the unit tests only simulated. Bound isolation counts call frames per page through Playwright websocket events (4/0 both ways between dev-gm and player1). Cross-player: Player2 never sees player1's whisper or secret (1/0). A no-`--user` session with several paired users answers INVALID_ARGS on all 6 tools, naming the users, with 0/0 frames, which proves the 11b fix live. A tab reload recovers in 3.3 s and a gateway restart in 1.3 s with the pairing ids unchanged. A stale token, run against a scratch `AGENT_GATEWAY_E2E_STATE_DIR` holding a copied profile, gets PAIRING_INVALID (10.2 s). Approved extensions to 12a files: the vitest include, a `multi` summary record kind (unknown kinds no longer corrupt the leak line), an optional `--user` in GatewayProcess, the state-dir override (empty is an error) and `otherPlayerChatProblems`. Final run (PR #31): 32/32 in 173 s, and the real pairing rows were identical before and after.
**Cost:** The review found the cross-player suite using player1's expectations and a stale-token test that did not prove a rejection. The first live run was 30/32: Playwright does not fire a WebSocket close event on reload, so the reload probe now polls from the reload. Andrew's reviewer then found two more, fixed as plain commits on the same PR: reload probes are judged by when they were sent, and the restart budget now runs from before the stop, with waitFor rejecting late successes. Do not wait for a close event on reload.

## 2026-10-10 — E2E harness and single-user read flows (task 12a)
There is now an e2e harness: playwright-core plus the MCP SDK stdio client, run from its own vitest config and deliberately outside `npm test` and verify. A one-time headed `test:e2e:setup` has a human type each pairing code (the harness never types one) and keeps state under `~/.config/agent-gateway/e2e/`; after that `test:e2e` runs unattended. Seed and clean of the flagged `ag-test-*` fixtures are idempotent, and clean deletes only flagged documents, on every scene. The GM and player read assertions encode the live wave 4 results, and a full raw-result leak check scans every result for the hidden strings. Final live run (PR #30): player 11/11, gm 6/6, roles 2/2, leak check 20 results x 21 strings with 0 hits.
**Cost:** The first live run was 18/19, from a defect in the markdown seed page. Review found D1 to D4: the markdown page HTML, over-broad blind-roll matchers, paging overlap versus repeated table headers, and clean covering only the active scene. Live runs found a shared password being applied to every user (now per-user `FOUNDRY_{GM,PLAYER,PLAYER2}_PASSWORD`, the legacy variable ignored), case-sensitive user names ("Player2"), and a string passed to `$$eval` being evaluated as an expression (now a locator). Andrew's reviewer found four more, fixed as plain commits on the same PR: the blind-roll total, then the formula matchers, now scoped to the seeded message's id; the connect budget's 5 s floor; and the shared deadline not covering browser start and join (now a Deadline over every startup step, with bounded cleanup). Process: plain follow-up commits on the same PR worked well for these small fixes (#30 and #31 each took several rounds), and each round's findings were fixed as a class where possible, for example every blind-roll matcher scoped by message id. The Mac test bed's auto mode needed exact allow rules from Andrew, and pairing codes are typed by Andrew once, in setup.

## 2026-10-10 — Gateway wiring, session binding and isolation (tasks 11, 11b)
The gateway and module are wired end to end: routing and session binding, with the bridge taking identity only from `game.user`. Isolation tests run on a real LinkServer, with mutation checks. Error results are text `CODE: message` with no structuredContent. `--user` binds by the name recorded at pairing (migration 002), so a paired Bob cannot claim "alice", and a disconnect never binds. `list_changed` is coalesced, `safeText` cleans client-supplied terminal output, and the CLI tests use a free port and a temp DB. Task 11b (PR #27) fixed the implicit binding: the live run bound a no-`--user` session to whichever user reconnected first (the GM), so implicit binding now depends only on paired identities in the store, and revoked pairings are excluded. Live evidence (Mac test bed, foundry.local v14.369, dev-gm and player1, MCP SDK stdio client): seeded `ag-test-*` fixtures (15 world documents and 6 chat messages, flagged `flags['agent-gateway'].fixture`, with seed and clean scripts on the Mac). player1 received none of the 9 hidden world strings and dev-gm received all. In chat, player1 saw the public message, the NPC message without its secret, their own whisper and their own character's message with its secret, but not the GM whisper or the blind roll; dev-gm saw all. A LIMITED compendium pack is hidden and its entry is "not found", while observable packs work with paging. Stored tokens reconnect, and a reload gives WORLD_OFFLINE and then recovers. Foundry sends a player's client every document, hidden ones included, so filtering must happen in the module.
**Cost:** The MCP SDK 1.32 validates error structuredContent against the outputSchema and answers -32602, so errors must be text only; do not retry structured errors. Binding by connection timing (11b) was wrong and found only live. The Mac session needed Andrew's per-script approvals and permission rules, because automated logins and writes are gated in its auto mode; it now has a generic read-only probe runner and persistent browser profiles. The Mac lost send_message once, so a fresh session became the test bed. v13 evidence is still pending.

## 2026-10-10 — Compendium and chat read tools (task 10)
`compendium_search`, `compendium_get` and `chat_read` exist, with timestamp paging for chat and field-typed rendering, reusing the pipeline from 09 after a rebase onto it. Chat follows Foundry's rules: a blind roll's author is not leaked, whispers go to the GM-recipient rule (verified against Foundry chat-message.mjs L59-108), the speaker alias mirrors Foundry, and secrets are stripped following `secrets: speakerActor?.isOwner ?? isGM`. Adventure documents are GM-only behind a type allowlist. Final: 1,640 fast tests.
**Cost:** The final review found Adventure contents leaking to players (they are SetField data, not embedded collections, so the embedded-collection rules missed them) and chat secrets shown to the wrong users; both fixed as above. The blind-roll author leak came first. A spike-style source check of Foundry v14 in the homelab container settled these questions quickly and is worth repeating before any new visibility rule.

## 2026-10-10 — World document read tools and the visibility allowlists (task 09)
`world_info`, `document_search` and `document_get` return world documents filtered for the requesting user. Visibility is allowlist-driven: EMBEDDED_RULES, FIELD_RULES and ROOT_RULES in `module/src/tools/visibility.ts`; `stripSecrets` (`.secret:not(.revealed)`) on every HTML-looking string for non-owners; `inlineText` in `module/src/serialise`; schema-driven field rendering; a bounded LRU cache; world types only. The governing rule is that a non-GM gets at most what Foundry's UI shows them, and where that depends on vision, fog or canvas it is excluded. Andrew signed off on these deviations by merging: "not found" instead of FORBIDDEN; the conservative-schema checker now follows `$ref` and `propertyNames`; OpHandler widened to DispatchResult; helpers outside Owns. Final: 1,531 fast and 2,226 slow tests.
**Cost:** Four review rounds. Round 1: embedded pages and tokens, secrets and raw names leaked. Round 2: ActorDelta, secrets outside HTMLField paths, walls, regions and scripts, which led to the allowlist design. Round 3: top-level fields, vision-dependent tokens, playlists and scene names, which produced the vision rule. Round 4 approved after the scene root rule and scene folders were fixed. Do not retry denylisting fields; start from an allowlist.

## 2026-10-10 — Spike 10b: Foundry socket identity (task 10b)
Foundry module sockets attest the sender. The server appends the session-bound user id as the handler's second argument (`sockets.mjs` @783 `handleCustomSocket`), so a receiving client can trust that id and nothing in the payload. Verified live on v14.369 with dev-gm and player1 from the Mac test bed: forged payload fields, extra args, edited handshake auth and a raw engine.io packet all failed to change it. The document-hook `userId` (4th argument) and `_stats.lastModifiedBy` are server-set; `options.userId` is a forgeable pass-through, and `user.active` is forgeable via `userActivity`. Recommendation for task 36: (a) socket sender attestation observed by a trusted connection, using `User#query` where available, and (c) a recipient-targeted one-time code for explicit human confirmation; not (b), the self-User flag write. Full write-up in `docs/spikes/foundry-socket-identity.md`. v13 is not yet checked.
**Cost:** The Mac session lost its `send_message` tool mid-run, so its results were read from its transcript and a fresh Mac session now serves as the test bed. A source-reading agent and the live run were done in parallel and agreed on every point. Identity must come only from server-set arguments; do not rely on `options.userId`, payload fields or `user.active`.

## 2026-10-09 — Module LinkClient and pairing app (task 07)
The module now has a `LinkClient` that opens the gateway WebSocket and sends hello with either a pairing code or a stored token, receives a client-scope token, and reconnects with cap-then-jitter backoff (1 to 60 s). It handles `PAIRING_INVALID`, notifies on `PROTOCOL_MAJOR_MISMATCH`, and `onCall` answers `TOOL_NOT_FOUND` by default. An ApplicationV2 pairing app opens from a settings menu. Evidence: 83 repo and 35 module tests stable three times, reviewer APPROVE, and a Mac live run (headed Chrome 155, `https://foundry.local` to `ws://localhost:7420`) covering pairing, reload reconnect, backoff 1/1.6/4/7.4/13.5/27 s, a single retry chain and no duplicate window. This was the first real proof that an https Foundry page can open the localhost WebSocket with no mixed-content, CSP or Local Network Access errors and no prompt, in a fresh profile; Andrew's everyday profile is untested.
**Cost:** Sixteen attempts. (1) Unit tests passed but the live check failed: `registerMenu` received a plain shim class, v14 threw at init and no pairing button existed. The test stub had no `registerMenu`, so tests could not see it. The reviewer also found that a wrong code wiped a working token and that jitter vanished at the cap. (2) Fixed all of that: the stub's `registerMenu` now enforces Foundry's subclass rule, registrars are resilient and registered one per line, and the live run passed 8 of 8. The reviewer then found the registrar test sat outside Owns (the lead added `module/test/settings/settings.test.ts`) and that the client stayed disconnected after a rejected code. (3) Added the token fallback after a rejected code, tested a single retry chain, and reuse an open pairing app. Two retry chains seen live came from a second client in a spoiled run; a one-tab re-run confirmed one chain. Do not trust stubs that are looser than Foundry's own registration rules. (4) Andrew's review of PR #12 found [P2]: an async reply could be sent through the current socket after a reconnect or re-pair, disclosing a previous gateway's result to a new endpoint. The client now captures the originating socket and sends result, error, `TOOL_NOT_FOUND` and throw replies through a guarded `reply()` that drops them unless that socket is still current and OPEN. Four new tests cover this, and all four fail against the old `client.ts` (mutation check). The reviewer traced every send path and checked the gateway registry and server for the same pattern; both are clean. PR #12 was closed because it conflicted with main after PR #11 merged and follow-up commits review poorly; a fresh PR replaces it. (5) Andrew's review of PR #13 found [P2]: two paired tabs as the same user evicted each other about every second. The gateway closes the replaced socket with 1000/`replaced`, but the client reconnected regardless and failed pending calls with `WORLD_OFFLINE`. A replacement close now ends retries and sets a REPLACED state with a localized "connected from another tab or window" message; a manual Connect or a reload reclaims, and other closes keep the backoff. (6) The reviewer found the close-code pin test circular, since it compared the client's constant to itself. It now reads `gateway/src/link/server.ts` and asserts the real `ws.close` line; proven by temporarily changing the gateway to 4000 (test failed, then reverted). (7) The Mac live two-tab run showed the message said "Press Connect" but Connect with an empty code was a no-op. An empty code with a stored token now reclaims via `start()`, and with no token shows a localized `codeRequired` prompt. Evidence: full verify 116 tests; Mac live (headed Chrome, two tabs, same user) showed exactly one replacement per handover, the replaced tab opening 0 WebSockets over 60 s, manual Connect (empty code) and reload both reclaiming, no-token empty Connect showing the prompt with no socket opened, and 0 errors. PR #13 is superseded by a fresh PR because Andrew's reviewer handles follow-up commits poorly. Do not match the replacement by close code 1000 plus a reason string without a pin test against the gateway source. (8) Andrew's review of PR #14 found [P2]: `beforeunload` stopped the link even when the user cancelled navigation, leaving Foundry open with the gateway offline, because the ready hook is one-shot. The link now stops on `pagehide` and restarts on a persisted `pageshow`; `beforeunload` is removed. (9) The reviewer swept for the "event fires before the user's final intent" pattern after three such bugs. The pairing form re-rendered on every state change and wiped a code or URL being typed during retries; now only the status element updates. `pageshow` restarts only if the link was active at `pagehide`, so a replaced tab stays put, and the lifecycle test counts listener registrations. (10) The Mac live run showed that after a bfcache round trip a REPLACED tab lost its message, because `pagehide`'s `stop()` wiped the reason; `pagehide` now stops only an active link. Evidence: full verify 124 tests; the new tests fail on the old code at each attempt; Mac live with bfcache enabled showed typing surviving retries, a real cancelled `beforeunload` dialog keeping the link connected with heartbeats, bfcache restore reconnecting in about 10 ms, and a REPLACED tab restored from bfcache neither reconnecting nor evicting the other tab (the server saw exactly 2 hellos). PR #14 is superseded by a fresh PR. Do not hang link teardown on `beforeunload` (it fires before the user's final intent), and do not call `stop()` from a lifecycle hook without checking the link is active. (11) Andrew's review of PR #16 found [P2, security]: the stored pairing token, a bearer credential, could be sent to a different gateway. After the URL changed and a code was rejected, the token fallback sent the token to the new endpoint; the lead found two more paths: an empty-code Connect after a URL change (which the lead had specified in attempt 7) and startup after the `gatewayUrl` setting changed. The token is now bound to the URL that issued it. The only wire send is the onopen hello, guarded by the socket's URL; `start()`, reconnect, the rejected-code fallback, empty-code Connect and the bfcache restart all re-check. A mismatch gives PAIRING_REQUIRED and sends nothing; a legacy token with no bound URL is discarded; `localhost` is not `127.0.0.1`. The security reviewer could not construct a bypass (userinfo, port, path, ws/wss, IPv6, trailing dot). (12) The reviewer found that changing the type of task 04's `pairingToken` setting broke the insertion-only rule, so there is a new `pairingCredential` setting; the URL is kept per socket and a duplicate toast was removed. (13) The lead found that attempt 12 had removed the resilient registrar try/catch to stay insertion-only, a regression; the lead explicitly allowed that modification and the `main.test.ts` count change. (14) The Mac live run showed an Object-typed client setting coming back as `""` after reload, so every reload forced re-pairing. It is now a String setting holding JSON, the stub can round-trip values through strings, and the reload test fails on the Object version. Evidence: full verify 139 tests; Mac final live run 8 of 8, with the credential surviving reloads (same agentId), the "other" gateway receiving exactly one frame (a pairing code) and never a token, `localhost` versus `127.0.0.1` enforced, and 0 token occurrences across 1089 console messages and both server logs. PR #16 is superseded by a fresh PR. Do not retry: never specify behaviour that sends a stored credential to a URL other than the one that issued it. (15) Andrew's review of PR #17 found [P2, low impact]: after navigating away during initial pairing and returning via bfcache, the restore called `start()`, which did nothing without a stored token, so pairing stayed stopped. `LinkClient.resume()` now restarts the mode that was active at stop: the same in-memory code only to the URL it was entered for (`codeUrl`), otherwise PAIRING_REQUIRED; token mode goes through `start()` with the attempt-11 checks. A code-to-changed-URL path during backoff is also closed (`connect()` checks `codeUrl`). Security review: code and `codeUrl` always change together, and no code or token reaches another endpoint. (16) Reviewer follow-ups, fixed before the PR: a welcome/stop race (a stop during the token write left a stopped client "connected", and resume then asked for a code) and test titles that promised untested cases. Process: during attempt 16 the implementer's `git stash pop` popped task 08's stash (the stash stack is shared); nothing was lost (backed up, work committed), and the rule since is that agents never use `git stash`. Evidence: full verify 150 tests (lead re-run after removing the stray file the stash collision left); 8 new resume/code-URL tests and 2 race tests fail on the old code; reviewer APPROVE. PR #17 is superseded by a fresh PR.

## 2026-10-09 — Module operation registry and document-to-markdown conversion (task 08)
The module now has an operation registry: `HANDLERS` maps tool names to handlers and `STAGES` is an ordered dispatcher pipeline. Failures map to `TOOL_NOT_FOUND`, `FORBIDDEN`, `INVALID_ARGS` and `INTERNAL`, and a `next()` once-guard stops a stage calling through twice. A document serialiser strips other modules' flags unless `includeOtherModuleData` is set, and results are paged. An HTML-to-markdown converter built on `DOMParser` flattens tables (iteratively, so depth does not blow the stack) and makes links safe: URLs are decoded, parsed with `new URL` against a dummy base, checked against an http/https/mailto/relative allowlist and re-encoded from the parsed result. Text is escaped, `!` before links is escaped, and nested tables are marked `[ … ]`. Evidence: full `npm run verify` passed with 173 tests (lead re-run), and the reviewer approved. Every other regex in `markdown.ts` was confirmed linear. A `marked` 18.1.0 oracle test parses the output and asserts every link maps to a real allowed `<a>`. `marked` is a devDependency only and is not in the bundle.
**Cost:** Thirty attempts, almost all on the converter and its paging. (1) Regex converter: catastrophic backtracking (cubic, minutes on 9-36 KB inputs) and script/style content leaking into output. (2) `DOMParser` rewrite: nested tables were exponential and whitespace got glued. (3) Tables built from own rows only, linear, but nested cells were glued (`Str18+4`). (4) Added separators, but depth-3 cells still glued, real semicolons were stripped, and the scaling test never exercised `flattenTable`. (5) Iterative flattening, `domToMarkdown` on a pre-parsed DOM, and scaling tests proven by mutation. (6) Link safety requested by the lead (scheme allowlist, URL encoding, text escaping, nested-table markers); security review found four bypasses: `javascript\:`, `&#106;avascript:`, a trailing backslash, and text nested more than 100 deep. (7) Structural fix (decode, parse, allowlist, re-encode), escaped depth fallback, and the oracle test, which fails 7 of 32 cases on attempt 6's code; the security reviewer then found no bypass across a long probe list. (8) URL correctness: protocol-relative collapse (`/.//evil` became `//evil`), the meaning of `&` (emit `&amp;`), and IPv6 brackets. (9) The lead's verify run flaked under concurrent load (4x input took 11.5x), so scaling tests now take the minimum of 7 runs per size with 60 s timeouts; 5 of 5 passes with all 12 cores busy, and a quadratic `flattenTable` still fails both tests. (10) Andrew's PR #18 review: flags on embedded documents (Actor items, Scene tokens, JournalEntry pages) were not filtered, so other modules' data leaked with `includeOtherModuleData` off; and unclosed `@UUID[x]{` labels rescanned the suffix each time (quadratic, about 1.7 s at 1.15 MB). Fixed with an iterative walk that filters flags on `_id` documents and a single-pass `}` latch; the new tests fail on the old code. (11) Reviewer: `prototypeToken` carries flags without `_id` and still leaked, and a whitespace regex introduced on this branch (`/[ \t]+\n/g`) was quadratic (62k spaces took about 3 s; about 12 min projected at 1 MB). Fixed by filtering every `flags` object outside a `system` subtree (core, the system id and agent-gateway kept) and a linear backward-scan trim (`/[ \t]+$/` is also quadratic); output matched the old regex over 300k fuzzed strings. Trial note: this review round was pushed to the same PR (#18) at Andrew's request, instead of a fresh PR. Do not retry: `_id`-based document detection for flag filtering; regexes with `[ \t]+` followed by an anchor or newline on untrusted text; regex-based HTML parsing; per-case URL blocklists (parse and re-encode instead); absolute-time performance assertions (use ratios of minimums). Process: a parallel task's implementer popped this task's git stash (the stack is shared across worktrees). Nothing was lost, because the lead had backed up the moved file and the work was committed. Rule since: agents never use `git stash`. (12) Andrew's PR #18 review [P2, low]: trimming formatted children removed separating spaces, so `<strong>Hello </strong>world` became `**Hello**world` and read as "Helloworld". `wrapInline` now keeps boundary whitespace outside the bold, italic and link delimiters. The lead also asked for a general guard: the marked oracle renders the output back to text and asserts the input's words survive in order, so one output token cannot satisfy two consecutive input words. It fails 32 of 150 cases on the old code and also caught nested, list, table and link-chain variants of the same cause. Evidence: full verify 350 tests (lead re-run, about 27 s); reviewer APPROVE. Pushed to the same PR as plain commits (trial). Do not retry: trimming a formatted element's text without moving the trimmed whitespace outside the delimiters. (13) Andrew's PR #18 review [P2, medium]: a tag split across text nodes (`<span>&lt;</span>a href="javascript:…"&gt;…`) reassembled into a live `<a href="javascript:alert(1)">` for markdown readers that allow raw HTML, bypassing `safeHref`; the oracle ignored HTML tokens. `escapeMd` now escapes every literal `<` and `&` unconditionally in one pass, and the oracle asserts zero html tokens at any depth over every corpus, plus a 30-case split-tag corpus (16 failures on the old code: split tag names, closing tags, comments, processing instructions, autolink-like tags, entity-encoded `&amp;lt;`/`&amp;#60;`, in lists and headings). Security review with three renderers (marked html tokens, markdown-it `html:true`, commonmark.js `safe:false`) plus an element/attribute allowlist on the rendered HTML: 35 hand cases including backslash before `<`, and about 10k seeded fuzz cases, 0 failures; the probe fails on the old code. Evidence: full verify 380 tests (lead re-run). Pushed to the same PR as plain commits. Do not retry: context-dependent escaping per text node (split nodes defeat it); oracles that ignore token types the serialiser should never emit. (14) Andrew's review of PR #18 found that page boundaries split escapes, that table width computed with `Math.max(...rows)` overflowed the stack on large inputs, and a spread-based inventory had the same problem. (15) Reviewer: untrusted cursors were snapped to a safe offset; superseded by 16. (16) Structural paging, on Andrew's guidance and a lead decision: each page is complete, independently safe renderable Markdown. Output is blocks of atomic escaped segments, fences are closed and reopened per page, line-start characters are escaped, and an oversized segment falls back to plain words. The cursor is opaque and validated (`p1.<id>.<b>.<s>.<w>`). Andrew's hazard table is the test corpus, and a paging oracle checks every page with marked and markdown-it. (17) Independent review: the plain fallback could form images (`wow![x](url)`), and marked's GFM autolinks absorbed the escaping backslash and produced a raw `<img>`. The oracles had hidden this by disabling the url tokenizer. Fixes: an assembly-time `!` guard, `<` and `&` emitted as entities, oracles run on default renderer options, `~` escaped, and fences per page (a 200 MB output became 0.3 MB). (18) Review: marked un-escapes and re-lexes link labels, so `[wow!\[x\](...)]` became an image; link labels now use numeric entities and the oracle asserts no image tokens. (19) Andrew's review: words were glued at `<br>` and block boundaries inside flattened nested cells (also the depth-cap fallback and `<pre>`); whitespace is now emitted at breaks, with a boundary corpus. (20) Lead: the text oracle was lenient (substring match), so it now requires exact token equality on the whole document and every page, with a strictness proof; the large-table test became a marker stream, which removed a 60 s timeout. (21) Review follow-up: a reported text loss with private-use input was an oracle false positive, because the serialiser deliberately maps U+E000-E0FF to U+FFFD. The oracle was aligned, linkify-normalised autolinks are accepted for typed text only, and a 1,500-document private-use corpus was added. (22) Consolidated review APPROVE: about 149k document-by-limit runs and about 7k fuzz pages on default renderers, 0 security failures; scaling tests 20 of 20 sequential. The adversarial test now parses DOMs once (the suite runs under a 2 GB heap, peak 1.87 GB; a crashed worker had printed a partial "passed"), and the `page()` doc notes that multi-segment words may split across pages. Process: two review runs OOM-killed the host session (parallel happy-dom probes, 28 GB peak), so probes now run sequentially and memory-capped. PR #18 was closed for a fresh PR after the structural rework. Evidence: full verify 3,058 tests, about 33 s. Do not retry: character-offset paging of Markdown; backslash escapes where a renderer re-lexes (link labels) or may absorb them (autolinks); oracles that disable renderer features; parallel memory-heavy probes on the shared host. (23) Andrew's PR #20 review [P2, low]: `<pre>` leading blank lines were trimmed with repeated `Array.shift()` (quadratic: about 3.1 s for 200k lines, about 200 KB); now one index scan plus a slice (b4fe63f). A class sweep of `module/src` for shift, unshift, splice, indexOf-in-loop and re-slicing found no other data-sized quadratic. Andrew approved a generic scaling oracle (`scaling-oracle.test.ts`): 163 patterns from every corpus times 6 shapes (flat, pre, pre/code after a block, table cell, list items, nested div) through the full pipeline including paging, min-of-runs at n versus 4n, ratio under 10, 3 s backstop, about 19 s; each parse uses its own happy-dom Window, because a shared window retains about 0.5 KB of heap per input byte. Proven: it fails on df84e41 for the pre shapes (`\n` 117 ms to 2.7 s) and on an injected `indexOf`-in-loop quadratic. Evidence: full verify 3,067 tests, about 35 s wall, peak RSS about 2.0 GB (lead re-run). Pushed to PR #20 as plain commits. Do not retry: `shift()`/`unshift()` loops over data-sized arrays. (24) Andrew's PR #20 review [P2, low]: rows were eagerly padded to the widest row (one N-cell row plus N narrow rows gave about 2N² segments; 2,000,999 at N=1,000). Missing cells are now kept implicit (only the header and delimiter rows carry full width; short rows render correctly in marked and markdown-it), and tables over `SERIALISE_CONFIG.maxTableColumns` (64) flatten to text rows, which also fixed the repeated-huge-header blow-up (a wide header paged small went from 18.5 MB to 296 MB on 3488deb). The scaling oracle gained size assertions (segments, page bytes at most linear) and 14 combinatorial shapes; 4 fail on 3488deb. (25) Andrew approved a fast/slow test split: slow tests are `*.slow.test.ts` (vitest project `module-slow`, `module/vitest.slow.config.ts`). `npm test` runs the protocol, module and gateway fast suites (about 5 s, 1,205 tests, with sampled paging safety at limits 1/8/50/1000 and cursor tests); `npm run test:slow` runs the scaling oracle, min-of-runs tables and full oracle sweeps (2,223 tests); `npm run verify` is build, lint, test and test:slow (the gate is unchanged). (26) Review of 24 reported a blocking word-glue (`foo<br>bar` becoming `foobar`) in the over-cap flattening. The implementer found, and the lead confirmed at 33abf9e (whole document and pages at limit 50, five variants), that it does NOT reproduce through HTML, because markdown.ts already turns breaks into spaces upstream; the reviewer had probed the stream parser directly. It was fixed anyway as defensive hardening (a `br` segment becomes a space; dead `sep` handling removed), proven by a stream-level test, and 54 over-cap tables (65/200 columns, 9 cell variants, 3 positions) were added to BOUNDARIES (fast sample plus full slow sweep). Evidence: `npm test` 1,205 tests in about 5 s; full verify 1,205 + 2,223 tests, about 65 s, peak about 1.8 GB (lead re-run). Do not retry: materialising implicit table cells; time-only scaling checks (add size checks and combinatorial shapes); reporting a reviewer's probe result as a bug without reproducing it through the public pipeline. (27) Final review rounds on PR #20. Paging a long table cell rescanned the row's consumed segments on every continuation page to find the starting column (4df512c; about 16x work for 4x input). Each row's segment columns are now computed once and cached (`segColumns` in `page.ts`). A segment-read count test in `large-table.test.ts` fails on the old code (15.9x and 14.3x), the scaling oracle's combinatorial shapes are now timed at their own page limit (they were always timed at the default limit, a test bug), and two long-cell shapes were added. (28) Block containers such as `details`, `summary`, `header`, `main` and `figcaption` fell through to inline concatenation (`TitleBody`) (0f6774b). The renderer now uses the same full block list as plain-text flattening (`BREAKS`, exported, plus `hgroup`, `search` and `dialog`). `block-boundaries.test.ts` covers every block tag in four contexts, whole document and paged; 71 cases failed on the old code. (29) `renderTable` dropped `<caption>` (741fe5f). Captions now render as a paragraph before the table, and caption-only tables keep it. A CAPTIONS corpus runs through text-preservation, the markdown oracle and the paging oracle; 35 cases failed on the old code. (30) Continuation pages repeated the whole header, so a header longer than the page made output grow as header length times rows (1.0M to 16.1M chars at limit 50) (b586028). The real header now repeats only if it is at most `limit * SERIALISE_CONFIG.maxRepeatedHeaderShare` (0.5) or at most twice a blank header; otherwise a blank header of the same width repeats. A growth test fails on the old code (15.8x and 11.0x), a LONG_HEADERS corpus runs in the paging oracle, and a combined shape is in the scaling oracle. Evidence: `npm test` 1,408 fast tests (about 5 s), `npm run test:slow` 2,226 tests (about 51 s), full verify about 65 s. Lesson: timing-based scaling checks were too noisy to catch the column rescan (a few ms); operation and size counts are the reliable regression check.

## 2026-10-09 — Gateway link server and pairing (task 06)
`gateway` now runs a WebSocket link server on 127.0.0.1 with an Origin allowlist; a connection with a missing Origin is refused, and the reviewer agreed with that. The hello/pairing handshake runs `checkCompat` before any auth. Pairing codes are single-use, last 10 minutes, come from `crypto.randomInt` with no look-alike characters, and expired ones are pruned. Only the SHA-256 of a token is stored, in `node:sqlite`. A `LinkRegistry` keyed by (world, user) tracks live links, and a 15 s heartbeat drops dead ones. Evidence: 21 gateway tests stable over 3 runs; full `npm run verify` after rebasing onto main passed with 86 tests.
**Cost:** Four attempts. (1) Passed, but migrations were inline in the store, against conventions; it also had a vacuous hash test and let expired codes accumulate without bound. (2) Migrations moved out, but loaded by a runtime directory scan plus top-level await; the reviewer showed this crashes in any single-file bundle. (3) A static, insertion-only `MIGRATIONS` registry in `store/migrations/index.ts`, proven by running an esbuild single-file bundle alone in an empty directory (user_version 1, pairings table present). Do not go back to scanning the filesystem for migrations. (4) A prettier fix, because attempt 3 had not run the full `npm run verify`. Two attempts this wave failed for that reason alone.

## 2026-10-09 — Gateway skeleton and stdio MCP server (task 05)
`gateway` now has config loading, a stderr-only logger, an app wiring layer and an MCP server over stdio, started by `gateway/dist/bin/cli.js`. The tool registry is empty, so `tools/list` returns no tools and an unknown `tools/call` returns `tool_not_found`; for registered tools, `WORLD_OFFLINE` is returned when no module is connected (proven by a unit test with a fixture tool). Tester passed (clean `npm ci`, `npm run verify` 65 tests in 9 files, MCP Inspector CLI against the built binary); reviewer approved 7 of 7. stdout carries only MCP frames.
**Cost:** The server test sleeps a fixed 1500 ms rather than waiting for the response line, so it can flake. CLI tests need a prior build. The npm package depends on the private `@agent-gateway/protocol` workspace, which must be bundled or published before release.

## 2026-10-09 — Module skeleton and v13/v14 compat layer (task 04)
The module now has a skeleton with a compat layer that isolates Foundry v13/v14 differences, a settings registry (gatewayUrl, pairingToken, includeOtherModuleData) and Foundry stubs for tests; it logs `agent-gateway | ready (v14)`. Tester passed (`npm test -w module` 17/17), reviewer approved. On the Mac test bed (Foundry 14.369, pf2e, headless Chromium from first navigation) there were 272 console messages with 0 errors, 0 warnings and 0 page errors, and `foundry.documents.BaseLevel` is a function on v14.369, so the Levels probe name is right.
**Cost:** v13 is unverified because no v13 instance exists. `hasSceneLevels()` is tree-shaken out of the bundle as unused, so its live result is unchecked. The isolation test regex misses `game['release']`, destructuring and `game.version`, and `foundryGeneration()` silently returns 13 if `game.release` is missing.

## 2026-10-09 — Tool definition framework (task 03)
`protocol` now has a tool definition framework that generates JSON Schema from zod and tests that schemas stay conservative, with tool-count limits of 24 player and 36 GM (approved by Andrew). Tester passed (17 tests in 3 files), reviewer approved 7 of 7. Andrew's review of PR #6 then requested two P2 changes: the schema-keyword checks were applied to the `properties` dictionary, which gave false positives for fields named `properties`, `oneOf`, `anyOf` or `allOf`, and the description check covered input only. Attempt 2 (commit 4901ea0) fixed both, with a positive fixture (`keywordNamedFieldsTool`) and an output negative fixture (`undocumentedOutputTool`); tester 19/19, with proof that both new tests fail against the old walker; reviewer APPROVE, no rule weakened.
**Cost:** zod v4 collapses primitive unions to `type` arrays and merges intersections, so the sweep also flags type arrays and the allOf rule is proven with a raw-schema fixture rather than a real zod schema. In attempt 1 the walker descended into the `properties` map and checked only input descriptions (both fixed in attempt 2, above); it still does not follow `$ref`, so a recursive schema could bypass the depth-3 check.

## 2026-10-09 — Link protocol and version handshake (task 02)
`protocol/src/link/` defines every module-gateway message in zod: hello/welcome/reject handshake with pairing, tool call and result, ping/pong and the error codes, plus a version compatibility check. PROTOCOL_VERSION is 1.0.0 and MAX_FRAME_BYTES is 1 MiB, measured with TextEncoder so it runs in browsers. Tester passed (20 tests), reviewer approved 5 of 5.
**Cost:** `checkCompat` messages say "local/remote side" instead of naming module and gateway, so they are not yet actionable. The version regex is not end-anchored, so `1.0.0garbage` parses as major 1.

## 2026-10-09 — Workspace test wiring and scaffold follow-ups (task 01b)
Root `vitest.config.ts` now lists `protocol`, `module` and `gateway` under `test.projects` (the inert `vitest.workspace.ts` is gone), each workspace has a `test` script so `npm test -w protocol` works, `module/tsconfig.json` sets `types: []` so Node globals no longer type-check in browser code, and root `allowScripts` approves `fsevents`. Verified by tester on the homelab, on the Mac test bed (macOS 27.0.1, Node 24.19: fsevents warning gone, `npm approve-scripts --allow-scripts-pending` reports nothing unreviewed) and by reviewer (9 of 9 criteria). A trial merge of tasks 02, 03 and 04 onto it had no conflicts and the root runner found 54 tests in 7 files.
**Cost:** There are no tests on main yet, so the passes prove wiring only. `npm approve-scripts fsevents` cannot run on Linux because fsevents is not installed, so the entry was written by hand. Project names print only with a TTY or `--reporter=verbose`, and the module project shows its package name and default include until task 04's `module/vitest.config.ts` lands; the root config deliberately has no module `include` override.

## 2026-10-09 — Workspace scaffold (task 01)
The repo is now an npm workspace with `protocol/`, `module/` and `gateway/`, a root `module.json` (id `agent-gateway`, v0.1.0) and one `npm run verify` that builds, lints and tests. The built module logs `agent-gateway | loaded` on `init`, and `docs/conventions.md` fixes layout, ports (link WebSocket 7420, local HTTP 7421) and the insertion-only shared files. Verified by tester (clean `npm ci`, build and lint), reviewer (10 of 11 criteria from the diff) and a Foundry 14.369 / pf2e 8.6.0 console check on the Mac.
**Cost:** Tests are vacuous (`vitest --passWithNoTests`) because `vitest.workspace.ts` is inert under vitest 5 and needs `test.projects` in a root config; do not trust "tests pass" until that is fixed. `module/tsconfig.json` lacks a `types` restriction, so Node globals leak into browser code. The first console capture missed about 617 early boot messages, so "no errors" rests on a partial log. Implementer added `typescript-eslint` as a devDependency and set the gateway tsconfig to `types: ["node"]`.

