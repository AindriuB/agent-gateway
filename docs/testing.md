# End-to-end testing

The e2e suite drives a real Foundry (browser, module, gateway, MCP client). It is separate from `npm test` and `npm run verify`, which never run it. It needs a machine with Chrome or Chromium and access to the Foundry instance (the Mac test bed).

## Prerequisites

- Foundry v14 at `FOUNDRY_URL` with world `test-world` (game system `pf2e`) launched, the Agent Gateway module linked and enabled, and an active scene.
- Foundry users that exist already: GM `dev-gm`, players `player1` and `player2`. `player1` owns `Actor.6i6mZ5g8vX8iU9RD`.
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

## The v13 gap

`npm run test:e2e -- --foundry v13` targets `AGENT_GATEWAY_E2E_V13_URL`. Without it the run prints `SKIP: v13 instance not configured (set AGENT_GATEWAY_E2E_V13_URL)` and exits 0. The v13 instance is a homelab prerequisite; until it exists the v13 evidence for tools 09, 10 and 11 is pending.

## Permission rules on the Mac (auto mode)

Automated logins and world writes are gated in auto mode. Approve or allow-list by command:

- Needs Andrew's approval each time (human in the loop): `npm run test:e2e:setup` (headed browsers, a human types the code), `npm run test:e2e:seed` and `npm run test:e2e:clean` (writes to the world).
- Allow rule once the above has been done: `npm run test:e2e` and `npm run test:e2e -- --foundry v13`. It logs in with stored profiles, spawns `node gateway/dist/bin/cli.js` as a child, launches Chrome with a profile under `~/.config/agent-gateway/e2e/`, and makes read-only tool calls. It writes nothing to the world.
- Also needed: read and write under `~/.config/agent-gateway/e2e/`, read of `~/.config/agent-gateway/test.env`, a listener on `127.0.0.1:7429`, and outbound access to `FOUNDRY_URL`.
- Run unattended: `npx vitest run --config e2e/vitest.e2e.config.ts --project e2e-unit`, `npx tsc -p e2e/tsconfig.json --noEmit`, `npx eslint e2e`.

Processes are stopped only by their own recorded PID; the harness never matches processes by name.
