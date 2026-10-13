# 62 — Build the Claude Desktop `.mcpb` bundle

**Repo:** .
**Depends on:** 61
**Status:** MVP A
**Owns:**
- gateway/mcpb/**
- scripts/build-mcpb.mjs
- scripts/test/build-mcpb.test.mjs
- package.json (root `devDependencies`: insert `@anthropic-ai/mcpb` only)
- package-lock.json
- Widened (Andrew, 2026-10-13): gateway/src/app.ts, gateway/src/mcp/degraded.ts, gateway/src/mcp/session.ts, gateway/src/bin/cli.ts, gateway/src/store/store.ts, gateway/src/link/server.ts, gateway/test/bin/link-conflict.test.ts, gateway/test/store/store.test.ts

## Goal
Give Claude Desktop users a one-click install: a `.mcpb` bundle that runs the
same stdio gateway that 61 makes installable from npm. Built locally from the
61 build output; not uploaded here.

## Context
- docs/plan/tasks/61-gateway-npm-package.md — the bundled gateway build this packs
- docs/plan/tasks/41-release-script.md — original `.mcpb` acceptance (`gateway/mcpb/manifest.json`, `@anthropic-ai/mcpb`)
- gateway/src/config/** `ENV_KEYS` — the only settings that may be exposed as `user_config`
- package.json:12 — Node >=22.13; gateway/src/store/store.ts:3 uses `node:sqlite`

## Acceptance
- [x] `gateway/mcpb/manifest.json` passes `mcpb validate`; `server.type` is `node`; `version` equals `gateway/package.json` version (test asserts); `compatibility.runtimes.node` is `>=22.13`; `compatibility.platforms` lists `darwin` and `win32`; tools are declared as generated, not a static list
- [x] `user_config` exposes only settings already read from env in `ENV_KEYS` (named in the PR), maps each to its env var, and contains no secret
- [x] `node scripts/build-mcpb.mjs` (after `npm run build`) writes `dist/release/foundry-agent-gateway.mcpb` using the pinned `@anthropic-ai/mcpb` devDependency
- [x] `scripts/test/build-mcpb.test.mjs` unpacks the bundle and asserts it contains `manifest.json` and the entry point the manifest names, and that `node <unpacked entry> --version` with a temp `HOME` prints the version (proves no unresolved workspace import)
- [x] `node --test scripts/test/build-mcpb.test.mjs` passes and `npm run verify` passes
- [ ] Manual check on the Mac: install the bundle in Claude Desktop, pair with foundry.local v14 with the GM tab open, and call `world_info` successfully; PR includes the log or screenshot. If Claude Desktop's built-in Node cannot load `node:sqlite`, stop and report the exact error; do not change runtime type or storage engine. Done so far (Andrew, Electron 44.4.3): installs and runs on Desktop's Node with `node:sqlite`; `initialize` and `tools/list` work in normal chat; pairing with https://foundry.local succeeded. Open: `world_info` awaits Andrew's confirmation

## Amendments (Andrew, 2026-10-13)
- A gateway instance that loses the link port (EADDRINUSE) or finds the db locked stays up as a degraded MCP server instead of exiting: it answers `initialize`, `ping` and `server/discover` (-32601), exposes one `gateway_status` tool, and returns `LINK_UNAVAILABLE` on every call. The link port is bound before the store opens, so a degraded instance never opens the db. Real failures such as a corrupt db still exit 1. Reason: Claude Desktop starts extra copies for its Cowork/Code pool and probes.
- `user_config.foundry_url` is passed as `--allow-origin`; `cli.ts` normalises each value with `new URL(v).origin` and exits 2 with an error naming "include http:// or https://" on invalid or non-http(s) values. An empty value falls back to the defaults (the defaults allowed only localhost:30000, so a remote Foundry was rejected). The link server warns once per distinct rejected origin, sanitised and capped at 20.
- Only the instance holding the link port prints the pairing code, with "pid N holds link port"; degraded instances print one "cannot pair" line. The pairing code also goes out as an MCP `notice` log message.
- The store uses `busy_timeout` 5000 and `openStore` closes its handle if setup throws.

## Out of scope
- Uploading the bundle or any GitHub release (64, 66)
- Signing with `mcpb sign`: MVP A ships the bundle unsigned (Andrew, 2026-10-13); signing is for a later release
- Changes to gateway source or `gateway/package.json` (61), except the files widened under Owns
- Root `package.json` `scripts` (64)

## Attempt 1 — implemented; reviewed; manual check partly done
Bundle, manifest and tests reviewed in one round (notices, test residue). The manual Claude Desktop check then found three faults, all fixed on this branch and reviewed in three further rounds, final verdict approve with no defects:
1. Extra instances died on the db lock and link port, so Desktop reported "connection closed during server/discover probe". Fixed by the degraded mode above; a concurrency test starts 4 fresh instances 20 times and gets exactly one primary each time.
2. Every instance printed a pairing code. Fixed as above.
3. The default allowed origins covered only localhost:30000. Fixed by `foundry_url`.

Gates: `npm run verify` green (fast 3898 in the reviewer's run); `node --test scripts/test/build-mcpb.test.mjs` 5/5.

Decision (Andrew): 0.1.0 ships degraded secondaries. Task 69 will let secondaries forward to the primary over task 34's local transport.
