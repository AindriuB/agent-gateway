# 41 — Add the local release script for module, npm package and .mcpb

**Repo:** .
**Depends on:** 12a, 12b, 39, 40, 20f
**Owns:**
- scripts/release.mjs
- scripts/bump-version.mjs
- gateway/mcpb/**
- module.json (release fields only)
- package.json (`release` script insertion only)
- docs/releasing.md

## Goal
Make a release a single local command, since GitHub Actions is unavailable:
bump the single version everywhere, build, run unit, e2e (v14 and v13) and
conformance tests, build the module zip and `.mcpb` bundle, and upload with
`gh` and `npm publish`, stopping short of anything irreversible without a
confirmation prompt.

## Context
- docs/plan/specs/2026-10-09-agent-gateway.md:180-201 — release artefacts, single version, local release
- GitHub Actions is unavailable (billing), so nothing here may assume CI
- docs/plan/specs/2026-10-09-agent-gateway.md section 6 "Tool packs: distribution and licensing" and its "Ask Foundry before submitting" list
- examples/hello-pack/ (20f) is a separate module and must never ship in the core zip

## Acceptance
- [ ] `npm run release -- <version>` refuses a dirty tree or a non-`main` branch; `bump-version.mjs` sets the version in root, all workspaces and `module.json` (and `download` URL for that tag), with a test that they agree
- [ ] Runs `verify`, `test:e2e` for v14 and v13 (v13 failure or absence aborts unless `--allow-missing-v13` is passed, which is printed in the summary), and `test:conformance`
- [ ] Builds `agent-gateway.zip` containing `module.json`, `dist/module/**`, `lang/**`, `templates/**`, `styles/**`, `LICENSE` only (test lists the zip)
- [ ] Builds `foundry-agent-gateway.mcpb` from `gateway/mcpb/manifest.json` using `@anthropic-ai/mcpb`
- [ ] Before upload prints the planned actions and asks for `yes`; then `gh release create v<version>` with zip, `module.json` and `.mcpb` as a **draft**, and `npm publish -w gateway --dry-run` unless `--publish-npm`
- [ ] `docs/releasing.md` documents the steps and that Andrew publishes the draft release
- [ ] The zip-listing test also asserts no path under `examples/` is in the zip
- [ ] A test asserts the core `module.json` has no `relationships.requires` or `relationships.recommends` entry other than game systems, so the core never depends on a pack
- [ ] `docs/releasing.md` has a "Before Foundry submission" checklist that lists the six "Ask Foundry" questions from spec section 6, each with a blank for the answer, the date and the source (email or URL), and states that the first listing submission waits until all six are answered; the release script prints `Ask Foundry checklist: N of 6 answered` from that file before the `yes` prompt

## Out of scope
- Docker image (42); Foundry listing submission (manual)
