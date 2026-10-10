# 12a — Add the e2e harness, one-time pairing setup, fixtures and single-user read flows

**Repo:** .
**Depends on:** 09, 10, 11
**Owns:**
- e2e/lib/**
- e2e/setup/**
- e2e/fixtures/**
- e2e/read/**
- e2e/tsconfig.json
- e2e/vitest.e2e.config.ts
- e2e/run.ts
- scripts/e2e.sh
- docs/testing.md
- package.json (root `scripts` insertions `test:e2e`, `test:e2e:setup`, `test:e2e:seed`, `test:e2e:clean`; root `devDependencies` insertions `playwright-core`, `@modelcontextprotocol/sdk`, and `tsx` only if needed; nothing else)
- package-lock.json

## Goal
Make the live proof of the read tools repeatable without anyone at the keyboard. A human pairs
each test user once, using `test:e2e:setup`. After that, `test:e2e` reconnects with the stored
tokens, checks that the seeded `ag-test-*` fixtures exist, and runs the GM and player read flows
through a real MCP client. It asserts what the live 11/11b runs on foundry.local v14.369 observed.
This is the evidence later PRs cite. Multi-user isolation, binding and resilience are 12b, which
builds on this harness.

## Context
- docs/plan/HISTORY.md (on `origin/record/wave-4` until PR #28 merges), entry "Gateway wiring, session binding and isolation (tasks 11, 11b)": the live fixture set, the observed results and why the Mac needs a human (auto mode gates logins and writes)
- HISTORY entries for tasks 09 and 10: "not found" instead of FORBIDDEN, chat secret rules, LIMITED packs hidden
- docs/plan/PLAN.md "Testing topology and prerequisites": the Mac test bed and `~/.config/agent-gateway/test.env`
- gateway/src/bin/cli.ts:12-23: `--link-port`, `--world`, `--user`, `--allow-origin`, `--db`
- gateway/src/app.ts:76-82: the pairing code line on stderr (one single-use code per process start) and `Link URL:`
- gateway/src/mcp/session.ts:39 (WORLD_OFFLINE text) and :95-104 (ambiguity error); module/src/tools/document-get.ts:127 (`Document "<uuid>" not found`)
- module/src/settings/index.ts:8-11 and :37: `gatewayUrl` is client scope; the credential is bound to the URL that issued it (HISTORY task 07, attempt 11)
- gateway/src/store/store.ts: `node:sqlite` store with `listActivePairings()` (worldId, userId, userName); the harness may open it read-only for its pre-check
- protocol/src/tools/*.ts: `minRole` on each tool definition
- docs/conventions.md#ports: 7420 is the dev link port; the e2e harness must not use it
- docs/plan/specs/2026-10-09-agent-gateway.md:89-90 and :203-206: e2e against v13 and v14; the v13 instance is a homelab prerequisite
- Design constraint: one gateway process is one stdio MCP session plus one link server (app.ts). Concurrent sessions are not possible until 34, so any run that needs a different `--user` restarts the gateway on the same port and DB

## Acceptance
Configuration and safety
- [ ] Settings come from the environment, falling back to `~/.config/agent-gateway/test.env`: `FOUNDRY_URL` (default `https://foundry.local`), `FOUNDRY_WORLD` (default `test-world`), `FOUNDRY_GM_USER` (default `dev-gm`), `FOUNDRY_PLAYER_USER` (default `player1`), `FOUNDRY_PLAYER2_USER` (default `player2`), optional `FOUNDRY_PASSWORD`, `AGENT_GATEWAY_E2E_LINK_PORT` (default `7429`) and `AGENT_GATEWAY_E2E_V13_URL`. `git grep` over the diff shows no password, token or pairing code
- [ ] All persistent state lives under `~/.config/agent-gateway/e2e/`: `profiles/<user>/` (one persistent Chromium profile per user) and `gateway.db`. Directories are created mode 0700 and the DB file is mode 0600, both checked by `stat` in a harness unit test or in the run's preflight. Nothing is written inside the repo
- [ ] Every gateway spawned by the harness uses `node gateway/dist/bin/cli.js --link-port <e2e port> --db ~/.config/agent-gateway/e2e/gateway.db --allow-origin <FOUNDRY_URL origin> --world <world> --user <id>` and is spawned through `StdioClientTransport` from `@modelcontextprotocol/sdk`. MCP Inspector is not used. Processes are stopped only by their own recorded PID (no `pkill`, `killall` or process-name matching, checked by `rg` over e2e/ and scripts/)
- [ ] The browser is `playwright-core` with a system Chrome or Chromium (channel or `CHROME_PATH`). Only one browser per user is open at a time and suites run sequentially (vitest `fileParallelism: false`, a single worker)
- [ ] Logins select the user on `/join` (`select[name="userId"]`, then `button[name="join"]`) and fill the password field only when `FOUNDRY_PASSWORD` is set

One-time setup (`npm run test:e2e:setup`)
- [ ] For each configured user in turn, setup starts the gateway, reads the pairing code from its stderr, opens a **headed** persistent-profile window whose title and an injected on-page banner both show the user name and the code, joins the world, sets the client `gatewayUrl` setting to `ws://localhost:<e2e port>`, opens the pairing app, and waits (default 5 minutes, configurable) for a human to type the code. It never types the code itself
- [ ] Setup confirms each pairing with a successful `world_info` for that user through the MCP client, prints `paired <user>` per user, and exits 0 when all configured users are paired. A user whose code is not entered in time fails with a named message and a non-zero exit

Unattended runs (`npm run test:e2e`)
- [ ] Preflight fails within 5 s with exit code 1 and a message containing `run npm run test:e2e:setup` when the profile directory or the DB is missing, or when the DB has no active pairing for a required user
- [ ] When pairings exist but the module does not connect (a stale or rejected token), the run fails within 45 s with the same message. No run waits for input or hangs
- [ ] Preflight also checks that the fixtures exist: as the GM, `document_search` must find `ag-test-public`. If it does not, the run fails with `run npm run test:e2e:seed`
- [ ] `npm run test:e2e -- --foundry v14` (the default) targets `FOUNDRY_URL`. `--foundry v13` targets `AGENT_GATEWAY_E2E_V13_URL`, and when that is unset it exits 0 after printing `SKIP: v13 instance not configured (set AGENT_GATEWAY_E2E_V13_URL)`
- [ ] `npm test` and `npm run verify` are unchanged and do not run e2e (e2e has its own vitest config, which the root `vitest.config.ts` projects do not list). `npx tsc -p e2e/tsconfig.json --noEmit` and `npx eslint e2e scripts` pass

Fixtures (`npm run test:e2e:seed`, `npm run test:e2e:clean`, run as the GM in the browser)
- [ ] The seed creates exactly this set. Every document is named `ag-test-*` and has `flags['agent-gateway'].fixture === true`:
  - Folder `ag-test-hidden-folder` holding only JournalEntry `ag-test-hidden` (default NONE)
  - JournalEntry `ag-test-public` (default OBSERVER) with three pages: `public` (HTML containing `<section class="secret">ag-test SECRET text</section>`), `gm` (page default NONE) and `markdown` (a markdown page with a secret in its markdown)
  - JournalEntry `ag-test-limited` (default LIMITED)
  - on the active scene: a hidden token, a visible token, a hidden drawing, two notes (one public, one hidden) and a secret-door wall. The seed fails with a clear message if there is no active scene
  - ChatMessages: a public message; a GM whisper to GMs only; a player1 whisper to the GM; a player1 blind roll of `7d6`; the GM speaking as an NPC, with a secret section; player1 speaking as their own character (owner of `Actor.6i6mZ5g8vX8iU9RD`), with a secret section
- [ ] Running the seed twice leaves exactly one of each fixture: the per-type counts printed after each run are equal
- [ ] The clean script deletes only flagged documents and placeables. It prints per-type counts of flagged documents before and after (0 after) and of unflagged documents (unchanged)
- [ ] `e2e/fixtures/manifest.ts` exports the list of hidden strings (hidden names, secret texts, the GM page text, the GM whisper text, `7d6` and the blind roll total once known) used by the leak check
- [ ] docs/testing.md states that seeding writes to the world and needs the world owner's (Andrew's) consent once, and that `test:e2e:clean` restores the world

Read flows, encoded as assertions (each in e2e/read/)
- [ ] Player (`--user player1`): `document_search` for JournalEntry returns `ag-test-public` and no other `ag-test-*` entry. `document_get` on `ag-test-hidden`, on `ag-test-limited` and on the active Scene each returns an error whose text starts `INVALID_ARGS` and contains `not found` (never `FORBIDDEN`). `ag-test-public` has the `public` and `markdown` pages only, the secret is stripped, there is no `text.markdown` field, and `ownership` equals `{ yours: 2 }`
- [ ] Player: no scene placeable (token, drawing, note or wall) appears in any result
- [ ] Player chat (`chat_read`): includes the public message, the NPC message without its secret, player1's own whisper and the own-character message with its secret. It excludes the GM whisper and the blind roll; no result contains `7d6` or the roll total
- [ ] Player compendium: `pf2e.abomination-vaults-bestiary` (LIMITED) is absent from `compendium_search` and `compendium_get` on it returns not found. `pf2e.actionspf2e` and `pf2e.journals` return results, and requesting the second page returns entries disjoint from the first
- [ ] Leak check: the serialised JSON of every player result in the run is scanned for every manifest hidden string. The run fails naming the tool, the arguments and the string on any hit, and the summary reports `leak check: <n> results x <m> strings, 0 hits`
- [ ] GM (`--user dev-gm`): the same calls return every fixture, including the hidden and limited entries, the `gm` page, the secrets, the placeables, the GM whisper and the blind roll
- [ ] `tools/list`: the player's tool names are a subset of the GM's, and they include no tool whose definition has `minRole: 'gm'`. Both counts go in the summary; no count is hardcoded
- [ ] `world_info` for each role reports world `test-world`, system `pf2e`, and its own user name and role

Evidence
- [ ] Each run writes `~/.config/agent-gateway/e2e/e2e-summary.json` holding the Foundry URL and version, per-suite pass, fail and skip counts, tool counts per role and the leak-check summary, and prints a short version of it at the end
- [ ] docs/testing.md covers prerequisites (module linked and enabled, test users, test.env), the commands (setup, seed, run, clean), the state directory, the v13 gap, and the Mac permission rules: which commands need Andrew's approval or allow rules in auto mode (setup with its headed browsers, seed and clean world writes, gateway spawns) and which run unattended
- [ ] The PR description includes the passing v14 run output: the summary, the tool counts and the leak-check line

## Out of scope
- Multi-user isolation, the no-`--user` ambiguity check, tab reload and gateway restart resilience (12b, which owns `e2e/multi/**`)
- Any change under `module/`, `gateway/`, `protocol/` or root `vitest.config.ts`. If a harness need seems to require one, stop and report
- Quench in-world tests (39); MCP conformance (40); release automation (41)
- Creating Foundry users, relaunching worlds or the v13 instance (homelab, Andrew)
- `@playwright/test` and a root `playwright.config.ts`: the harness drives `playwright-core` from vitest
