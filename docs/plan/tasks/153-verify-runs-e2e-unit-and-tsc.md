# 153 — Run the e2e unit tests and the e2e type check in `npm run verify`

**Repo:** .
**Depends on:** none
**Owns:**
- package.json (the `scripts` block only)
- scripts/test/ci-workflow.test.mjs

## Goal
`npm run verify` is the gate on every PR and in CI, but it runs neither the offline e2e harness
tests (`e2e-unit`) nor `tsc` over `e2e/`. Task 115 found a failure that reached main because of
that. Add both to verify without making it noticeably slower.

## Context
- package.json:17-31: the scripts. `verify` is `build && lint && test && test:slow && test:scripts`.
- e2e/vitest.e2e.config.ts:1-27: the `e2e-unit` project (offline; no browser, no Foundry). It is not
  listed in the root vitest.config.ts on purpose; keep it out of `npm test`.
- e2e/tsconfig.json: `noEmit`, includes `./**/*.ts`.
- docs/testing.md:43: the commands people run by hand today:
  `npx vitest run --config e2e/vitest.e2e.config.ts --project e2e-unit` and
  `npx tsc -p e2e/tsconfig.json --noEmit`. `eslint .` in `lint` already covers `e2e/`.
- scripts/test/ci-workflow.test.mjs:86-89: asserts verify ends with `npm run test:scripts`. Keep that
  true.
- .github/workflows/ci.yml: CI runs `npm ci` then `npm run verify` on Ubuntu with a 30-minute job
  timeout. The CI `test` check must pass for this PR to merge.
- docs/plan/HISTORY-INDEX.md row for tasks 113, 114, 115: why this is needed.

## Acceptance
- [ ] package.json gains two scripts, `test:e2e-unit` (the vitest command above) and
      `typecheck:e2e` (the tsc command above), and `verify` runs both before `npm run test:scripts`.
      `verify` still ends with `npm run test:scripts`.
- [ ] scripts/test/ci-workflow.test.mjs gains a test that `verify` includes `npm run test:e2e-unit`
      and `npm run typecheck:e2e`.
- [ ] `npm run test:e2e-unit` and `npm run typecheck:e2e` each exit 0 on this branch, offline, with no
      Foundry, Chrome or test.env present.
- [ ] The PR description records the wall time of each new step on the implementer's machine and
      the before/after wall time of `npm run verify`. If the two new steps add more than 60 s
      together, stop and report instead of merging.
- [ ] The CI `test` check passes on the PR.
- [ ] `npm run verify` passes.

## Out of scope
- Fixing anything under `e2e/**`. If either new step fails on this branch, stop and report the
  failing file and error: that fix is a separate task.
- `scripts/release.mjs` and `scripts/test/release.test.mjs` (task 152).
- docs/conventions.md and docs/testing.md, which describe verify (scribe: note the new steps in the
  PR so `/record` updates them).
- Adding `e2e-unit` to the root vitest.config.ts or to `npm test`.
- The CI workflow file.
