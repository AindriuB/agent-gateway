# 81 — Run CI only on release tags and on demand

**Repo:** .
**Depends on:** none
**Status:** Requested by Andrew on 2026-10-14. Written against main 7b659c3, which has tasks 77 and 80 merged.
**Owns:**
- .github/workflows/ci.yml (the `on:` block and the `image` job's `if:` line only)
- scripts/test/ci-workflow.test.mjs

## Goal
Save GitHub Actions minutes. In Andrew's words: "we should verify locally, and only run the full test when creating a release". The workflow stops running on pull requests and on pushes to `main`. It runs on `v*` tag pushes, where the test job still gates the image job, and on a manual `workflow_dispatch`, which runs only the test job. Local `npm run verify` is the gate for every PR (PROJECT.md rule 9).

## Context
- **Current triggers:** .github/workflows/ci.yml:3-8 has `pull_request` (branches `[main]`) and `push` with `branches: [main]` and `tags: ['v*']`. The target is:

  ```yaml
  on:
    push:
      tags: ['v*']
    workflow_dispatch:
  ```

  Write `workflow_dispatch:` with no value and no `inputs:`, in the same one-key-per-line style that task 77 used so the regex test stays unambiguous.
- **Image job guard:** ci.yml:28 is `if: startsWith(github.ref, 'refs/tags/v')`. That check alone is not enough. The "Run workflow" button lets the user pick a tag as the ref, and a manual run on `v0.1.0` has `github.ref == 'refs/tags/v0.1.0'`, so the image job would build and push. Make the line `if: github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v')`. This keeps the tag check and makes the image job tag-push-only. To retry a failed publish, use "Re-run jobs" on the original tag run. A re-run keeps the original event, so it still publishes.
- **Everything else from 77 and 80 stays:**
  - top-level `contents: read`, and `packages: write` only in `image`;
  - no `${{ }}` in `run:`;
  - the version check before login;
  - the metadata tag rules, platforms, `@vN` pins and timeouts;
  - no `concurrency`;
  - the test job's steps (checkout, setup-node 22, `npm ci`, `npm run verify`).

  See docs/plan/done/77-ghcr-image-workflow.md (Acceptance) and docs/plan/done/80-verify-runs-script-tests.md.
- **Static test:** scripts/test/ci-workflow.test.mjs:26-38.
  - :28-31 asserts exactly `pull_request` and `push` with `branches: [main]`.
  - :34 forbids `workflow_dispatch`.
  - :79 anchors the image `if:` line.

  These three places change. Every other assertion in the file stays word for word.
- **Branch protection:** checked on 2026-10-14. `main` has no protection rule and no ruleset, so no required status check is waiting for a PR run that will never come.
- **Known flake:** `gateway/test/events/repository.test.ts:38` takes about 19s on ubuntu-latest against a 15s timeout, and it failed the v0.1.0-rc.1 tag run (docs/plan/PLAN.md:37). After this task it can only hit tag runs and manual runs. A failure there blocks a publish, so it still matters. This task does not fix it.

## Acceptance
- [ ] The `on:` block of `.github/workflows/ci.yml` is exactly `push:` with `tags: ['v*']` and nothing else under it, followed by `workflow_dispatch:` with no value and no child keys. It has no `pull_request`, `pull_request_target`, `schedule`, `release` or `branches`.
- [ ] The `image` job's `if:` is exactly `github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v')`, and `needs: test` is unchanged.
- [ ] `git diff origin/main -- .github/workflows/ci.yml` touches only lines 3-8 (the `on:` block) and the `image` job's `if:` line.
- [ ] scripts/test/ci-workflow.test.mjs asserts:
  - the `on:` top-level keys are exactly `['  push:', '  workflow_dispatch:']`;
  - `push` has exactly one child line, `tags: ['v*']`, and no `branches`;
  - `workflow_dispatch:` is followed by no more-indented line, so it has no `inputs`;
  - none of `pull_request`, `pull_request_target`, `schedule`, `release` or `branches:` appears in `on:`;
  - the image `if:` is anchored to the full new line.

  Every other `it(...)` in the file is unchanged (`git diff` shows changes only inside the "ci.yml triggers" describe and the image job's `if` assertion).
- [ ] Mutation check, recorded in the PR. Each mutation below, applied to ci.yml on its own, makes `node --test scripts/test/ci-workflow.test.mjs` fail, and reverting it makes the test pass:
  1. adding `pull_request:` with `branches: [main]` back;
  2. adding `branches: [main]` under `push`;
  3. removing `workflow_dispatch:`;
  4. adding `inputs:` with one input under `workflow_dispatch`;
  5. adding `schedule:` with a cron line;
  6. dropping `github.event_name == 'push' && ` from the image `if:`;
  7. replacing `tags: ['v*']` with `tags: ['*']`.
- [ ] `npm run verify` passes locally, and its output includes the `node --test` summary for the script tests.
- [ ] The PR for this task triggers no workflow run: its Checks tab is empty and `gh run list --branch claude/task-81` returns nothing. This proves the trigger change, because for `pull_request` events GitHub reads the workflow from the PR's own merge ref.
- [ ] **Manual (Andrew, after merge):**
  1. The merge to `main` starts no run (`gh run list --branch main --limit 1` shows no new run).
  2. In Actions → ci → "Run workflow" on `main`, the run shows `test` running and `image` skipped.
  3. Optional: run the workflow again with a `v*` tag selected as the ref. `image` is still skipped.

## Docs (scribe, at record time; not the implementer)
- docs/releasing.md:3-4 should say that GitHub Actions runs only on `v*` tags (tests, then the image) and on demand from "Run workflow" (tests only), and never on PRs or on `main`. Local `npm run verify` is the PR gate.
- docs/releasing.md "Publishing the image" (:48-50): add one sentence saying that "Run workflow" on a branch or tag only runs the tests and never publishes, and that a failed publish is retried with "Re-run jobs" on the tag run.
- docs/conventions.md: no line mentions CI today (checked with `rg -i 'ci|workflow'`), so no change is needed. Re-check at record time.
- docs/plan/PLAN.md:37 flake follow-up: note that it now affects only tag and manual runs.
- Do not edit docs/plan/done/77-ghcr-image-workflow.md, because done files are history. Record in 81's Outcome that 77's trigger set (PR, push to `main`, tags) has been replaced.

## Out of scope
- The `test` job's steps, the `image` job's steps, permissions, pins, metadata rules and timeouts.
- Fixing the repository.test.ts:38 flake or any vitest timeout.
- package.json, scripts/release.mjs, and the double `test:scripts` run in a release (task 80, residual).
- Branch protection, rulesets, required checks or any repo setting.
- A path filter, a `workflow_dispatch` input such as a "publish" toggle, or any second workflow file.
