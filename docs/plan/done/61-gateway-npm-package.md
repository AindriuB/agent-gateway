# 61 — Make the gateway installable with `npx foundry-agent-gateway`

**Repo:** .
**Depends on:** none
**Status:** MVP A
**Owns:**
- gateway/package.json (packaging fields, `build`/`prepack` scripts, `devDependencies`)
- gateway/build.mjs (new: bundling step, if one is used)
- gateway/test/package/**
- gateway/README.md
- gateway/LICENSE
- package-lock.json

## Goal
A user with Node 22.13+ can run `npx foundry-agent-gateway` and get a working
stdio MCP server. Today the package depends on the private workspace
`@agent-gateway/protocol`, so a published tarball would not install. Fix that
and prove it from a packed tarball, without publishing.

## Context
- docs/plan/PLAN.md "Follow-ups from task 05" and "Follow-ups from task 06" — protocol is a private workspace; bundle it or publish it
- gateway/package.json — `bin`, `files`, dependencies
- protocol/package.json — `private: true`, subpath exports `./link`, `./tools`
- package.json:12 — `engines.node >=22.13` (the store uses `node:sqlite`, gateway/src/store/store.ts:3)
- gateway/src/bin/cli.ts:23-50 — `--version`, `--help`
- gateway/test/bin/** — existing CLI tests that run `dist/bin/cli.js`

## Acceptance
- [x] `npm pack -w gateway` produces `foundry-agent-gateway-<version>.tgz` whose `package.json` lists no `@agent-gateway/*` dependency (protocol code is bundled into `dist/`), keeps `bin.foundry-agent-gateway`, and sets `engines.node` to `>=22.13`, `license` to `MIT` and `repository` to the GitHub repo
- [x] `gateway/test/package/contents.test.ts` runs `npm pack -w gateway --dry-run --json` and asserts every file is `package.json`, `README.md`, `LICENSE` or under `dist/`; no test files, no `src/`
- [x] `gateway/test/package/smoke.mjs`, run by hand, packs the tarball, installs it into a fresh temp directory with a temp `HOME`, and checks: `npx foundry-agent-gateway --version` prints the version; piping an MCP `initialize` request to the bin returns an `initialize` result on stdout with nothing else on stdout (warnings such as the `node:sqlite` ExperimentalWarning go to stderr only); the real `~/.foundry-agent-gateway` is untouched. PR includes its output
- [x] `npm publish -w gateway --dry-run` output is in the PR; nothing is published
- [x] `gateway/README.md` is a short npm-page readme: what it is, `npx foundry-agent-gateway`, Node 22.13+, link to the repo README
- [x] Existing `gateway/test/bin/**` tests pass unchanged; `npm run verify` passes

## Out of scope
- `npm publish` for real (66, stops for Andrew's explicit go-ahead)
- The `.mcpb` bundle (62), the release script and root `package.json` scripts (64)
- Publishing `@agent-gateway/protocol` as its own package
- Root `README.md` and user docs (65)

## Attempt 1 — passed
Head `3a33cd9`, one review round. `npm run verify` green twice (3,879 fast / 2,227 slow); `smoke.mjs` passes; `npm publish -w gateway --dry-run` gives foundry-agent-gateway@0.1.0 (4 files, 37.7 kB). Nothing published.
