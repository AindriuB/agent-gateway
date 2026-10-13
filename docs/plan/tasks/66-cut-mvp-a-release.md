# 66 — Cut the first MVP A release

**Repo:** .
**Depends on:** 64, 65
**Status:** MVP A. Stops for Andrew's explicit go-ahead before creating the GitHub draft release, before publishing it, before `npm publish`, and before any Foundry package listing.
**Owns:**
- module.json (`version` and `download` only, written by `scripts/bump-version.mjs`)
- package.json, protocol/package.json, module/package.json, gateway/package.json (`version` only)
- gateway/mcpb/manifest.json (`version` only)
- package-lock.json (version fields only)
- docs/compatibility.md (ticking this release's manual checklist only)
- docs/releasing.md (filling in Ask Foundry answers Andrew provides, only)

## Goal
Ship MVP A: bump to the release version through a PR, run the release script
on `main`, and hand Andrew three artefacts and a draft release to publish.
Every irreversible step waits for his explicit go-ahead.

## Context
- docs/releasing.md and scripts/release.mjs (64)
- docs/compatibility.md (63) — the manual per-release checklist
- docs/plan/tasks/60-module-release-package.md — the open `relationships.systems` question must be answered first

## Acceptance
- [ ] The release version is `0.1.0` (Andrew, 2026-10-13). Every file `scripts/bump-version.mjs` manages already reads 0.1.0 except, possibly, the `download` URL tag; any needed bump goes through a PR merged to `main`, and `node scripts/bump-version.mjs --check` passes on `main`
- [ ] On `main`, `npm run release -- 0.1.0` passes every gate and builds the three artefacts; the report includes the gate summary and SHA-256s
- [ ] STOP: the `yes` prompt (draft release creation) is answered only after Andrew's explicit go-ahead for v0.1.0
- [ ] STOP: publishing the draft release is done by Andrew, or only after his explicit go-ahead
- [ ] STOP: `--publish-npm` is used only after Andrew's explicit go-ahead
- [ ] After publication: `curl -sL https://github.com/AindriuB/agent-gateway/releases/latest/download/module.json` shows the new version; a fresh install from that manifest URL on foundry.local v14 enables and the GM tab connects; after npm publish, `npx foundry-agent-gateway@0.1.0 --version` in a clean temp directory prints the version
- [ ] The Claude Desktop (`.mcpb` and `npx`) and Claude Code rows of the `docs/compatibility.md` checklist are ticked for 0.1.0 in a follow-up PR

## Out of scope
- Foundry package listing submission (Andrew; waits for the six Ask Foundry answers)
- The after-action report (chat only, never committed)
- Docker image (42) and anything MVP B
