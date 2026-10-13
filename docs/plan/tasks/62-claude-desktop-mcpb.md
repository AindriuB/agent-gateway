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
- [ ] `gateway/mcpb/manifest.json` passes `mcpb validate`; `server.type` is `node`; `version` equals `gateway/package.json` version (test asserts); `compatibility.runtimes.node` is `>=22.13`; `compatibility.platforms` lists `darwin` and `win32`; tools are declared as generated, not a static list
- [ ] `user_config` exposes only settings already read from env in `ENV_KEYS` (named in the PR), maps each to its env var, and contains no secret
- [ ] `node scripts/build-mcpb.mjs` (after `npm run build`) writes `dist/release/foundry-agent-gateway.mcpb` using the pinned `@anthropic-ai/mcpb` devDependency
- [ ] `scripts/test/build-mcpb.test.mjs` unpacks the bundle and asserts it contains `manifest.json` and the entry point the manifest names, and that `node <unpacked entry> --version` with a temp `HOME` prints the version (proves no unresolved workspace import)
- [ ] `node --test scripts/test/build-mcpb.test.mjs` passes and `npm run verify` passes
- [ ] Manual check on the Mac: install the bundle in Claude Desktop, pair with foundry.local v14 with the GM tab open, and call `world_info` successfully; PR includes the log or screenshot. If Claude Desktop's built-in Node cannot load `node:sqlite`, stop and report the exact error; do not change runtime type or storage engine

## Out of scope
- Uploading the bundle or any GitHub release (64, 66)
- Signing with `mcpb sign`: MVP A ships the bundle unsigned (Andrew, 2026-10-13); signing is for a later release
- Changes to gateway source or `gateway/package.json` (61)
- Root `package.json` `scripts` (64)
