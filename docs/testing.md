# End-to-end testing

The e2e suite drives a real Foundry (browser, module, gateway, MCP client). It is separate from `npm test` and `npm run verify`, which never run it. It needs a machine with Chrome or Chromium and access to the Foundry instance (the Mac test bed).

## Prerequisites

- Foundry v13 or v14 at `FOUNDRY_URL` with world `test-world` (game system `pf2e`) launched, the Agent Gateway module linked and enabled, and an active scene.
- Foundry users that exist already: GM `dev-gm`, players `player1` and `player2`. `player1` owns `Actor.6i6mZ5g8vX8iU9RD` (OWNER permission). This character is a prerequisite: the seed does not create it. On a fresh world, obtain the owner's approval to create the test character before seeding; do not repurpose an existing actor.
- `npm ci` and `npm run build` in this repo. `playwright-core` is a dev dependency and downloads no browser; the harness uses the system Chrome (channel `chrome`), or the binary named by `CHROME_PATH` (`AGENT_GATEWAY_E2E_CHANNEL` selects another channel, for example `chromium`). Set `AGENT_GATEWAY_E2E_INSECURE_TLS=1` only if Chrome does not trust the Foundry certificate.
- Optional `~/.config/agent-gateway/test.env` (`KEY=value` lines). The environment overrides it.

| Key | Default |
| --- | --- |
| `FOUNDRY_URL` | `https://foundry.local` |
| `FOUNDRY_WORLD` | `test-world` |
| `FOUNDRY_GM_USER` | `dev-gm` |
| `FOUNDRY_PLAYER_USER` | `player1` |
| `FOUNDRY_PLAYER2_USER` | `player2` |
| `FOUNDRY_GM_PASSWORD` | unset; filled only for the GM user, and only when set |
| `FOUNDRY_PLAYER_PASSWORD` | unset; filled only for the player user |
| `FOUNDRY_PLAYER2_PASSWORD` | unset; filled only for the second player |
| `AGENT_GATEWAY_E2E_LINK_PORT` | `7429` (never `7420`, the dev port) |
| `AGENT_GATEWAY_E2E_V13_URL` | unset; enables `--foundry v13` |
| `AGENT_GATEWAY_E2E_PAIR_TIMEOUT_S` | `300`; how long setup waits for a human |
| `AGENT_GATEWAY_E2E_CONNECT_TIMEOUT_S` | `20`; the most one user's wait for a stored pairing to connect may take (the two users share a 43 s budget) |
| `AGENT_GATEWAY_E2E_HEADED` | `1` shows the browsers during seed, clean and runs |

Keep passwords out of the repo; they belong in the environment or `test.env`. The old single `FOUNDRY_PASSWORD` is no longer read: if it is set, the harness prints a one-line warning and ignores it. A password variable that is defined but empty in the environment means "no password" and overrides a value in `test.env`.

Foundry user names are matched against the join screen exactly first, then case-insensitively, because the world's real names may differ in case (`test-world` has `Player2`). When nothing matches, the run fails listing the names the join screen offers. Set `FOUNDRY_PLAYER2_USER` and friends to the real spelling anyway: the gateway binds `--user` by the name recorded at pairing.

## Commands

