# Plan

What is open, in priority order. Only `scribe` edits this file.

Each item: one line of what, one line of why it matters, and its blocker if it
has one. When an item is in flight, mark it with its task ids. Delete items you
no longer want rather than letting them rot — a plan nobody trusts is worse
than no plan.

---
Inventory: 93 done in `docs/plan/done/` (excluding its README.md), 19 active in `docs/plan/tasks/` (2026-10-16).

Direction (Andrew, 2026-10-13): the dnd5e work stops after 32, which proved the
adapter abstraction; 58 is parked. The next goal is MVP A (a local install),
then MVP B (VPS/hosted). MVP A is complete. v0.1.0 is tagged on 5540b1e (includes 86 and 88) and its CI run is building the image; Andrew also tagged v0.1.0-rc.2 on the same commit. Publishing the GitHub release stays deferred until MVP B is done (Andrew, 2026-10-14).

---

## Now

### 0a. Tasks 37, 38, 40, 43, 93, 94, 96 and 97 merged; 98 done on branch (PR #160); 0.3.0 (93 + 94) ready to cut
- **38: stored headless agents (merged, PR #153, be8ab45; archived in `docs/plan/done/`).** `headless add|list|remove`, agents stored in SQLite (migration 013, no password column), passwords only from `headless.<name>.password` config keys or `AGENT_GATEWAY_HEADLESS_<NAME>_PASSWORD`; one runner per agent, reconciled on the revocation sweep. The agent password stays required (empty is a ConfigError), which closes 37's empty-password residual as by design. Manual run passed on Foundry 14.369 / pf2e 8.6.0. Residuals: the welcome `ownerUserId`/`headless` fields are covered by tests but not observable live; removing then re-adding the same identity within one sweep keeps the old runner until it re-pairs via a minted invite; `headless add` checks the flag/env agent only as the CLI invocation sees it (the app dedupes safely); server mode still logs "MCP stdio server started" (pre-existing). **96** has since merged (PR #154).
- **37: headless runner (merged, PR #151, d8a8b8e; archived in `docs/plan/done/`).** Manual run passed twice on Foundry 14.369 / pf2e 8.6.0. Follow-ups: (**38** closed the empty-password item: the password stays required by design); a follow-up task for `gateway.db` being created 0644 inside the 0700 state dir; the "playwright-core is not installed" once-only check matches by message prefix (`runner.ts:198` vs `browser.ts:130`), so a shared constant would tie them. **43 (docs)** must explain the `--no-sandbox` default (config key `headlessNoSandbox`) and how to re-enable the sandbox; that the headless Foundry URL needs a certificate Node and Chromium trust (public cert or loopback http); that headless is not supported in the `.mcpb` bundle (`playwright-core` is not bundled and the runner logs one fixed message); that the runner's page always reaches the link at `ws://localhost:<port>`, so a `--link-host` bound to one non-loopback address cuts it off; and the `docs/releasing.md` conformance line (from 40). Round 4 follow-ups: **96** (merged, PR #154, ce398b9; archived in `docs/plan/done/`) redacted input echoes in `normalizePublicUrl`, `normalizeLinkUrl` and the `--allow-origin` validation errors; **97** (merged, PR #152, 5160196; archived in `docs/plan/done/`) a relay capability flag so a newer gateway can tell that a pre-37 primary ignores the headless field. 43 (docs) merged (PR #155); see below.
- **40: MCP conformance for OAuth and the remote rows (merged, PR #150, fd701b5; archived in `docs/plan/done/`).** `scripts/conformance.sh` gains an OAuth mode (inspector 2.10.1: discovery, dynamic registration, consent, token, a call, static bearer refused). Pending Andrew: install `zip` on the host and re-run `npm run test:scripts` (9 fail and 6 cancelled on this host, the identical 20 test names that fail on main, all "zip is not installed"); run the manual checklists for claude.ai, ChatGPT, Gemini CLI and Gemini app in `docs/compatibility.md`, which are written and unticked. 43 corrected the `docs/releasing.md` conformance line to `stdio, http, oauth`.

- **43: six guides (claude-ai, chatgpt, gemini-cli, gemini-app, reverse-proxy, headless) plus security, privacy, README and releasing edits (merged, PR #155, 28f95e7; archived in `docs/plan/done/`).** Pending Andrew: run the unticked client checklists in `docs/compatibility.md` (the guides say the client steps were not run). Follow-ups:
  - **98: owner-routed OAuth consent for headless agents** is done on a branch (PR #160); see item 0b.
  - **35b owns the audit-trail docs** (Amendment 1); it is still deferred.
  - **Funding links:** none until the repo goes public (Amendment 1); add them as part of going public.
  - **Docs gap:** closed by 114 (see item 0f).
  - `docs/security.md` and `docs/releasing.md` fail prettier on main too; not touched by 43.

- **94: GM grants view (merged, PR #159; archived in `docs/plan/done/`).** "Authorized apps" tab in Manage access, gated on gateway 0.3.0 or later. **93 and 94 complete 0.3.0, which is ready to cut.** Follow-ups:
  - **Privacy docs:** a headless agent's owner may never see the "your GM can see your apps" notice, because it appears only in the grants-holder's own window. Say so in `docs/privacy.md`.
  - NOTE: the admin grant schema duplicates the player shape's bounds; change them together or share the constants.

- **93: GM management app (merged, PR #156; archived in `docs/plan/done/`).** "Manage access" for an admin GM: Invites and Pairings tabs, with a split version gate (Invites from gateway 0.2.0, Pairings from 0.3.0). **94 (the GM grants view) is merged (PR #159); 93 and 94 ship as 0.3.0.** Follow-ups:
  - Andrew's decision (2026-10-15): the headless agent's pairing (task 38) stays revocable from the Pairings tab, but its row must be labelled as the configured headless agent.
  - No test maps an OFFLINE request error to the whole-app state (`module/src/apps/manage/index.ts:152`).
  - A FORBIDDEN reply shows inside the tab rather than as the whole-app state.
  - Handlebars is not installed, so the template tests check structure, not rendering.
  - `listActivePairings` scans all worlds per message, and its 200-row slice is oldest-first.
  - No test covers the BUSY path.
  - Fixed out of loop: the macOS `runner.test.ts` failure on main (the log cap hid "symlink") was fixed in PR #157 (79600cc); `npm run verify` passes on macOS again.

- **95: HTTP session eviction (merged, PR #148; archived in `docs/plan/done/`).** Fixes the ChatGPT session exhaustion (503 "too many sessions" after about 5 calls on 0.1.1): at a cap, an `initialize` evicts the requester's own LRU idle session. **Gateway 0.2.0 (90 + 91 + 92 + 95; protocol 7.0.0, so the module and gateway must be upgraded together) is deployed on aindriub.app as of 2026-10-15.** Accepted residual: a session whose only open request is its GET SSE stream can be evicted by the same principal opening a 17th session. Caps since task 111: 16 sessions per principal, 32 per client key, 256 public total (were 4, 16, 64).

### 0b. 98 done on branch (PR #160)
- **98: owner-routed OAuth consent for headless agents (branch `claude/task-98`, archived in `docs/plan/done/`; PR #160).** For a stored headless agent with an owner (`headless add --owner`), the OAuth consent code goes to the owner's Foundry link connection, never to the agent's own headless browser. The owner's dialog names the agent, and the grant is bound to the agent's (world, user) and pairing. This resolves the earlier finding that the Compose stack (server mode with a public URL) could not reach a headless agent: it now can, through the owner. Andrew's decisions (2026-10-15): the single flag/env agent is not supported (treated as no owner); the consent page stays uniform, with the same status and body whoever is named and whether or not they are online, so it never reveals headless, owner or online status; the grant is bound to the agent; the docs come from a real run; a grant ends when the agent re-pairs but survives a gateway restart. Not run: the claude.ai, ChatGPT and Gemini connectors themselves (a scripted OAuth client was). Follow-up: gateway/test/relay/link-reconnect.test.ts "baseline: A is primary, B takes over..." failed once with "Connection closed" and passed on every rerun; it is not in this diff.

### 0c. 99 done on branch (PR pending): release script gates
- **99: release script conformance line and v13 gate environment (branch `task/99-release-script-gates`).** `scripts/release.mjs` accepts the `, oauth` conformance line and runs the v13 e2e gate against its own URL and state dir (env or `~/.config/agent-gateway/test.env`, state dir defaulting to `e2e-v13`), refusing a state dir equal to v14's. This unblocks cutting 0.3.0. Residual: `release.mjs:77-78` expands a literal `~/` in an inherited `AGENT_GATEWAY_E2E_STATE_DIR` but `e2e/lib/config.ts:45-47` does not, so a quoted `'~/x'` makes the printed v14 dir and the same-dir check differ from what the gate uses (rare; unquoted `~` is shell-expanded). Andrew still needs the one-time v13 setup in `docs/testing.md` on the release machine.

### 0d. 100 done on branch (PR #162): consent test pairing race
- **100: headless consent tests pair sequentially (branch `task/100-consent-test-pairing-race`, archived in `docs/plan/done/`).** Fixes the macOS `verify` hang that stopped the 0.3.0 release; with 99 (#161) it unblocks cutting 0.3.0. Follow-up: `invite-admin.test.ts:109` and `pairing-admin.test.ts:152` race `gm.next(X)` against `gm.untilClosed()`, which a close would now reject; neither reaches that path today.

### 0e. 101 done on branch (PR pending): conformance retry on the gateway 429
- **101: conformance inspector calls retry on the per-client 429 (branch `task/101-conformance-oauth-rate-retry`, archived in `docs/plan/done/`).** Fixes release gate 3 failing on the Mac. After merge, re-run the 0.3.0 release on the Mac: that run is the proof that a retry turns a 429 into a pass, which Linux cannot show. With 99 and 100 this completes the 0.3.0 unblockers.

### 0f. 0.3.0 playtest fixes (tasks 102-116); waves 1 and 2 done on branches, PRs pending
- **Tasks 102-116 come from the 0.3.0 playtest** (server mode behind Caddy, ChatGPT as the agent, 2026-10-16).
- **Wave 1 (102, 103, 105, 107, 108, 110; archived in `docs/plan/done/`), branch `claude/playtest-wave-1`.** Offline-queue text, unticked destructive/code scopes, pairing-window wording, vouch notices, and two diagnosis spikes. Details in `HISTORY.md` (see the index).
- **Wave 2 (113, 114, 115; archived in `docs/plan/done/`), branch `claude/playtest-wave-2`.** ChatGPT docs lead with the developer-mode connector (113, which also closes task 84), server-mode docs cover GM-vouched invites and `--admin/--gm/--demote` (114), and the hygiene test no longer fails on the conformance runner (115).
- **In progress:**
  - **111** (HTTP session caps, option B) is done on branch `claude/task-111` (PR #184); archived in `docs/plan/done/`. Caps are 16, 32, 256 (were 4, 16, 64).
  - **116** (headless restart re-invite flake) is done on branch `claude/task-116`; archived in `docs/plan/done/`. The cause was the test, not the product (see `HISTORY.md`).
- **109** (link keepalive: about 135 s of silence tolerated, any authenticated inbound frame counts as liveness, a retry after a drop rejoins its pending approval in the same tab) is done in PR claude/task-109; archived in `docs/plan/done/`. Not in the go-public freeze's open items any more.
- **112** (pending approvals survive logout and link drops; protocol 7.2.0, migration 014) is done in this PR (`claude/task-112`); archived in `docs/plan/done/`. **Pending Andrew:** the live Foundry v14 check (player requests, logs out, logs back in, GM approves, the call runs once). Merge order: after #188 (Mac 151) and the Mac's 150 PR, before 116. Follow-ups: `lang/` keys for the English-literal warning in `module/src/approvals/live.ts`; Prettier warnings on `gateway/docker/compose*.yaml`. **Held until the Mac's task 53 (image upload) merges:** 44.
- **0.4.0 release blockers:**
  - **117** (offline queue refuses `redactArgs` tools such as `image_upload`): merged (PR #186; archived in `docs/plan/done/`). Not a go-public blocker (agreed with the Mac session).
- **Awaiting Andrew's decisions:** 104 (consent page world and user entry without raw ids), 106 (not-paired indicator outside the pairing window).
- **Follow-ups from wave 2:**
  - Wire `e2e-unit` and the e2e `tsc` into `npm run verify`. They are not in it today, which hid the 115 failure on `main`.
  - Tick the ChatGPT checklist items "one read call" and "write held for approval" in `docs/compatibility.md` only after a deliberate live run.
  - The spec for 114 quoted the wrong player message ("No GM is online"); the orchestrator ruled in round 1 that the docs follow the code (`PAIRING_UNCONFIRMED`, `Pairing.Vouch.unconfirmed`).
  - `module/test/serialise/paging-oracle.test.ts` timed out once under full-suite load and passed 10/10 alone; treat as a load flake.
  - The 429 sign-in retest of 88 against the deployed gateway is Andrew's if not already done.
- **Follow-ups from wave 1:**
  - 388 `GET /mcp` requests returned 401 in the 2026-10-16 live sample (718 GETs in all); the cause is not known. Find out whether ChatGPT opens its SSE GET without a bearer token or with an expired one, and whether the 401 and `WWW-Authenticate` reply (`gateway/src/http/server.ts:330-334`) is right for that case.
  - Option C for the HTTP limits, more rps for authenticated clients (`PUBLIC_CLIENT_RPS` is 10), was declined for now; 111 took option B only. Revisit if 429s on non-DELETE requests persist after 111 is deployed.
  - A gateway acknowledgement of `attest`, so the vouch notice can say the pairing was actually confirmed (protocol and gateway change; 107's notice says "confirmation sent").
  - 108 suggested capturing `document.visibilityState` and a timestamp at each link drop (tab-visibility capture) to learn why the module stops answering pings.
  - 108 optional hardening: treat any inbound frame as liveness, since `missed` resets only on an app-level pong (`gateway/src/link/server.ts:449-451`).
  - Releases need written notes: the 0.3.0 GitHub release body is a placeholder.

### 2. Done on branch, PR pending: 87
- **87: link resilience and diagnostics (branch `claude/task-87`, done; PR pending; archived in `docs/plan/done/`).** Link drops are logged, recoverable without re-pairing, and visible in the Players list. Follow-ups:
  - `module/test/link/lifecycle.test.ts` does not exercise the `online`/`visibilitychange` wiring in `module/src/main.ts`; only `retryNow` is tested.
  - `gateway/src/mcp/status-tool.ts:60` renders "as ." when the user is missing.
  - There is no index on `pairings(world_id, user_id)`, which `pairingStateFor` queries on every status call.
  - The Players-list indicator (hook `renderPlayers`) and the toast still need a live Foundry check.

### 2a. 89, 90, 91 and 92 (merged)
- **89: per-user pairing credentials (branch `claude/task-89`, done; PR pending; archived in `docs/plan/done/`).** Credentials are keyed by (gateway URL, world, user) in browser-local storage, so a second user in the same browser no longer wipes the first user's pairing. Follow-ups:
  - An entry for an old gateway cannot be removed from the UI; "Unpair this browser" only acts on the current gateway.
  - Rename `hasOtherTokens` in `module/src/link/client.ts`; the name no longer says what it checks.
  - `gateway/test/invite-cli.test.ts` timed out under full-suite load; treat it as a flake and raise the timeout or lighten the test if it recurs.
  - `--invite` should print the address and code on separate labelled lines, and the docs should say to paste them into Foundry, not open them in a browser.
  - Show the GM a notice when a sign-in code is requested for an offline user.
  - Capture `helloOwner` before the `setToken` await in the code-welcome path (P3, unreachable in the real runtime).
  - No test guards the session-token `helloOwner` binding.
  - Accepted residual: a legacy credential owned by A is cleared if B logs in first and is rejected, so A re-pairs once.
- **90: GM-vouched pairing (branch `claude/task-90`, done; PR pending; archived in `docs/plan/done/`).** Protocol 7.0.0; player invites are completed by an admin GM's attestation, and `--gm`/`--admin` invites pair directly. Module and gateway must be upgraded together, and existing GMs need an admin invite (91) before players can pair. Follow-ups:
  - The `eventResume` 'unstored' guard is untested.
  - The `PAIRING_UNCONFIRMED` `clearCode` path is untested.
  - The close-release test's ordering (hello straight after the close) could flake under load.
  - Sweep-timer scheduling is duplicated at `gateway/src/link/server.ts:767-789` and `:808-818`.
  - Migration `012-admin-pairings.ts` took 012; task 38 shipped as 013 (Andrew, Amendment 4).
  - Accepted residuals: a mismatched hello burns a reserved invite; a co-GM can falsely vouch.
  - No test pins the caps interaction of the startVouch sweep (8 expired challenges, then a 9th hello must get a challenge). A tests-only round was blocked because the app's worktree-guard hook wrongly attributed this session to another project's worktree (`pf2e-module-setup-c82fb2`).
  - Optional: move `sweepPending()` above the `adminLive` early return in startVouch.
  - The app's worktree-guard hook misattributes sessions across concurrent projects; report it to the app.

- **91: operator admin flag (branch `claude/task-91`, done; PR pending; archived in `docs/plan/done/`).** `--invite … --admin`/`--gm` pair directly, `--demote` clears admin, and the list commands show admin and kind. **91 is merged; 0.2.0 = 90 + 91 + 92 + 95.** Follow-ups:
  - `backup.test.ts` also times out under load.
  - Task 92's create limit counts refused attempts.
  - Task 92's module-level `creates` limiter is shared across LinkServers.
  - Task 92's stale-connection test name overclaims.
  - Task 92: share the protocol's 200 max with `store.ts` `MAX_LISTED_ROWS` instead of repeating the literal.
  - The docs should say to pair the Foundry user first, then sign in the AI, and that the tab must stay open until task 37.
- **92: delegated invites (merged, PR #147, 324b548; archived in `docs/plan/done/`).** An admin GM creates, lists and cancels player invites over its link, with limits and a 30-day prune. **93 (the GM management app) is done on branch.** Accepted residual: an admin GM can list and cancel operator-minted invites in its own world, including gm and admin invites.
  - Round 2 follow-ups: no test guards the outer newest-first re-sort in `listForWorld`, the `expires_at > now` term in the open-first ordering, or the MAX(limit, open count) branch.

### 3. Invite redemption identity (90 closes it for player targets)
- **Player invites now need a GM vouch (90), so a leaked player code no longer pairs as the target.** Still open: `gm` and `admin` invites trust the code alone, and a co-GM can falsely vouch. Delegated invites (92, merged) and an operator web console remain undecided beyond the 91-94 plan.

### 4. 85 live run (Andrew)
- **85 is merged (PR #137); its task file stays in `docs/plan/tasks/` until Andrew's live run:** marketplace add, `/mcp` OAuth with a scope check (stop if read only), a read, an approved write, revoke, logout. Then archive the file and write the HISTORY entry.

### Andrew's open actions
- Commit the Caddyfile `dl` block in `/opt/aindriub-app` and gitignore `site/dl`.
- Revoke the Codex OAuth grant that holds all scopes.
- Approve the Ascend style values going public.

### Existing follow-ups (MVP A and later waves)
### MVP A: someone else can install it locally
Goal: module zip, `npx foundry-agent-gateway`, unsigned Claude Desktop `.mcpb`, stdio, GM tab open.

- **A1: 60, 61, 63 (all done; wave A1 complete, archived in `docs/plan/done/`).** 60: release zip packer, `download` URL, and no `relationships` in `module.json` (Andrew, 2026-10-13: a `systems` list hides the module from every other system). 61: the gateway builds as one esbuild bundle at `dist/bin/cli.js` with the private protocol inlined, packs to 4 files, and installs from a packed tarball (not published). 63: stdio conformance, core and fixture-pack schema checks, `docs/compatibility.md`; nothing runs `scripts/conformance.sh` automatically (needs `npm run build` first), so 64 wires `scripts/conformance.sh` and `scripts/test/*.mjs` into the release gates.
- **A2: 62 (done and merged, PR #102; manual Claude Desktop check confirmed by Andrew).** `node scripts/build-mcpb.mjs` builds an unsigned `dist/release/foundry-agent-gateway.mcpb` (about 261 KB) with the pinned `@anthropic-ai/mcpb` 2.1.2. The manual check passed end to end: a normal chat is connected to world "till-dawn" as GM and used for real character building. It also drove gateway fixes: extra instances stay up as degraded MCP servers (`gateway_status`, `LINK_UNAVAILABLE`), only the port holder prints the pairing code, and `foundry_url` feeds `--allow-origin`. Limits 65 must document: the pairing code is in `~/Library/Logs/Claude/main.log`, the Foundry URL must include the scheme, and Foundry tools work in one Claude Desktop session at a time. A Cowork chat always gets a degraded instance (the normal-chat instance holds the port first), so Cowork got no Foundry tools until 69 (A3); Andrew hit this in a real Cowork chat on his Mac.
- **A3: 69 (done and merged, PR #104, reviewed in four rounds; the optional normal plus Cowork `world_info` manual check is pending Andrew).** The primary serves MCP on a 0600 Unix socket (darwin) or named pipe (win32) in the 0700 state dir with a per-boot secret; secondaries relay stdio to it and each connection gets its own session, bound to the primary's `--user` and `--world`. Takeover on primary loss replays initialize plus `list_changed`; in-flight calls get `RELAY_LOST`. A secondary with a strictly newer config fingerprint makes the primary step down after a 2 s grace and takes over, so changed settings apply without a restart; the stepped-down primary's own chat loses its gateway. Live takeover verified on Andrew's Mac (about 1 s). Not verified: win32 (no DACL, no live run; ships macOS-verified) and the `sudo -u nobody` probe (skipped, single-user Mac). It also moved task 62's pairing notice to after the client's `initialized`. For 65: Claude Desktop starts the extension with defaults at install and does not restart the primary on a settings change. Task 70 (A4) removes the `foundry_url` and `role` settings, which will make fingerprint differences rare.
- **A4: 70 (done and merged, PR #106; manual Desktop check passed 2026-10-13: zero-settings bundle, paired from https://foundry.local, `world_info` in a normal chat returned Test World / pf2e 8.6.0 / v14 / Gamemaster (GAMEMASTER)).** Zero-config Claude Desktop setup, with no Foundry URL or Role settings. The pairing code approves a new browser origin, which is stored on the pairing, and reconnects are accepted only from that origin. Role comes from Foundry (it already does through `hello` isGM; `config.role` is dead code), and leftover role settings are ignored with a warning. Existing pairings must re-pair once and `npm run test:e2e:setup` must be re-run once (Andrew). Gate at `b9b254a`: 3,992 fast / 2,227 slow; adversarial security review found no code defects. Accepted limit: a page controlling several origins can fill the global 16 pre-hello slots; the log names the holders. Code guessing is limited to 10 failures per 60 s across origins (Andrew), with a Host header check against DNS rebinding and a cap of 16 pre-hello sockets. 18 now depends on 70.
- **A5: 71 (done on branch `claude/task-71`, archived in `docs/plan/done/`; manual Claude Desktop .mcpb check pending Andrew).** Sessions without `--user` follow the connected pairing (re-bind on a switch, 30 s grace); migration 008 retired NULL-origin pairings; one self-refreshing pairing code; the code appears in not-connected errors and `gateway_status`. 34 and 35b land after it.
- **A6: 34 (done on branch `claude/task-34`, archived in `docs/plan/done/`; manual Claude Code HTTP check pending Andrew).** Local Streamable HTTP on `127.0.0.1:7421`, loopback only, bearer token, size and rate limits, status page, for clients that prefer HTTP (Claude Code). It adds the local HTTP mode to `scripts/conformance.sh` and the Claude Code / Local HTTP cell of `docs/compatibility.md`; 40 keeps only OAuth and the remote rows. Only the primary serves HTTP. The token hash is in the store (migration 009); `--http-rotate-token` rotates it without a restart; a takeover whose listen fails retries in the background. Known gaps: `gateway_status` and the relay handshake do not show HTTP state.
- **A7: 64 (done on branch `claude/task-64`, archived in `docs/plan/done/`; tester PASS, reviewer APPROVED after two rounds).** The local release script, `bump-version` and `docs/releasing.md`: version bump that also updates `module.json` `download`, gates (including `scripts/conformance.sh` and `scripts/test/*.mjs`), three artefacts, stops before anything irreversible; draft notes carry the "macOS verified; Windows untested in this release" line. Known gaps: `--check` skips non-exact internal pins, and piped `yes` counts as consent.
- **A7b: 65 (done on branch `claude/task-65`, archived in `docs/plan/done/`; manual quick-start check pending Andrew).** README quick start, Desktop and Code guides, security model, privacy statement.
- **A7c: 72 (done on branch `claude/task-72`, archived in `docs/plan/done/`; tester PASS, reviewer APPROVED after five rounds; PR pending).** A stepped-down gateway stays alive as a standby and takes over again, using a handover claim, so a separate `--http` gateway alongside Claude Desktop's no longer strands Desktop. Pending Andrew: the live e2e `takeover` scenario and the manual 71 world-switch and Desktop take-back checks. The guides can now describe the mixed setup.
- **A7d: 73 (done on branch `claude/task-73`, archived in `docs/plan/done/`; live e2e on v14 passed 35/0/23 skipped, Andrew 2026-10-14).** Fixes the e2e ambiguity and takeover suites for the 0.1.0 gate (the suite was stale against 71; the product was correct). The 0.1.0 gate run sets `AGENT_GATEWAY_E2E_PF2E=1`. Follow-up chip: the pre-existing e2e-unit hygiene failure on `scripts/conformance.sh`.
- **A8: 66 (done, archived in `docs/plan/done/`; 0.1.0 is a PRIVATE DRAFT, deliberately unpublished until MVP B is done, Andrew 2026-10-14).** First real run of the release script on `main` at 975670b: all gates passed (v13 e2e skipped, `--allow-missing-v13`), three artefacts built, draft created, npm dry run only, repo private; the clean-clone from-source check passed. Pending Andrew: the manual Foundry and Claude Desktop install checks, then a follow-up PR ticking the Desktop and Claude Code rows of `docs/compatibility.md`. Follow-up chips raised: bound the `e2e/pf2e` `beforeAll` approval wait, and a `--confirm-draft` flag for the release script.
- **A9: 77 (done on branch `claude/task-77`, archived in `docs/plan/done/`; PR pending).** `.github/workflows/ci.yml` tests on `v*` tags (and, since 81, on demand only) and pushes a multi-arch image to private `ghcr.io/aindriub/foundry-agent-gateway` on version tags. Pending Andrew: the rc-tag check (scratch commit with `npm run bump-version -- 0.1.0-rc.1`, tag `v0.1.0-rc.1`, push only the tag). Actions runs on this private repo; the first green CI run was 2026-10-14 (PR #128).
- **A9b: 78 (done on branch `claude/task-78`, archived in `docs/plan/done/`; PR #130 pending).** Both Compose files pull `ghcr.io/aindriub/foundry-agent-gateway:${GATEWAY_VERSION}` by default and keep `build:` for `--build`; `bump-version` owns `GATEWAY_VERSION` in `.env.example` (`--check` counts 15 places). Pulls fail until v0.1.0 is published, so use `--build` until then.
- **A10: 80 (done and merged, PR #129; archived in `docs/plan/done/`).** `npm run verify` now also runs `npm run test:scripts`, and CI's separate script-test step is gone. `scripts/release.mjs:77-78` still runs them again after verify; left for Andrew.
- **A11: 81 (done on branch `claude/task-81`, archived in `docs/plan/done/`; PR pending).** CI now runs only on `v*` tags and on manual "Run workflow"; PR and `main` runs are gone, and the image job also requires a push event, so a manual run never publishes. Retry a failed publish with "Re-run jobs" on the tag run.
- **A12: 79 (done on branch `claude/task-79`, archived in `docs/plan/done/`; PR pending).** The step-down load flake was the test, not the relay: it counted the bare `holds link port`, which the standby warning also prints, and chose `primary` from a snapshot. It now counts the primary banner and waits on observable state; 20/20 under CPU load.
- **A13: 88 (done and merged, PR #138; archived in `docs/plan/done/`).** Credential-free `/mcp` requests get the OAuth discovery 401 without counting as failed auth, behind a separate 120 per 60 s per-client discovery throttle; any offered `Authorization` header keeps the old lockout. Pending: the deploy of 0.1.0 to gw.aindriub.app and the ChatGPT/Codex sign-in retry (see item 1).
- **Follow-up (88): `invite-cli.test.ts` env leak.** `gateway/test/invite-cli.test.ts` reads `AGENT_GATEWAY_PUBLIC_URL` from the ambient environment, so a developer shell that sets it can change results. Isolate it in the test.
- **Follow-up (88): optional readability refactor.** The nested check at `gateway/src/http/server.ts:306-312` could be flattened into named branches (offered, locked out, discovery). Behaviour must not change.
- **Follow-up: CI flake.** `gateway/test/events/repository.test.ts:38` "retains exactly10000 oldest-first…" took 19s on ubuntu-latest against a 15s vitest timeout and failed the v0.1.0-rc.1 tag run (run 38587528849). Since 81 it can only affect tag runs and manual runs, but a failure there still blocks a publish. The rc.1 run was re-run and went green. If it recurs, raise the timeout or shrink the test.

## Next

### MVP B: VPS / hosted (next phase; MVP A is complete)
Re-planned 2026-10-14 for the shortest path to a friend test on a public VPS. Task files are in `docs/plan/tasks/`; threats and their handling are in `docs/plan/mvp-b-threats.md`; the full wave, overlap and migration analysis was done in that re-plan.

**Decisions (Andrew, 2026-10-14):**
- Docker Compose on a VPS is the primary deployment.
- TLS terminates at a reverse proxy (Caddy); the gateway does no TLS itself.
- With `--public-url`, the static bearer token is off (OAuth only), pairing codes appear only in operator logs, and `/status` shows only version and uptime.
- WITHDRAWN: the earlier approval to accept and log the first GM pairing of a world. It rested on the hello `isGM` flag, which a code holder can forge (threat T1). GM-attested self-onboarding is deferred to a future task, not in MVP B.
- Public-mode pairing uses operator invites (Model I, Andrew 2026-10-14, after an architect threat review): the operator mints a single-use invite for an exact world and user with `--invite <world> <user>`, and a code holder pairs only as that target. The threat map is `docs/plan/mvp-b-threats.md`.
- The consent page does not list users (67).
- SQLite stays the store, with WAL and a `--backup` CLI (74).
- Identity comes from the invite, never the hello `isGM` flag; headless runners mint their own in-memory invites with an exact world/user/origin match (68 i, 37 c).
- Migrations are positional: 010 is 35's (it also holds 67's grants), 011 is 68's (the `invites` table), 012 is the admin pairings', 013 is 38's (`headless_agents`). A task that finds it needs another migration stops and reports so the plan can renumber.

**Order:**
1. **Wave 1: 74 (done on branch `claude/task-74`, archived in `docs/plan/done/`; PR awaiting Andrew).** Remote-exposure foundation: public URL, server mode, host allowlists, per-client limits, session-selector seam, WAL and `--backup`. 35 must add a failure count and rate limit to public `/status` when OAuth authenticates it, and every OAuth principal must carry a selector (74 fails closed without one).
2. **Wave 2: 35 and 42, in parallel (disjoint Owns). Complete once 35 merges.** 35 (done on branch `claude/task-35`, archived in `docs/plan/done/`; PR pending) is the OAuth 2.1 authorization server (migration 010); consent is auto-deny until 67. 42 (done and merged, PR #122; archived in `docs/plan/done/`) is the server-mode Docker image and Compose stack with Caddy. Pending Andrew: the manual check of 42 on a real VPS. Follow-ups from 42: the gateway/docker/README.md revoke/cancel/list bullets still say "(after task 68)"; 68 now exists, so drop that qualifier and check the commands against `--help` (43 or 75, whichever touches that README first; 68 could not, it is outside docs/), `GATEWAY_VERSION` is undocumented, and a Caddy healthcheck would expose a stranded network namespace. Notes for 68 from 35: `revokePairing` runs listeners in sequence with no isolation (a throwing oauth listener skips the events and queue revocations), and the oauth SAVEPOINT outside a transaction starts a deferred one, so a concurrent writer can see SQLITE_BUSY_SNAPSHOT without the busy_timeout wait, and `ROLLBACK TO` can mask the original error. Optional: strengthen the listener-ordering test in `gateway/test/oauth/atomicity.test.ts:91-126`, which passes with the SAVEPOINT fix reverted.
3. **Wave 3: 67 (done on branch `task/67-oauth-consent-and-grants`, archived in `docs/plan/done/`; PR pending), then 68 (done on branch `claude/task-68`, archived in `docs/plan/done/`; PR pending), then 75 (done on branch `claude/task-75`, archived in `docs/plan/done/`; PR #127 pending), alongside 76 (done and merged, PR #126). Wave 3 is complete once 75 merges.** 67 is the consent page and grant revocation: the human names the world and the Foundry user and picks scopes, and proves control with a code shown in that user's Foundry client; "Connected apps" in the module lists and revokes grants; a retention sweep prunes OAuth rows; styling is served at `/authorize/consent.css`. Pending Andrew: the MCP Inspector flow against foundry.local, and light and dark screenshots in the PR. Residuals are in `docs/plan/done/67-oauth-consent-and-grants.md`. 68 is operator invites for server mode (migration 011): `--invite <world> <user>`, `--revoke-pairing`, `--cancel-invite`, `--list-invites`, `--list-pairings`, replacement that revokes the old pairing, token and grants in one transaction, a 5 s sweep that closes revoked live connections, a 20-per-minute refusal-log cap, and "Copy my ids" in the module. It is the impersonation defence. Pending Andrew: the manual foundry.local v14 server-mode check through 42's Compose stack. Residuals and reviewer notes are in `docs/plan/done/68-server-mode-pairing-confirmation.md`. 75 adds a privacy, cookie and source footer to the consent pages: `--privacy-url` and `--source-url` (https, or loopback http), a note naming the `__Host-agcsrf-` cookie, and a "Source code" link carrying the GitHub mark only (82 removed the Ascend mark; it began as GitHub and Ascend) when `--source-url` is set. It deliberately relaxes 67's bans on external hrefs and `<svg>` for the footer only; 82 restored the ban on "ascend". The CSP is unchanged. 82 (done on branch `claude/task-82`, archived in `docs/plan/done/`; PR pending) removed the Ascend mark from `marks.ts`, `render.ts` and the tests, and the mark remains only in 75's git history, which Andrew chose to leave as it is (2026-10-14). Residuals are in `docs/plan/done/82-remove-ascend-mark.md`. Pending Andrew: light and dark screenshots (both URLs set, and neither) attached to the PR. Residuals are in `docs/plan/done/75-consent-page-footer.md`. 76 (merged, PR #126; archived in `docs/plan/done/`) is the gateway-only Compose file `gateway/docker/compose.byo-caddy.yaml`, a site block and a README section for operators who already run Caddy, on the host (`network_mode: host`) or in a container (`container:<caddy>`); a shared Docker network is unsupported. Residuals are in `docs/plan/done/76-byo-caddy.md`. Pending Andrew: deploy it on his VPS behind his existing Caddy.
4. **Milestone: friend test on a public VPS (Compose and Caddy).** It is ready now (74, 35, 67, 68, 42 and 76 are all in; 75, the consent footer, is optional for the test). Andrew deploys 42's stack, or 76's gateway-only file behind his existing Caddy, with them. The operator invites the GM and each friend with `--invite`, they pair, and one friend connects claude.ai or ChatGPT through OAuth and consent, makes a read call and a write held for approval, then revokes the grant. Feedback is filed as tasks before wave 4 starts.
5. **Wave 4, after the milestone: complete.** 37 with 40 in parallel, then 38, then 43; all merged (#151, #150, #153, #155).
   - **37** (merged, PR #151) Headless runner with gateway-minted invites (`playwright-core`, logs in as an agent user, follows world lifecycle).
   - **40** (merged, PR #150) MCP conformance for OAuth and the remote client rows. Stdio and local HTTP are done by 63 and 34.
   - **38** (merged, PR #153) Stored headless agents, `headless add|list|remove`, owner attribution (migration 013).
   - **43** (merged, PR #155; archived in `docs/plan/done/`) Remote, server-mode and headless docs.

### ChatGPT plugin: 84 (merged, PR #136; closed 2026-10-16, archived in `docs/plan/done/`)
- **84 — Private ChatGPT plugin package for the existing gateway.** Adds a portable MCP package, a focused Foundry workflow skill, a standalone packer and package-specific verification notes. Andrew confirms the supporting tasks are delivered and the deployment is live at `https://foundry.aindriub.app` and `https://gw.aindriub.app` (2026-10-14); public OAuth metadata verifies `https://gw.aindriub.app/mcp`. No open task dependencies or deployment work. Package ownership is disjoint from 40 (conformance/matrix) and 43 (general guides). Live ChatGPT OAuth/read/approved-write/revocation acceptance still needs Andrew's account and participation; the metadata check is not a client compatibility claim.

### Self-hosted module manifest: 83 (done on branch `claude/task-83`, archived in `docs/plan/done/`; PR pending)
- **83 — `pack-module --base-url`.** Lets the module be installed from a manifest URL while the repo is private; deployed at `https://dl.aindriub.app/agent-gateway/module.json`. Pending Andrew: the manual Foundry v14 install, and committing the Caddy change in `/opt/aindriub-app`. Residuals are in `docs/plan/done/83-static-module-manifest.md`.

### Claude Code plugin: 85 (merged, PR #137; live run pending; task file stays in `docs/plan/tasks/`)
- **85 — Private Claude Code plugin for the hosted gateway.** Repo marketplace `agent-gateway` and a hosted one (`aindriub-dl`) built by `scripts/build-claude-plugin.mjs --base-url`, live at `https://dl.aindriub.app/claude/marketplace.json` since 2026-10-14. Reviewed in three clean rounds, tester PASS, reviewer APPROVE. Pending Andrew: marketplace add, install, `/mcp` OAuth (check which scopes are requested; stop if read only), list tools, one read, one approved write, revoke, logout. Move the task file to `done/` and write the HISTORY entry after that run. Guide: `docs/claude-plugin.md`.

### Server-mode onboarding: 86 (merged, PR #139; archived in `docs/plan/done/`); 87 is done on branch (see Now)
- **86 — One-paste invite, world default gateway URL, server-mode wording.** Reviewed in three rounds plus Amendment 1. Pending Andrew: the manual check against a live hosted gateway.
- **Follow-ups from 86:**
  - The "inherited" note in the pairing window is hidden while the state is connecting or unreachable; show it there too.
  - When `AGENT_GATEWAY_PUBLIC_URL` is set to an invalid value, the error still says "Invalid --public-url" (from `normalizePublicUrl`, `gateway/src/bin/cli.ts:271`); it should name the env var when that was the source.
  - `Pairing.Address.connecting` uses `...` where the rest of `lang/en.json` uses `…`; make it consistent.
  - `module/src/settings/gateway-url-guard.ts:94` reads `self.isActiveGM` in a way that is hard to follow (readability nit only).

### Later (after MVP B)

- **Ease of installation:** native installers (Windows .exe, macOS .pkg, and a Linux script with Node bundled). No task yet.
- **Go public:** publish the 0.1.0 draft (rebuild if `main` has moved), make the repo public, real `npm publish`, Foundry package listing, Ask Foundry answers in `docs/releasing.md`, and the manifest-URL install check. Prerequisites: a per-connection frame budget for toolset and event link frames (threat T17, pre-existing at `gateway/src/link/server.ts:275-345`; not yet filed as a task); capability negotiation in `welcome`, so the module can detect a pre-67 gateway (the version gate cannot); Andrew OKs the Ascend style values in the consent CSS being public. The earlier prerequisite on the all-rights-reserved Ascend mark is resolved: 82 removed it from `gateway/src`, and Andrew left it in task 75's git history (2026-10-14). The Ascend style values in the consent CSS still need his OK. The 0.1.0 after-action report (`/aar 0.1.0`, presented in chat, never committed) is due once the release is actually published. Task not yet created; MVP B must be done first (Andrew, 2026-10-14).

Not planned now: a tunnel or `share` mode, port-forwarding, and TLS in the gateway itself.

### Deferred beyond B
- **36** remainder: needs 18, 67, 68 and 35b. The consent page moved to 67 and pairing confirmation to 68. It must use the 10b recommendation (`docs/spikes/foundry-socket-identity.md`), with identity only from server-set args.
  - **Check, 2026-10-14: 36 is largely superseded by 67 and 68.** 67 delivered the consent page (with the one-time code shown in the user's Foundry client), the "Connected apps" grant list and self-service revocation; 68 delivered server-mode pairing control through operator invites (the invite names the exact world and user, replacing the confirm-in-client design), plus `--server-mode` itself came with 74. Likely remaining: the rule that a pairing or different-token connection from another browser never silently replaces an existing one (held pending until the user confirms), and the 10b proof of identity at first pairing, which the invite review in Now item 3 may cover. Recommendation for Andrew: re-scope 36 to that remainder after the architect review, or retire it if the review closes it. Not retired here.
- **35b** Metadata-only hash-chained gateway audit trail.
- **39** Quench in-world integration tests. Not a prerequisite for A or B.
- **41** Superseded by 64 for MVP A; remote gates return with 39.
- **18** Architecture-blocked; depends on 70 (origin-bound pairing and Foundry-sourced role). Immediate gateway token invalidation for another owner, including while that owner is offline, lacks trusted cross-owner attestation. Preserve that acceptance requirement; hello role hints cannot authorize it. Design a trusted gateway-controlled observer prerequisite before implementing 18; this introduces a production browser/credential/configuration surface and needs a deliberate future contract. Do not add an 18 to 36 dependency cycle or silently substitute pending revocation.
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
- Task 63: stdio MCP conformance script, tool schema checks, compatibility matrix.
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
- Task 79 fixed its own count in `stepdown.test.ts` (the primary banner only) and found that `takeover.test.ts:138,140`, `link-reconnect.test.ts:76` and the other waits in `stepdown.test.ts:89,107,121,149` count the bare string `holds link port`, which also appears in the standby warning. Most are vacuous rather than wrong, because later gates catch them. Check them for over-counting.
- `scripts/test/ci-workflow.test.mjs:30`: `.match(...)[1]` has no `assert.ok`, so a non-matching regex throws a TypeError instead of failing clearly.
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


### Follow-ups from task 89
- The `input.value` assertion at `pairing-one-per-user.test.ts:132` and `:148` can never fail; make it assert something that can.
- Clean up the dead third clause in the `start()` gate (`client.ts:357-361`), the `ownTokenForUrl` wrapper, and the `authSource` field comment at `:243`.
- No test checks that the code-welcome `setToken` uses `helloOwner`.
- `authSource` is set before the socket-origin check at `client.ts:546`. This is harmless while `setToken` is synchronous.
- A failed re-pair store with an older persisted entry ends in TOKEN_REJECTED, not PAIRING_REQUIRED.
