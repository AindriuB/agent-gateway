# 115 — Scope the hygiene test's Inspector check to exclude the conformance runner

**Repo:** .
**Depends on:** none
**Owns:**
- e2e/lib/hygiene.test.ts

## Goal
The e2e harness must never use MCP Inspector, but the MCP conformance runner (task 40, with the
retry helper from task 101) is meant to drive it. The hygiene test's Inspector check scans every
non-`.test.ts` file under `e2e/` and `scripts/`, so it fails on `main` in the `e2e-unit` vitest
project. Exempt the conformance runner's files from that one check through an explicit path
allowlist. All other files, and all other hygiene checks, must stay covered.

## Context
- e2e/lib/hygiene.test.ts:13-15 — `sources`: every file under `e2e/` and `scripts/`, minus
  `*.test.ts`. Note that `scripts/test/*.test.mjs` are **not** filtered out.
- e2e/lib/hygiene.test.ts:20-43 — the other three checks (no killing by name, `process.kill(` only
  in `e2e/lib/gateway.ts`, never typing into the pairing code field). They keep scanning the full
  `sources`, `scripts/` included.
- e2e/lib/hygiene.test.ts:45-50 — the failing check, named "does not use MCP Inspector or write
  inside the repo". It only checks for the substring `inspector`, case-insensitive. Nothing
  checks writes.
- On `main` at e8f0a64, `rg -ic inspector scripts e2e` finds these files besides the test itself.
  `expect` throws on the first one, so only `conformance.sh` is reported today:
  - scripts/conformance.sh (11): the runner. It runs `npx @modelcontextprotocol/inspector`.
  - scripts/release.mjs (1, :125): the release gate matches the runner's
    `conformance: ok (inspector <ver>, ...)` summary line.
  - scripts/test/conformance-retry.test.mjs (1), scripts/test/release.test.mjs (3),
    scripts/test/docker-release.test.mjs (1): node tests of the runner and the release gate.
  - scripts/lib/inspector-retry.sh (task 101) is sourced by the runner. Its contents do not
    mention inspector today, but it belongs to the runner and may.
- e2e/vitest.e2e.config.ts:3-27 — the `e2e-unit` project is offline: no browser, no Foundry.
  It is not part of the root vitest.config.ts, and `npm run verify` (package.json:21) does not run it.
- docs/testing.md:43 — the documented offline harness check command.

## Acceptance
- [ ] The Inspector check uses an explicit allowlist of repo-relative paths: exactly
      `scripts/conformance.sh`, `scripts/lib/inspector-retry.sh`, `scripts/release.mjs`,
      `scripts/test/conformance-retry.test.mjs`, `scripts/test/release.test.mjs` and
      `scripts/test/docker-release.test.mjs`. It contains no directory prefixes, globs or regexes.
- [ ] `sources` (e2e/lib/hygiene.test.ts:13-15) is unchanged. `scripts/` is still walked, and the
      kill-by-name, `process.kill(` and pairing-code checks still scan every file they scanned before.
- [ ] A new assertion checks that every allowlisted path exists under `REPO_ROOT`, so a rename or
      deletion fails the test instead of leaving a stale exemption.
- [ ] Mutation check, recorded in the hand-back and not committed: adding a line containing
      `Inspector` to `scripts/e2e.sh` (or to any non-allowlisted file under `e2e/`) makes the check
      fail and name that file. After reverting the line, the check passes.
- [ ] The check is renamed to say what it checks, e.g. `does not mention MCP Inspector outside the
      conformance runner`. The "or write inside the repo" wording is removed, because nothing
      enforces it. Adding a real write check is out of scope (see below).
- [ ] `npx vitest run --config e2e/vitest.e2e.config.ts --project e2e-unit` passes with 0 failures.
      It runs offline: no Foundry, no browser, no `AGENT_GATEWAY_E2E_*` env. On `main` it is
      1 failed / 185 passed. Afterwards it is 0 failed.
- [ ] `npx tsc -p e2e/tsconfig.json --noEmit` and `npx eslint e2e` are clean.
- [ ] `git diff --stat main` touches only `e2e/lib/hygiene.test.ts`.

## Out of scope
- Adding a "never writes inside the repo" check. That needs its own definition: which write APIs
  count, and what counts as inside the repo. Rename now. If a write check is wanted, file it separately.
- Changing the `.test.ts` filter on `sources` to also skip `.test.mjs`. That would silently drop
  `scripts/test/` from the other three checks.
- Editing scripts/conformance.sh, scripts/lib/inspector-retry.sh, scripts/release.mjs or any
  `scripts/test/*.mjs` to avoid the word.
- Wiring `e2e-unit` into `npm run verify` (package.json is not owned). Recommended follow-up:
  add `vitest run --config e2e/vitest.e2e.config.ts --project e2e-unit` (plus the e2e
  `tsc --noEmit`) to `verify`. Both run offline, and this failure went unnoticed only because
  `verify` skips them.
