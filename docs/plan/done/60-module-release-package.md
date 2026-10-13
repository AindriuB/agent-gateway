# 60 — Package the Foundry module: system relationships and a release zip

**Repo:** .
**Depends on:** none
**Status:** MVP A
**Owns:**
- module.json (`relationships` and `download` fields only)
- scripts/pack-module.mjs
- scripts/test/pack-module.test.mjs

## Goal
Make the module installable by someone else: declare the game systems it has
adapters for in `module.json`, and produce the exact zip a Foundry manifest
`download` URL will point at. This is the module half of task 41, split out so
MVP A does not wait on Quench (39) or remote conformance (40).

## Context
- module.json — current manifest; `manifest` already points at `releases/latest/download/module.json`
- docs/plan/done/32-dnd5e-adapter.md:36,57 — dnd5e range for `relationships.systems`: minimum 6.0, verified 6.0.6
- docs/plan/done/33-pf2e-adapter.md:14 and docs/plan/done/49-pf2e-build-choices.md:5 — pf2e adapter built and natively tested on pf2e 8.6.0 (v14)
- docs/testing.md:80 — v13.351 / pf2e 7.12.2 passed the core gate (adapter not run on v13)
- docs/plan/tasks/41-release-script.md — the original zip-contents and "no pack dependency" acceptance this task inherits
- module/package.json:8 — module build output in `dist/module/`
- examples/hello-pack/ — a separate module that must never ship in the core zip

## Acceptance
- [x] ~~`relationships.systems` lists pf2e and dnd5e~~ Replaced (Andrew, 2026-10-13): `module.json` declares no `relationships.systems`. Foundry v13/v14 core hides a module from every world whose system is not listed (World._initialize calls Module.getPackages({system, enforceCompatibility}), which calls supportsSystem) and force-disables it below the listed minimum version. The gateway must work on any system with the generic adapter as fallback. Supported pf2e/dnd5e versions go in the docs (task 65).
- [x] `module.json` has no `relationships.systems`, `relationships.requires` or `relationships.recommends` entry; `scripts/test/pack-module.test.mjs` asserts this, so the core never depends on a pack
- [x] `module.json` `download` is `https://github.com/AindriuB/agent-gateway/releases/download/v<version>/agent-gateway.zip`; the test asserts `<version>` equals `module.json` `version`
- [x] After `npm run build`, `node scripts/pack-module.mjs` writes `dist/release/agent-gateway.zip`; it exits non-zero with one stderr line naming the missing file if `dist/module/main.js` is absent
- [x] The zip has no `*.map` (source maps embed the full source) and no dotfile or dot-directory entry; the test uses decoys for both. The test lists the zip: every entry is `module.json`, `LICENSE` or under `dist/module/`, `lang/`, `templates/` or `styles/`; no entry under `examples/`, `node_modules/` or `module/src/`, and no `*.ts` file
- [x] The test asserts the zipped `module.json` is byte-identical to the repo's, and every path named in its `esmodules`, `styles` and `languages[].path` exists in the zip
- [x] No new npm dependency (system `zip`/`unzip` or Node built-ins only)
- [x] `node --test scripts/test/pack-module.test.mjs` passes and `npm run verify` passes
- [x] Manual check answered from core source, not a live run (Andrew, 2026-10-13): Foundry does not let a module be enabled in a world whose system is not listed in `relationships.systems`; it is hidden (World._initialize -> Module.getPackages -> supportsSystem), hence the decision above. The unpack-and-enable check on foundry.local is still worth doing at release (task 66).

## Out of scope
- `version` bumps and the root `package.json` scripts (64)
- `documentTypes` and any other `module.json` field
- Uploading anything, or the Foundry package listing (66, Andrew)
- The gateway npm package and `.mcpb` (61, 62)

## Attempt 1 — passed
Head `8770991`: `scripts/test/pack-module.test.mjs` 6/6; `npm run verify` green (3,878 fast / 2,227 slow). No `relationships` in `module.json` (decision above). Live unpack-and-enable check deferred to task 66.
