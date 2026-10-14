# 80 — Run the script tests in `npm run verify`

**Repo:** .
**Depends on:** none
**Status:** Requested by Andrew on 2026-10-14. Written against main 72561f9 (CI live since task 77).
**Owns:**
- package.json (the `scripts.verify` line only)
- .github/workflows/ci.yml (only the `test` job's `npm run test:scripts` step)
- scripts/test/ci-workflow.test.mjs

## Goal
Make `npm run verify` also run `npm run test:scripts`, so a local verify runs the same gate as CI. Once verify covers the script tests, CI's separate `test:scripts` step only runs them a second time. Remove that step, and change the CI workflow test so it checks that the script tests still run through verify.

## Context
- **Decision: drop the separate CI step.** Andrew's gate from task 77 was "`npm run verify` and `npm run test:scripts`" (docs/plan/done/77-ghcr-image-workflow.md, Context). With this task, `verify` is a superset of that gate, so CI still enforces the gate. Running the script tests twice per CI run only costs time. To keep the guarantee mechanical, ci-workflow.test.mjs should assert that package.json's `verify` contains `npm run test:scripts`. Then a later edit to `verify` cannot silently drop the script tests from CI. Task 77's acceptance needs no change.
- **package.json:20** is `"verify": "npm run build && npm run lint && npm test && npm run test:slow"`, and **:23** is `"test:scripts": "node --test scripts/test/*.test.mjs"`. Append `&& npm run test:scripts` at the end, after the build, so build-mcpb.test.mjs finds a fresh build.
- **ci.yml** (`test` job): `npm ci`, `npm run verify`, `npm run test:scripts`. Remove only the last step.
- **ci-workflow.test.mjs** "runs the gate in order on ubuntu-latest" lists `npm run test:scripts` in its expected order. Change that test to:
  - drop `npm run test:scripts` from the expected order;
  - assert that `run: npm run test:scripts` does not appear in the test job;
  - read package.json and assert that `scripts.verify` ends with `npm run test:scripts`.
- **Is it machine-independent?** Check every scripts/test/*.test.mjs and record the result in the PR. What is known so far:
  - They build temp git repos and set their own `-c user.name/-c user.email` (scripts/test/release.test.mjs:98).
  - They stub `npm`, `gh` and `docker` on PATH (scripts/test/docker-release.test.mjs:38-46, release.test.mjs:41), so no Docker daemon is involved.
  - They call `unzip` (pack-module.test.mjs:82).
  - build-mcpb.test.mjs:81-106 runs `npm run build -w gateway` and `node_modules/.bin/mcpb`.

  Confirm there is no network access, no absolute home path, nothing outside the OS temp dir apart from repo build output, and no Docker daemon.
- **Recursion check:**
  - release.mjs:77-78 runs `npm run verify` and then `npm run test:scripts` as gates. release.test.mjs and docker-release.test.mjs stub `npm`, so verify never re-enters itself.
  - bump-version.test.mjs:50 spawns `node --test` on its own file only.

  Confirm both points in the PR.
- **Timing:** report how long `npm run test:scripts` takes locally, so the cost added to verify is on record.

## Acceptance
- [ ] `node -p "require('./package.json').scripts.verify"` prints `npm run build && npm run lint && npm test && npm run test:slow && npm run test:scripts`. No other line of package.json changes (`git diff package.json` shows one changed line).
- [ ] The `test` job in .github/workflows/ci.yml has steps checkout, setup-node, `npm ci`, `npm run verify`, and no `npm run test:scripts` step. The `image` job and the triggers are unchanged.
- [ ] scripts/test/ci-workflow.test.mjs asserts that the test job has no `test:scripts` step and that `scripts.verify` in package.json ends with `npm run test:scripts`. Every other assertion in the file is kept.
- [ ] The PR lists each script test file with any external tool it needs (git, unzip, the built gateway, mcpb from node_modules). It confirms no Docker daemon and no network access are needed, and that verify does not recurse.
- [ ] `npm run verify` passes locally, and the output shows the `node --test` summary for the script tests. CI on the PR is green.

## Out of scope
- scripts/release.mjs:77-78 and scripts/test/release.test.mjs still run `test:scripts` as a separate gate after `verify`, so it runs twice in a release. Leave this alone and note it in the PR for Andrew.
- gateway/docker/** and scripts/test/docker-*.test.mjs belong to task 78.
- Scribe items, done at record time: docs/conventions.md:18 ("`npm run verify` runs both and is the gate") and PROJECT.md:44 (rule 9) should say that verify also runs the script tests. docs/releasing.md:17-18 lists the gates.
