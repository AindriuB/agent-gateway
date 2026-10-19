# 152 — Run the image e2e suites in the release gates and abort when they skip

**Repo:** .
**Depends on:** none
**Owns:**
- scripts/release.mjs
- scripts/test/release.test.mjs
- docs/releasing.md (the gate description in step 3 and the usage line only; given to this task explicitly)

## Goal
The native image suites (`image-upload`, `image-assign`, `image-view`) are opt-in, gated by
`AGENT_GATEWAY_E2E_IMAGE=1` and `AGENT_GATEWAY_E2E_UPLOAD=1`, so a release can pass its v14 and v13
e2e gates without running them. `scripts/release.mjs` must turn both on for both e2e gates and abort
if any of the three suites did not actually run, the same way it aborts on a v13 `SKIP:` line. The
script runs locally against the owner's own Foundry; there is no Foundry in CI, so everything here
is proved with the stubbed `npm` in the script tests.

## Context
- scripts/release.mjs:16-17: `V13_SKIP_MESSAGE` and how a skip is detected from stdout.
- scripts/release.mjs:113-150: `gate()`, the v14 gate (default env) and the v13 gate (its own env
  object). Both need the two image variables set to `1`.
- scripts/release.mjs:36 and :14: the `--allow-missing-v13` flag and the usage string; any new flag
  follows this shape.
- scripts/release.mjs:266-267: the release summary line for v13.
- e2e/run.ts:180-195 and e2e/lib/summary.ts:30-46, 79-82: after the vitest run, `run.ts` prints one
  line per suite file as `  <suite>: <n> passed, <n> failed, <n> skipped`, where `<suite>` is the file
  basename without `.e2e.test.ts`. The three image suites print as `upload`
  (e2e/image-upload/upload.e2e.test.ts), `image-assign` and `image-view`. Do not confuse them with
  the `  <suite>: <label>: <value>` lines from `multi`.
- e2e/image-upload/upload.e2e.test.ts:8-18, e2e/image-assign/image-assign.e2e.test.ts:7-13,
  e2e/image-view/image-view.e2e.test.ts:7-16: the env gates (`describe.skipIf(!enabled)`), which
  print nothing when skipped. So "skipped" means the suite line is missing or shows 0 passed.
- e2e/image-upload/upload.e2e.test.ts:16-17: uploaded files cannot be deleted through the API and
  the suite prints each path at the end (`RESIDUE:`). The release doc must tell the operator.
- scripts/test/release.test.mjs:40-60: the stub `npm`. Its e2e branches must be able to print the
  suite summary lines, and echo whether the two image variables reached each e2e run (the
  `env $*:` log line at :43 is the pattern).
- docs/plan/done/99-release-script-gates.md: the last change to these gates and their tests.

## Acceptance
- [ ] Both e2e gates run with `AGENT_GATEWAY_E2E_IMAGE=1` and `AGENT_GATEWAY_E2E_UPLOAD=1` in the
      child environment, whatever the caller's environment says. A release test reads the stub log
      and shows both variables were `1` for the v14 run and for the v13 run.
- [ ] After each e2e gate, the script checks the stdout lines matching
      `^  (upload|image-assign|image-view): (\d+) passed, (\d+) failed, (\d+) skipped$`. If any of
      the three is missing, or has 0 passed, the release stops with
      `gate failed: e2e <v14|v13> image suites skipped: <names>` and a non-zero exit, before any
      artefact is built. A release test covers: all three present and passing (release continues);
      one missing (aborts, names it); one with `0 passed, 0 failed, 3 skipped` (aborts, names it).
- [ ] When v13 itself is skipped and `--allow-missing-v13` is passed, the v13 image check is not
      applied (there was no v13 run). A release test covers this.
- [ ] A new flag `--allow-skipped-image` (named in the usage string at :1 and :14) turns the abort
      into a note, and the final summary prints `image e2e: SKIPPED (<gate>: <names>)`; without any
      skip the summary prints `image e2e: ran (v14, v13)` or `image e2e: ran (v14)` when v13 was
      allowed missing. Release tests cover the flag and both summary forms.
- [ ] Existing release tests still pass; `npm run test:scripts` passes.
- [ ] docs/releasing.md step 3 says that both e2e gates turn on the three image suites, that a
      suite which did not run aborts the release unless `--allow-skipped-image` is passed, and that
      the upload suite leaves its uploaded files under `agent-gateway/uploads/<userId>/` for the
      operator to delete (the run prints each path). The usage line at :9 lists the new flag.
      `npx prettier --check docs/releasing.md` is no worse than on main.
- [ ] `npm run verify` passes.

## Out of scope
- Anything under `e2e/**` (no new SKIP lines or runner changes; parse what `run.ts` already prints).
- Root `package.json` and `scripts/test/ci-workflow.test.mjs` (task 153).
- `docs/testing.md` and every other doc except docs/releasing.md (scribe).
- Running the real release or a live e2e run.
- Changing what the image suites test.

## Review round 1 — findings

1. **[P3] A `reset()` helper does nothing.** scripts/test/release.test.mjs:324-327, and its call at :382: `beforeEach` already gives every test a fresh repo. Delete both.
2. **[NOTE, do it] The stub ignores `FAIL_GATE` on the v14 gate.** In scripts/test/release.test.mjs:48-51 the stub `npm` no longer honours `FAIL_GATE` for `run test:e2e -- --foundry v14`. Restore it, so a future test can fail the v14 gate.

## Amendment 1 — owner decision (Andrew, 2026-10-19)

**Owns** gains:
- scripts/test/docker-release.test.mjs (limited to its stub `npm`, the `stub` string at :38-46)

That stub must print passing summary lines for the three image suites (`upload`, `image-assign`,
`image-view`) on both e2e gates (`run test:e2e -- --foundry v14` and the v13 run), in the same
`  <suite>: <n> passed, 0 failed, 0 skipped` form that the stub in scripts/test/release.test.mjs
already prints. The tests in docker-release.test.mjs must keep running with the image check on:
do not add `--allow-skipped-image` to their `release([...])` calls, and do not change the tests
themselves.

Added acceptance:
- [ ] `node --test scripts/test/docker-release.test.mjs` passes with no change outside its stub.

Reason: the stub prints no image suite lines, so 152's new skip gate aborts the release with
`e2e v14 image suites skipped` before it reaches the docker step these tests exercise.

## Verify attempt 1 — failed

1. scripts/test/docker-release.test.mjs:88-98 ("builds and tags the image locally and pushes
   nothing", assertion at :91): exit status non-zero; the release stops at
   `gate failed: e2e v14 image suites skipped: upload, image-assign, image-view` and never runs
   `docker build`.
2. scripts/test/docker-release.test.mjs:100-105 ("fails the release when the image build fails",
   assertion at :104): stderr has the image-suite skip abort, not `docker build failed`.

Fix: Amendment 1 above.
