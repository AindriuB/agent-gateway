# 12 — Add the Playwright end-to-end harness for read tools on v14 and v13

**Repo:** .
**Depends on:** 09, 10, 11
**Owns:**
- e2e/**
- playwright.config.ts
- scripts/e2e.sh
- docs/testing.md
- package.json (devDependency and `test:e2e` script insertions only)
- package-lock.json

## Goal
Automate the foundations proof: a browser logs into a homelab Foundry world as a
test user with the module enabled, pairs with a locally started gateway, and an
MCP client exercises all six read tools. The same suite runs against v14 now and
v13 once the homelab instance exists. This is the evidence later PRs cite.

## Context
- docs/plan/specs/2026-10-09-agent-gateway.md:89-91 — Playwright end-to-end against homelab Foundry v13 and v14
- docs/plan/specs/2026-10-09-agent-gateway.md:203-207 — v13 instance and test users are homelab prerequisites
- /home/andrew/homelab/FOUNDRY.md — the v14 instance at https://foundry.local
- docs/dev.md — local loop (01)
- docs/plan/PLAN.md "Testing topology and prerequisites" — `~/.config/agent-gateway/test.env`, log in once and reuse Playwright `storageState`
- docs/plan/tasks/11-wire-end-to-end.md — session binding with `--world` / `--user`; isolation guarantees this suite proves live
- Prerequisite (Andrew): a second test user with the Player role in `test-world`, credentials as `FOUNDRY_PLAYER_USER` / `FOUNDRY_PLAYER_PASSWORD` in `test.env`

## Acceptance
- [ ] `npm run test:e2e -- --foundry v14` targets https://foundry.local, world `test-world`; `--foundry v13` targets a URL from env `AGENT_GATEWAY_E2E_V13_URL` and exits with a clear "v13 instance not configured" skip message when unset
- [ ] Test-user credentials come from env or `~/.config/agent-gateway/test.env` (mode 0600): `FOUNDRY_URL`, `FOUNDRY_USER`, `FOUNDRY_PASSWORD` for the GM (`dev-gm`) and `FOUNDRY_PLAYER_USER`, `FOUNDRY_PLAYER_PASSWORD` for the Player user; nothing secret committed
- [ ] Each user logs in once and its Playwright `storageState` is saved outside the repo (under `~/.config/agent-gateway/`, mode 0600) and reused; with the player variables unset the multi-user tests skip with the message "player test user not configured"
- [ ] Flow: start gateway, capture pairing code from stderr, log in, open pairing app, submit code, assert connected; MCP SDK client calls `world_info`, `document_search`, `document_get`, `compendium_search`, `compendium_get`, `chat_read`; asserts world id `test-world` and system `pf2e`
- [ ] A player-role run asserts `tools/list` excludes every `minRole: 'gm'` tool
- [ ] Multi-user isolation: one gateway, two browser contexts (GM and Player) paired at the same time, two MCP clients bound with `--world test-world --user <name>` to the GM and to the Player. Setup, run as the GM in the browser, idempotently creates fixtures tagged with an e2e flag: a journal entry with no Player permission (GM-only) and a chat message whispered from the GM to GM users only. Then:
  - the Player's agent: `document_search` / `document_get` never return the GM-only journal (`document_get` by its uuid returns `FORBIDDEN`), and `chat_read` never returns the GM-only whisper
  - the GM's agent: the same calls return both fixtures
  - each agent's `world_info` reports its own user (name and role), never the other's
- [ ] Gateway stop and restart: module reconnects within 60 s and a call succeeds without re-pairing
- [ ] `docs/testing.md` documents prerequisites (module linked and enabled, the GM and Player test users and their `test.env` variables), how to run, and the v13 gap
- [ ] PR includes the passing v14 run output

## Out of scope
- Quench in-world tests (39)
- Creating Foundry users or the v13 instance (homelab)
- Release automation (41)