1. `npm run test:e2e:setup` (once per user, repeat if a pairing is lost). For each user it starts a gateway on the e2e port, opens a headed window whose title and red banner show the user name and the pairing code, joins the world, sets the client `gatewayUrl` to `ws://localhost:<port>`, opens the pairing app, and waits for a human to type the code. The harness never types the code. It confirms each pairing with `world_info`, prints `paired <user>`, and exits 0 when everyone is paired. Add `--player2` to pair the second player too (used by the multi-user suites).
2. `npm run test:e2e:seed` creates the `ag-test-*` fixtures as the GM. **This writes to the world.** Run it only with the world owner's consent (Andrew), once; running it again leaves exactly one of each fixture. It prints per-type flagged and unflagged counts before and after, and records the blind roll total and the fixture UUIDs in the state directory.
3. `npm run test:e2e [-- --foundry v14|v13]` runs unattended: local state checks (under 5 s), then reconnects each user with the stored token (a stale token fails within 45 s of the start: opening both users' sessions, including the gateway start, browser launch, join and connection wait, runs inside one shared 43 s deadline, and cleanup after a failure is bounded to 2 s), checks the fixtures, runs the read suites sequentially and writes the summary. Failure messages say `run npm run test:e2e:setup` or `run npm run test:e2e:seed`.
4. `npm run test:e2e:clean` deletes only documents flagged `flags['agent-gateway'].fixture` and restores the world to its pre-seed state. It prints per-type counts before and after: flagged goes to 0, unflagged is unchanged.

On a fresh world, pair only the GM first (`npm run test:e2e:setup -- --only dev-gm`), run the owner-approved seed, then pair the players (`npm run test:e2e:setup -- --only Player1 --only Player2 --player2`). Use the exact configured user names in `--only`; the example spelling may differ from your world. Seed enables player agents for the fixtures, so pairing a fresh player before seeding can fail the setup `world_info` probe with `FORBIDDEN`. All pairing codes remain human-entered. Ensure the owned-character prerequisite above exists before the read suites.

Offline checks of the harness itself (no browser, no Foundry): `npx vitest run --config e2e/vitest.e2e.config.ts --project e2e-unit`, then `npx tsc -p e2e/tsconfig.json --noEmit` and `npx eslint e2e`.

## State directory

Everything persistent is under `~/.config/agent-gateway/e2e/`, mode 0700 for directories and 0600 for files; nothing is written inside the repo.

- `profiles/<user>/`: one persistent Chromium profile per user (holds the Foundry session and the module's stored credential)
- `gateway.db`: the gateway's pairings
- `fixture-state.json`: blind roll total and fixture UUIDs written by the seed
- `e2e-summary.json`: written by every run (Foundry URL and version, per-suite pass, fail and skip counts, tool counts per role, leak-check summary)
- `run-data.jsonl`, `vitest-report.json`: scratch files of the current run

One gateway process is one MCP session and one link server, so a run that needs a different `--user` restarts the gateway on the same port and database. Only one browser per user is open at a time.

## Fixtures

Folder `ag-test-hidden-folder` with JournalEntry `ag-test-hidden` (NONE); `ag-test-public` (OBSERVER; pages `public` with a secret section, `gm` with page ownership NONE, `markdown` with a secret); `ag-test-limited` (LIMITED); on the active scene a hidden and a visible token, a hidden drawing, a public and a hidden note and a secret-door wall; six chat messages (public, GM whisper, player1 whisper to the GM, player1 blind `7d6` roll, an NPC message with a secret, player1 speaking as their character with a secret). Edit `e2e/fixtures/spec.ts` and `manifest.ts` together: the manifest lists the strings a player must never receive.

## What the read suites assert

Player (`player1`): journal search and `document_get` visibility ("not found", never `FORBIDDEN`), stripped secrets, `ownership` of `{ yours: 2 }`, chat visibility, the LIMITED compendium pack hidden, paging of a long compendium entry. GM (`dev-gm`): every fixture is visible. Both roles: `world_info`, and the player's tool list is a subset of the GM's with no `minRole: 'gm'` tool. Every player result is scanned for every hidden string; the summary reports `leak check: <n> results x <m> strings, <hits> hits`. The blind roll total is matched only where labelled (`"rollTotal": n` or `= n`), because a bare number matches timestamps.

## Multi-user and resilience

The suites under `e2e/multi/` prove the guarantees of tasks 11 and 11b with two Foundry users connected to the same gateway. They need **two browsers open at once** (dev-gm and player1; the cross-player suite uses player1 and player2) and the same stored pairings as the read suites. They never type a pairing code.

- `isolation`: with a gateway started `--user player1`, `world_info`, `document_search`, `document_get` and `chat_read` answer as player1 (role Player) and the GM page's link WebSocket gets 0 call frames while player1's gets 4. The same with `--user dev-gm` reverses the counts. Frames are counted from Playwright WebSocket events on the link port, so pings do not count. With player2 paired, a gateway started `--user player2` returns a `chat_read` without player1's whisper, passes the hidden-string check, and player1's page gets 0 call frames.
- `ambiguity`: a gateway started with `--world` and no `--user` while two pairings are active answers `world_info`, `document_search`, `document_get`, `compendium_search`, `compendium_get` and `chat_read` with `INVALID_ARGS` naming both users, and neither page receives a call frame.
- `resilience`: reloading player1's tab gives `WORLD_OFFLINE` on the next call, then a call succeeds within `AGENT_GATEWAY_E2E_RELOAD_S` seconds (default 30; expect about 5 to 15 s). Stopping the gateway by its PID and starting a new one on the same port and DB recovers within 60 s (the module's reconnect backoff caps at 60 s with jitter; expect under 30 s) with no code entered and the same number of active pairings.
- `stale-token`: against a throwaway state directory (`AGENT_GATEWAY_E2E_STATE_DIR`, created under the system temp directory and removed afterwards) holding a fabricated pairing and a copy of the real player profile (whose token the scratch DB does not know), the gateway answers the module with a `PAIRING_INVALID` reject frame and the run fails within 45 s, end to end, with `run npm run test:e2e:setup`. It skips with a `SKIP:` line when there is no stored player profile to copy. The real state directory is only read.

Suites that use player2 skip with `SKIP: player2 not configured` when `FOUNDRY_PLAYER2_USER` has no active pairing in the DB (pair it with `npm run test:e2e:setup -- --player2`). Measured frame counts and recovery times are printed as `[multi] ...` lines and listed in the printed summary and `e2e-summary.json` (`multi`).

## Testing v13 separately

`npm run test:e2e -- --foundry v13` targets `AGENT_GATEWAY_E2E_V13_URL`. Without it the run prints `SKIP: v13 instance not configured (set AGENT_GATEWAY_E2E_V13_URL)` and exits 0. For setup and seed, set `FOUNDRY_URL` to that same v13 URL; those commands do not accept `--foundry`. Set `AGENT_GATEWAY_E2E_STATE_DIR` consistently to a separate directory (for example `~/.config/agent-gateway/e2e-v13`) for setup, seed and runs, keeping v13 pairings and profiles separate from v14.

The configured v13.351 / PF2e 7.12.2 instance passed the full core/read/multi-user gate: 34 tests passed, zero failed, and the optional Hello Pack test skipped (35 discovered). The v14.369 gate passed all 35 tests, and Hello Pack enabled/disabled lifecycle acceptance was also checked separately on v14. These results do not claim Hello Pack lifecycle validation on v13.

## Native approved-write acceptance

The task 21 native harness is separate from read-only `test:e2e`. Its exact
fixture payloads, targets and cleanup require human approval. A harness opt-in
is a guard, not authorization. The real default-policy approval dialog remains
in the path; the human approves requests. Preserve each version's pairing
profiles and keep the controlled GM session open while player audits drain.

Before creating fixtures, check the installed and loaded module manifest
includes `documentTypes.JournalEntryPage.audit` and the native allowed subtype
includes `agent-gateway.audit`. A JavaScript route cannot repair server-loaded
metadata. Metadata changes, service restarts and configuration writes require
specific approval; Andrew performs admin world relaunches. Do not silently
replace or adopt an untrusted audit journal.

Read-only preflight must prove the controlled user is the designated active
GM and no other GM is active. Verify the persisted native world Setting
`agent-gateway.auditJournalId`: exact key, user:null, decoded value matching the
selected journal and server-managed lastModifiedBy resolving a current GM.
The selected journal must be flagged, default ownership NONE and inaccessible
to every non-GM user. World scope alone is insufficient because setting-write
permission can be delegated. Native v13/v14 documents have no createdBy field;
a journal's last editor is not its creator.

List tools through the real SDK before calling them. Record the exact observed
production bundle hash, full Foundry version and module version. Track every
started call immediately and await all settlements before deleting fixtures;
an error or screenshot failure must not leave an untracked late creation.
On failure invalidate pending requester continuations before cleanup, and
report incomplete cleanup explicitly rather than declaring success.

Audit relay success is asynchronous. Use a bounded read-only persistence wait
for exact current-run user/agent/tool/arguments and unique entry IDs. Wait for
the first four records and safe created targets **before submitting append**:
the GM witness has a 1,500 ms grace window and correctly refuses undo if the
created page changes before it assembles. Then wait for all five final records
before assertions and cleanup. Check three safe created targets, the append's
before-snapshot and zero no-chat targets. Successful tool responses or audit
page counts alone are insufficient.

Cleanup only the exact returned fixture UUIDs and verified fixture parent;
never select campaign documents broadly by name. Read back exact absence and
retention of matched audit UUIDs, close only the sessions/processes started by
the run, and preserve audit records. Local screenshots can establish readable
native approvals and AI badges without publishing campaign data or credentials.
The verified task 21 evidence covers GM and Player1 on v14.369 and v13.351,
using separate controlled runs and the exact historical `d0a11fb` bundle
`9151dcaece963660a3c93039613b4580ded558f9c9f0d5546f4e9f59cecb33c4`.
The implementation PRs #55–58 and #60 are now merged. Later policy snapshot
and harness-only preflight gates are offline verification, not new native
acceptance. The preflight accepts valid legacy matrices or validated version1
envelopes and refuses malformed data before fixture setup.

## Native token and combat acceptance (task 22)

Task 22 uses the separate test-only harness under
`module/test/tools/player-tokens-combat/native-proof.mts`. It is not the read-only
E2E suite. A fresh run requires explicit approval for its exact fixture payloads
and cleanup on each target; `AGENT_GATEWAY_TASK22_APPROVED=exact-fixtures-and-cleanup`
is an opt-in guard, not permission. Keep v13/v14 state directories separate.
Read-only preflight checks the actual version, active module, audit metadata and
GM-written private audit designation, unique stored user pairings, default
owner-approval policy and zero-time native turn advancement prerequisites.
Close other tabs using the controlled GM account: native Combat deletion can
activate the viewed combat in every same-user tab, which active-user counts
cannot detect.

Per world the approved plan creates two minimal owned/unowned PF2e NPC actors,
one private fixture scene, three tokens and one scene-specific combat with three
combatants (ten returned UUIDs). It never activates the scene globally. After a
hidden-current status read and a fixture-only GM turn setup, the human approves
five requests, then the final unowned-turn request. The harness never clicks
approval controls; its shared current-template selector waits for exactly five,
then one visible card with matching enabled controls. Preserve the controlled
GM relay while all calls settle and six exact current-run audits drain. Retain
observed audit UUIDs even if another call fails or persistence times out.

Before deleting exact flagged fixture parents, clear the controlled combat views;
restore personal scene/combat views and targets only after deletion. Read back
all ten returned UUIDs absent, matched audit UUIDs retained, original combat
state unchanged and world time unchanged. Never broadly delete campaign records.
The v14.369 and v13.351 runs passed three writes and three FORBIDDEN refusals
per world using merged source `ba52acd` and observed production SHA-256
`9ae039a7198c3136ea237b531cd5c38b1030465387592df3d9bb167a0d16124b`.
Temporary browser asset routes served the exact local bundle, with the current
HBS approval template preloaded; no production deployment is claimed.
Only a full movement path without obstacles was tested natively; partial wall/cost paths and
v13 completion normalization have offline regressions. Combat targets remain
view-only, movement snapshots may be conservatively stale, and transient
selection has no undo target. No native Undo or unobstructed board screenshot
proof is claimed. The initial v14 selector failure expired all five unexecuted
requests and removed all ten fixtures before the reviewed retry. Private images
remain local. See `plan/done/22-player-tokens-combat.md` and its HISTORY entry.

## Native GM document and Undo acceptance (tasks 23, 23a)

The separate test-only harness is under
`module/test/tools/gm-documents/native-proof.mts`; it is not the read-only E2E
suite. Run only with explicit human approval for the exact per-world fixtures,
MCP mutations, one human Undo and exact cleanup. An opt-in environment flag is
not permission. Keep v13/v14 pairing state separate, close other sessions using
the controlled GM account, pin `AGENT_GATEWAY_TASK23_EXPECTED_BUNDLE_SHA` to the
reviewed local build, and validate the active module, actual version,
private GM-designated audit anchor and current owner-approval policy before
creating fixtures. The harness must never click approval or Undo controls.

The approved plan creates/imports three roots (minimal PF2e NPC Actor,
JournalEntry and a copy of an existing compendium Item), adds one named
ActiveEffect and one text Page, updates Actor/Page data, then deletes the three
roots in one grouped call. Human approvals are batches of 3/2/2/1. Wait for eight
exact current-run successful audit records before presenting the one grouped
Audit UI Undo. Verify all five saved root/child UUIDs and content after that
human action, not merely root return values or a success notification. Preserve
the read-only source compendium entry.

A passive test-only SocketInterface observer preserves original arguments,
receiver, return promise and errors. It captures only the exact audit page's
raw update progress, then performs bounded raw reads and reservation checks.
Sensor errors, missing/ambiguous observations, limits or unfinished reads fail
the proof. Final completion needs three exact root IDs, current GM, positive
completion time, zero reservation and fresh persisted confirmation. This is
observability, not a replacement for native Undo, document permissions or the
reservation authority. Standalone browser compilation avoids reliance on tsx
serialization helpers. Resume mode may reuse an unchanged verified deletion
entry without replaying MCP calls only after exact checkpoint custody and
fresh authority checks, under the already-approved unconsumed human Undo scope.

Cleanup targets only the returned fixture roots and their descendants. Settle
calls and drain audits with the GM relay alive; refuse uncertain mutation or
live reservation rather than broadly deleting campaign data. Verify all five
UUIDs absent, eight matched audits retained, personal views and world time
unchanged. Keep before/after evidence and images local.

The successful v14.369/v13.351 proof used source `a45541a`, production SHA-256
`4a35b9e697c17ba92d4f35efb128b0ebf665c144637657c67acec083aef04b32`
and native-executed private harness SHA-256
`8ede52416c640d127472b2e3375846b12c7b65e14013fab42588c1a22f78a235`.
Temporary bundle routes and compiled native template-cache entries were used;
no deployment is claimed. A later reusable harness preparation is offline-only
unless separately run. Native coverage is one grouped three-root deletion with
Effect/Page restoration per version, not direct embedded-only Undo, every
class, concurrent reservations or partial-failure retries. PR #63 is merged at main `83d216d`, with head `0cf35c3` passing 3,042 fast /
2,227 slow tests and 47 independent focused checks. The contracts are archived
at `plan/done/23-gm-document-tools.md` and
`plan/done/23a-native-undo-restoration.md`. HISTORY preserves earlier failures
and exact cleanup, including the optional native Page defaults repaired in
task23a. The combined reusable-harness gate is separate from the native runs.

## GM scene, token and combat native acceptance (task 24)

The explicitly approved write harness is
`module/test/tools/gm-scene/native-proof.mts`, separate from read-only E2E.
Require a generation-specific test-world target, isolated existing pairing/profile,
exact reviewed source/bundle pin, sole active GM and no other same-account tabs,
trusted audit anchor, once-only owner approval for write/destructive, and zero
turnTime with the approved two-combatant same-round plan. Match the native gateway
port to the local listener; stored pairing or an offline tools list is insufficient.
The harness must prove exact authenticated world/user/agent/live connection and
three tool announcements before any fixture write, then recheck that connection.
The `AGENT_GATEWAY_TASK24_PREFLIGHT=readonly` mode performs these prerequisites and
MCP listing without fixture creation or tool calls; it is not native acceptance.

Fixture execution needs `AGENT_GATEWAY_TASK24_APPROVED=exact-fixtures-and-cleanup`
and a separately approved per-world plan. It runs 16 real MCP requests, with a
human once-only decision for each: deliberate denial of the first end request,
then approval of the second. Never substitute expiry or a session grant. The plan
creates only returned disposable Actor/Scene/Combat roots and descendants, uses
global fixture activation and personal view changes, and retains 15 exact audits.
Verify per-step native effects and unchanged time; cleanup only exact owned UUIDs,
restoring original active scenes, scene/level/targets/combat views, baseline roots
and ordinary source data. Uncertain pending execution, changed activation custody
or missing/ambiguous audit evidence requires manual reconciliation, not broad
cleanup. Previously captured audit UUID plus entry ID binds repeated equal-args
calls; revalidate identity, args, category and result rather than choosing a row.

Source `79f6d713` and production SHA-256
`5e23eca373bd9728e837bc7fe9cac135b147ec210635c44ddcec93023683dee0` passed the approved native
v14.369/v13.351 plan: respectively 13/12 successes, two/three handler refusals and
one human denial; 15 audits each, nine/seven fixture UUIDs absent after cleanup.
The v14 final drain required separate zero-MCP reconciliation/cleanup; the initial
v13 wrong-port attempt created three roots, produced no new audits and was cleaned
before the successful run. Native v14 executed private harness SHA-256
`9d80382faada6fbfa063714233f1675ee445483b6fb5fb4aed1aaf3831300894`; native v13 executed private harness SHA-256
`598038a43af03baf601833bcba181a21afba97ca644f3a01cd11fc102671bcb6`; later reusable publication is a
separate offline change. Temporary exact bundle routes/native template preload
were used; no installed deployment or public screenshot claim is made. PF2e
initiative is expected to refuse, v13 Levels are unsupported, and this evidence
does not cover Undo, every combat action, concurrent GM calls or clock-changing
progression. PR #65 is merged at `a150498` (head `377ae79`); its contract is archived
at `plan/done/24-gm-scene-token-combat.md`.

Reusable harness/documentation head `b669465671ed67baaadc507c63b85cf7f8bbd7c7` passed the combined required build/lint/full gate (3,158 fast / 2,227 slow tests), with 15 focused harness checks, standalone TypeScript, ESLint and actual-transpiled browser serialization checks. Production bundle remained unchanged. This is offline tooling verification, separate from the native-executed harnesses and the 3,143-test source gate.

## GM table, playlist and notification native acceptance (task 25)

The explicitly approved harness is `module/test/tools/gm-ambience/native-proof.mts`,
separate from read-only E2E. Require a generation-specific test-world target and
matching link port, exact reviewed source/bundle, stored pairing plus authenticated
live GM/world/agent/connection and three announced tools before fixtures. Require
one active canonical GM with other same-account sessions closed, exact Player1 and
Player2 identities, trusted private audit anchor and once-only human write approvals.
The opt-in `AGENT_GATEWAY_TASK25_APPROVED=exact-fixtures-and-cleanup` never replaces
fresh approval of the concrete payload. Native source verifies module-channel sender
attestation on v13/v14; receivers authenticate the separate server-supplied sender,
not payload identity. Server relay acknowledgement is not recipient-display proof.

The approved seven-call plan uses one disposable table/two overlapping results and
one disposable playlist/two repeating sounds using an existing bundled asset. Both
sounds remain volume zero during play/next; verify complete stop before changing
volume to 0.25, with no subsequent play. Draw once without replacement/no chat,
perform one approved fixture-only reset, then draw with replacement/blind AI chat.
Notify only Player1 with escaped literal text and localized AI prefix; verify GM and
Player2 absence. Match exact output/source references, native private-content DOM
and redacted dice, not message/card absence: native blind rolls may show placeholders.
Save all participant facts before assertions. Capture exact audit UUID plus entry ID
for each call and freshly validate the retained set after terminal-only exact cleanup.
Uncertain execution or ambiguous identity requires reconciliation, never broad deletion.

Source `4d8b9d1f4520ff3d0a39fbd7f3cc9b045cd0b6b5` passed build/lint/full verification
(3,211 fast / 2,227 slow tests), 90 independent focused checks and an actual Chromium
no-network/no-execution probe of the shared inert text helper. Both native versions
14.369/13.351 observed bundle `ad5438ea93336082f34d9b0e4b962eef6c97eb94370aa7db437947993eb21ae6`
and passed seven successful once-approved calls, seven exact audits and seven removed
fixture UUIDs per world. Original root/source/chat/reference state, personal views and
world time were unchanged. Executed private harness SHA-256 was
`813ed9591f7f4cb20ad1f2a62a3a8a7c300056a0c7c0e4dae0bf4f5670c6f456`. Temporary bundle routes and native
approval-template preload were used; no installed deployment is claimed.

Both final successful runs completed immediately; pending completion remains a
text-only API and is not evidence of preserved structured output. Earlier v14
harness failures cleaned six/one and seven/seven fixtures/audits respectively; a
v13 environment mismatch stopped before effects. HISTORY records those limits.
Later reusable harness generalization is an offline change until independently run.
PR #67 awaits merge and the contract stays at
`plan/tasks/25-gm-table-playlist-notify.md`. No native recursive table draws, every
playlist mode, audible playback, automatic Undo, concurrent-GM behavior or public
screenshot export is claimed. Natural audio lifecycle callbacks remain native.

## Permission rules on the Mac (auto mode)

Automated logins and world writes are gated in auto mode. Approve or allow-list by command:

- Needs Andrew's approval each time (human in the loop): `npm run test:e2e:setup` (headed browsers, a human types the code), `npm run test:e2e:seed` and `npm run test:e2e:clean` (writes to the world).
- Allow rule once the above has been done: `npm run test:e2e` and `npm run test:e2e -- --foundry v13`. It logs in with stored profiles, spawns `node gateway/dist/bin/cli.js` as a child, launches Chrome with a profile under `~/.config/agent-gateway/e2e/`, and makes read-only tool calls. It writes nothing to the world.
- Also needed: read and write under `~/.config/agent-gateway/e2e/`, read of `~/.config/agent-gateway/test.env`, a listener on `127.0.0.1:7429`, and outbound access to `FOUNDRY_URL`.
- Run unattended: `npx vitest run --config e2e/vitest.e2e.config.ts --project e2e-unit`, `npx tsc -p e2e/tsconfig.json --noEmit`, `npx eslint e2e`.

Processes are stopped only by their own recorded PID; the harness never matches processes by name.
