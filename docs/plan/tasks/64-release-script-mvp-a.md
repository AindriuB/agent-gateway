# 64 — Add the local release script for module zip, npm package and `.mcpb`

**Repo:** .
**Depends on:** 60, 61, 62, 63, 69
**Status:** MVP A
**Owns:**
- scripts/release.mjs
- scripts/bump-version.mjs
- scripts/test/release.test.mjs
- scripts/test/bump-version.test.mjs
- docs/releasing.md
- package.json (root `scripts` insertions only: `release`, `bump-version`, `test:scripts`, `test:conformance`, `pack:module`, `pack:mcpb`)

## Goal
The MVP A version of task 41: make a release one local command (GitHub Actions
is unavailable). Bump one version everywhere, run every gate, build the three
artefacts, and stop before anything irreversible. Quench (39) and remote
conformance (40) are not gates in MVP A.

## Context
- docs/plan/tasks/41-release-script.md — the full contract this is split from
- docs/plan/specs/2026-10-09-agent-gateway.md section 6 "Distribution, releases, policy" and "Tool packs: distribution and licensing" (its "Ask Foundry before submitting" list)
- scripts/pack-module.mjs (60), `npm pack -w gateway` (61), scripts/build-mcpb.mjs (62), scripts/conformance.sh (63)
- docs/testing.md:76-80 — `--foundry v13` prints `SKIP: v13 instance not configured` and exits 0 when unset

## Acceptance
- [ ] `npm run release -- <version>` exits non-zero on a dirty tree or a branch other than `main` (test uses a temp git repo)
- [ ] `scripts/bump-version.mjs <version>` sets the version in root, `protocol`, `module` and `gateway` `package.json`, `package-lock.json`, `module.json` (`version` and the `download` URL tag) and `gateway/mcpb/manifest.json`; `--check` exits non-zero when any disagree; tested
- [ ] Gates, in order: `npm run verify`, `npm run test:scripts`, `npm run test:conformance`, `npm run test:e2e -- --foundry v14`, `npm run test:e2e -- --foundry v13`. A v13 `SKIP` line counts as absent and aborts unless `--allow-missing-v13` is passed, which the summary prints
- [ ] Builds `agent-gateway.zip`, `foundry-agent-gateway-<version>.tgz` and `foundry-agent-gateway.mcpb` into `dist/release/` and prints the SHA-256 of each
- [ ] Before any upload it prints the planned actions and `Ask Foundry checklist: N of 6 answered` (parsed from `docs/releasing.md`), then asks for `yes`; any other answer exits 0 having uploaded nothing
- [ ] After `yes`: `gh release create v<version> --draft` with the zip, `module.json` and `.mcpb`; then `npm publish -w gateway --dry-run`. A real `npm publish` happens only with `--publish-npm` and a second typed confirmation `publish foundry-agent-gateway@<version>`. The script never publishes a draft release and never pushes to `main`
- [ ] `scripts/test/release.test.mjs` runs the script with stub `gh`, `npm` and gate commands on `PATH` and asserts: `--draft` is always passed; no real `npm publish` without the flag and second confirmation; nothing uploads when the answer is not `yes`; abort on a failing gate
- [ ] `docs/releasing.md` documents the steps; states that publishing the draft release, `npm publish` and the Foundry listing each stop for Andrew's explicit go-ahead; notes that the `releases/latest/download/module.json` manifest URL only resolves once a release is published; and has a "Before Foundry submission" checklist of the six "Ask Foundry" questions, each with blanks for the answer, date and source, stating that the first listing waits until all six are answered
- [ ] `npm run verify` passes

## Out of scope
- Cutting the actual release (66)
- Docker image build or push (42)
- Quench gate (39, 41) and HTTP/OAuth conformance (40)
- Changing `scripts/pack-module.mjs`, `scripts/build-mcpb.mjs` or `scripts/conformance.sh` (60, 62, 63); call them as they are
