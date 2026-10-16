# 145 — Run CI safely on pull requests, including from forks

**Repo:** .
**Depends on:** none
**Owns:**
- .github/workflows/ci.yml
- scripts/test/ci-workflow.test.mjs

**Status:** Part of the go-public set (140-148), planned 2026-10-16. Andrew's decision 8 asked
whether fork CI belongs in this set: it does. Contributors need checks on their PRs from day one,
CONTRIBUTING.md (140) promises them, and the change is two files with no overlap. Task 81 limited
CI to tags and manual dispatch while the repo was private (Actions minutes); public repos run
standard runners free, so that reason lapses.

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
- [ ] A `concurrency` group keyed on the workflow and PR number (or ref) with
      `cancel-in-progress: true` for pull requests only, so tag builds and `main` pushes are never
      cancelled.
- [ ] ci-workflow.test.mjs is updated to assert the new trigger set, the forbidden triggers, the
      secret-free test job, the persist-credentials setting and the unchanged image gate; its
      other assertions still pass unchanged.
- [ ] `npm run verify` exits 0.

## Out of scope

- The image job's steps, tags, registry and platforms.
- Repository settings (an owner action, listed in 148): "Require approval for first-time
  contributors" for fork workflows, branch protection requiring the `test` check.
- Running live Foundry e2e in CI.
- Any other workflow (CodeQL, dependabot, release automation): not in this set.

## Owner questions

- CI triggers — Decided (owner, 2026-10-16): run on pull requests (forks included, no secrets,
  never `pull_request_target`), on push to `main`, and on `v*` tags. The image job stays
  tag-only.
