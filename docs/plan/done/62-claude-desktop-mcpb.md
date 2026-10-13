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
- gateway/src/app.ts, gateway/src/mcp/degraded.ts, gateway/src/mcp/session.ts (logging capability and pairing-code notice), gateway/test/bin/link-conflict.test.ts, gateway/src/bin/cli.ts (`--allow-origin` normalisation) (widened, Andrew, 2026-10-13)

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
- [ ] Manual check on the Mac: install the bundle in Claude Desktop, pair with foundry.local v14 with the GM tab open, and call `world_info` successfully; PR includes the log or screenshot. If Claude Desktop's built-in Node cannot load `node:sqlite`, stop and report the exact error; do not change runtime type or storage engine

## Amendments (Andrew, 2026-10-13)
- A second gateway instance that cannot take the link port or db stays up as a degraded MCP server (`gateway_status`; tool calls return `LINK_UNAVAILABLE`), because Claude Desktop starts extra copies for probes and Cowork/Code sessions.
- `user_config.foundry_url` is passed as `--allow-origin`; `cli.ts` normalises each value with `new URL(v).origin` and exits 2 with a one-line error on invalid or non-http(s) values.
- The primary also sends the pairing code as an MCP `notice` log message.

## Out of scope
- Uploading the bundle or any GitHub release (64, 66)
- Signing with `mcpb sign`: MVP A ships the bundle unsigned (Andrew, 2026-10-13); signing is for a later release
- Changes to gateway source or `gateway/package.json` (61), except the files widened under Owns
- Root `package.json` `scripts` (64)

## Attempt 1 — implemented, manual check pending (Andrew)
Bundle, manifest and tests done and reviewed in one round; the last acceptance box (install in Claude Desktop, pair with foundry.local, call `world_info`) is unticked on purpose: manual check pending (Andrew), before merge. Electron 44.4.3 in Claude Desktop contains `node:sqlite` (binary inspected, not run). If the check fails on `node:sqlite`, stop and report the exact error.
