# 145 — Run CI safely on pull requests, including from forks

**Repo:** .
**Depends on:** none
**Owns:**
- .github/workflows/ci.yml
- scripts/test/ci-workflow.test.mjs

**Status:** Part of the go-public set (140-148), planned 2026-10-16. Andrew's decision 8 asked
whether fork CI belongs in this set: it does. Contributors need checks on their PRs from day one,
CONTRIBUTING.md (140) promises them. Task 81 limited CI to tags and manual dispatch while the
repo was private (Actions minutes); public repos run standard runners free, so that reason lapses.

**Sequencing (Amendment 1):** 145 has no dependencies and is in the first wave. Task 140 depends
on 145: 140 adds files under `.github/` that this task's test must allowlist, so 140 can be
implemented in parallel but merges after 145.

## Goal

Every pull request to `main`, from a branch or a fork, runs `npm run verify` with a read-only token
and no secrets, and nothing a PR does can publish an image or write to the repo. Tag pushes keep
building and pushing the GHCR image exactly as today.

## Context

- .github/workflows/ci.yml:1-60 — triggers `push: tags: ['v*']` and `workflow_dispatch`; top-level
  `permissions: contents: read`; `test` job runs `npm ci` and `npm run verify`; `image` job is gated
  on `github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v')` and is the only job
  with `packages: write`.
- scripts/test/ci-workflow.test.mjs:26-40 — asserts exactly the two triggers and forbids
  `pull_request`, `pull_request_target`, `schedule`, `release`, `branches`; :42-49 permissions;
  the rest pins step order and the image job.
- GitHub semantics to rely on: `pull_request` from a fork runs with a read-only `GITHUB_TOKEN` and
  no repository secrets; `pull_request_target` runs in the base repo's context with secrets and
  must not be used.

## Acceptance

- [ ] `on:` has exactly these triggers (decided, owner 2026-10-16): `pull_request` with
      `branches: [main]` (forks included), `push` with `branches: [main]` and `tags: ['v*']`, and
      the existing `workflow_dispatch`. The test asserts this exact set.
- [ ] No `pull_request_target`, `workflow_run`, `issue_comment` or `schedule` trigger
      (test asserts each is absent).
- [ ] Top-level `permissions: contents: read` unchanged; the `test` job declares no permissions and
      uses no `secrets.` reference; `rg -n 'secrets\.' .github/workflows/ci.yml` shows only the
      image job's `GITHUB_TOKEN` login.
- [ ] The `image` job's `if:` is unchanged, so it stays tag-only: it is skipped for
      `pull_request`, for `push` to `main` and for `workflow_dispatch` (test asserts the exact
      condition string `github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v')`).
- [ ] `actions/checkout` in the `test` job sets `persist-credentials: false`.
- [ ] ci.yml has exactly one top-level `concurrency` block, with exactly these two lines and no
      job-level `concurrency`, so pull requests cancel superseded runs and tag builds and `main`
      pushes are never cancelled:
      ```yaml
      concurrency:
        group: ${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}
        cancel-in-progress: ${{ github.event_name == 'pull_request' }}
      ```
- [ ] ci-workflow.test.mjs is updated to assert the new trigger set, the forbidden triggers, the
      secret-free test job, the persist-credentials setting and the unchanged image gate.
- [ ] In ci-workflow.test.mjs's "sets timeouts and never cancels tag runs" test (currently
      :158-163), the two bans `assert.doesNotMatch(wf, /^\s*concurrency:/m)` and
      `assert.doesNotMatch(wf, /cancel-in-progress:/)` are replaced by assertions that `concurrency:`
      occurs exactly once in the file, at column 0; that the `group:` value is exactly
      `${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}`; and that
      `cancel-in-progress:` occurs exactly once with the exact value
      `${{ github.event_name == 'pull_request' }}` (so a literal `true` fails the test). The two
      timeout assertions in that test are unchanged.
- [ ] The "is the only file under .github" test (currently :171-176) is replaced by one that
      collects every file under `.github/` recursively as a POSIX path relative to `.github/`
      (not the bare basename) and asserts that the list contains `workflows/ci.yml` and that
      every entry is in exactly this allowlist (a constant in the test, sorted):
      `ISSUE_TEMPLATE/bug_report.yml`, `ISSUE_TEMPLATE/config.yml`,
      `ISSUE_TEMPLATE/feature_request.yml`, `pull_request_template.md`, `workflows/ci.yml`.
      This is task 140's file list exactly. The test passes both before 140 merges (only
      `workflows/ci.yml`) and after. Adding `.github/FUNDING.yml`, a second workflow (any other
      file under `workflows/`), or any other file under `.github/` fails it; the PR shows this by
      temporarily adding `.github/FUNDING.yml` and `.github/workflows/x.yml` locally and quoting
      the two failures.
- [ ] Apart from the trigger, permission, persist-credentials and image-gate assertions above and
      the two edits just listed, every other assertion in ci-workflow.test.mjs is unchanged
      (`git diff` on that file touches no other `it(...)` block).
- [ ] `npm run verify` exits 0.

## Out of scope

- The image job's steps, tags, registry and platforms.
- Repository settings (an owner action, listed in 148): "Require approval for first-time
  contributors" for fork workflows, branch protection requiring the `test` check.
- Running live Foundry e2e in CI.
- Any other workflow (CodeQL, dependabot, release automation): not in this set.
- The issue templates and PR template themselves (task 140); this task only allowlists their paths.

## Owner questions

- CI triggers — Decided (owner, 2026-10-16): run on pull requests (forks included, no secrets,
  never `pull_request_target`), on push to `main`, and on `v*` tags. The image job stays
  tag-only.

## Amendments

### Amendment 1 (from external PR review, 2026-10-16)

- [P1] The acceptance required a PR-only `cancel-in-progress` concurrency group but also said the
  test's other assertions "still pass unchanged", while ci-workflow.test.mjs:161-162 bans
  `concurrency:` and `cancel-in-progress:` outright. Following the plan, `npm run verify` failed.
  Replaced with explicit edits: the bans become an assertion of the exact concurrency block this
  task adds (group on workflow plus PR number or ref; cancel only when the event is
  `pull_request`).
- [P1] ci-workflow.test.mjs:171-175 asserts `ci.yml` is the only file under `.github`, so task
  140's issue and PR templates could never pass verify. This task (which owns the test) replaces
  it with an exact relative-path allowlist matching 140's file list; `FUNDING.yml` and any second
  workflow still fail. Task 140 now depends on 145 and merges after it.

### Amendment 2 (owner, 2026-10-16, from review round 1)

The concurrency group becomes `${{ github.workflow }}-${{ github.event.pull_request.number || github.sha }}` (was `|| github.ref`). Reason (review NOTE): with a per-ref group, GitHub keeps one running and one pending run per group, so a burst of main pushes A, B, C lets C replace B's pending run and commit B gets no CI result. Keyed per commit, every main push, tag and manual run has its own group and is never cancelled; PRs still cancel superseded runs (same PR number, `cancel-in-progress` true only for pull_request). The test pins the new exact group string.
