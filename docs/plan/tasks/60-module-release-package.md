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
- [ ] `module.json` `relationships.systems` has exactly two entries, `{ id: "pf2e", type: "system", compatibility: { minimum: <Andrew's decision, default "7.12">, verified: "8.6.0" } }` and `{ id: "dnd5e", type: "system", compatibility: { minimum: "6.0", verified: "6.0.6" } }`
- [ ] `module.json` has no `relationships.requires` or `relationships.recommends` entry; `scripts/test/pack-module.test.mjs` asserts this, so the core never depends on a pack
- [ ] `module.json` `download` is `https://github.com/AindriuB/agent-gateway/releases/download/v<version>/agent-gateway.zip`; the test asserts `<version>` equals `module.json` `version`
- [ ] After `npm run build`, `node scripts/pack-module.mjs` writes `dist/release/agent-gateway.zip`; it exits non-zero with one stderr line naming the missing file if `dist/module/main.js` is absent
- [ ] The test lists the zip: every entry is `module.json`, `LICENSE` or under `dist/module/`, `lang/`, `templates/` or `styles/`; no entry under `examples/`, `node_modules/` or `module/src/`, and no `*.ts` file
- [ ] The test asserts the zipped `module.json` is byte-identical to the repo's, and every path named in its `esmodules`, `styles` and `languages[].path` exists in the zip
- [ ] No new npm dependency (system `zip`/`unzip` or Node built-ins only)
- [ ] `node --test scripts/test/pack-module.test.mjs` passes and `npm run verify` passes
- [ ] Manual check on foundry.local v14: the zip unpacked into `Data/modules/agent-gateway` enables in `test-world` (pf2e) and in the dnd5e world, and the GM tab's link connects. The PR also states, from a live check, whether Foundry lets the module be enabled in a world whose system is not listed (this answers the open decision on `relationships.systems`)

## Out of scope
- `version` bumps and the root `package.json` scripts (64)
- `documentTypes` and any other `module.json` field
- Uploading anything, or the Foundry package listing (66, Andrew)
- The gateway npm package and `.mcpb` (61, 62)
