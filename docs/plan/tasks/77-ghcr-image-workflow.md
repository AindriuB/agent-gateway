# 77 — Build the gateway image in GitHub Actions and push it to GHCR

**Repo:** .
**Depends on:** none
**Status:** Requested by Andrew on 2026-10-14. Written against main 7c138f3. This is the repo's first CI: there is no `.github/` today. Before merging, Andrew confirms that GitHub Actions can run on this private repo. The spec (docs/plan/specs/2026-10-09-agent-gateway.md:292,295) and task 41 still say Actions is blocked by billing.
**Owns:**
- .github/workflows/ci.yml (new; the only workflow file)
- scripts/test/ci-workflow.test.mjs (new)

## Goal
Add one GitHub Actions workflow with a test gate on every pull request to `main`, every push to `main` and every `v*` tag. A `v*` tag also builds the server-mode image from `gateway/Dockerfile` for linux/amd64 and linux/arm64 and pushes it to the private GHCR package `ghcr.io/aindriub/foundry-agent-gateway`. The push happens only if the gate passes and the tag matches the repo version. The local release script stays local-only. This workflow is the only path that pushes an image.

## Context
- **Andrew's decisions (2026-10-14):**
  - Triggers: `pull_request` (to `main`), `push` to `main`, and `push` of tags `v*`. Only a tag push publishes an image.
  - Gate: `npm run verify` and `npm run test:scripts`. Never run the live e2e or conformance suites, because they need a Foundry server and GM approval.
  - Platforms: linux/amd64 and linux/arm64, built with buildx and QEMU.
  - Auth: the built-in `GITHUB_TOKEN` only, with no PAT and no other secret.
  - Visibility: the package stays private until MVP B is done. It is linked to the repo through `org.opencontainers.image.source`.
- **Tags:** from `vX.Y.Z`, push `X.Y.Z`, `X.Y`, `sha-<short>` and `latest`. A prerelease tag (one with `-`, for example `v0.1.0-rc.1`) pushes only `X.Y.Z-pre` and `sha-<short>`, with no `X.Y` and no `latest`. docker/metadata-action does this with `type=semver,pattern={{version}}`, `type=semver,pattern={{major}}.{{minor}}` (skipped for prereleases), `type=sha` (default prefix `sha-`, short form) and `flavor: latest=auto`. Do not add a `{{major}}`-only tag: at 0.x it would move on every minor release.
- **Version check:** scripts/bump-version.mjs:2,10,85-90. `--check <version>` fails unless the root package, every workspace and `module.json` all carry exactly that version, and it rejects a value that is not semver. scripts/release.mjs:61-65 relies on the same script. The workflow runs `node scripts/bump-version.mjs --check "${GITHUB_REF_NAME#v}"` and does not reimplement the check.
- **Local image tooling:**
  - scripts/release.mjs:44-45 refuses `--push-image` with "registry not configured", and :110-125 builds `foundry-agent-gateway:<version>` locally and never pushes.
  - docs/releasing.md:23-37 describes this.
  - docs/plan/done/42-docker-image.md: the registry was left unchosen.

  This task does not touch release.mjs. See Out of scope.
- **Build context:**
  - gateway/Dockerfile:1-3 is built from the repo root with `-f gateway/Dockerfile`.
  - gateway/Dockerfile.dockerignore is the allowlist that BuildKit reads for that file: root `package.json`, `package-lock.json`, `tsconfig.base.json`, `protocol/`, `module/package.json` and `gateway/`. All of these are committed, so a plain checkout is a complete context and nothing needs to be generated first.
  - Use a path context (`context: .` after `actions/checkout`), not build-push-action's default Git context, so that the dockerignore and the checked-out tree are what gets built.
- **Node:**
  - There is no `.nvmrc`.
  - `engines.node` is `>=22.13` (package.json:12-13, gateway/package.json:13-14), and the image uses `node:22-slim` (gateway/Dockerfile:6,16,25).
  - Use `node-version: '22'` in setup-node, which meets the engines range and matches the image.
  - Do not use `node-version-file: package.json`: setup-node would resolve the open range to the newest Node.
- **Gate commands:**
  - package.json:20 is `verify` (build, lint, test, test:slow), and package.json:23 is `test:scripts` (`node --test scripts/test/*.test.mjs`).
  - The script tests create temp git repos and pass their own `-c user.name/-c user.email` (scripts/test/release.test.mjs:98), so the runner needs no git identity.
  - They call `unzip` (scripts/test/pack-module.test.mjs:82), which `ubuntu-latest` already has.
  - Run `npm ci` before both commands.
- **Pins:** docs/conventions.md sets no rule for actions. Pin each action to its current major tag (`@vN`), never to a branch. The actions are actions/checkout, actions/setup-node, docker/setup-qemu-action, docker/setup-buildx-action, docker/login-action, docker/metadata-action and docker/build-push-action.
- **Static test style:**
  - scripts/test/docker-byo-caddy.test.mjs and scripts/test/build-mcpb.test.mjs use `node:test` with `node:assert/strict` and read repo files directly.
  - The repo has no YAML parser dependency. Do not add one: `package.json` and `package-lock.json` are shared files (docs/conventions.md, "Shared insertion-only files").
  - Write the workflow in a plain one-key-per-line form, so that text and regex assertions on it are unambiguous.
- **Task 41 (open, deferred beyond B)** owns scripts/release.mjs, scripts/bump-version.mjs and docs/releasing.md. Its Owns do not overlap 77's, and its Out of scope already excludes the Docker image. 77 only calls `bump-version.mjs --check` and edits neither file. When 41 is re-scoped, it should point `--push-image` at this workflow instead of the "registry not configured" refusal.
- **Existing draft release:**
  - `gh release list` shows the draft "Agent Gateway 0.1.0" for `v0.1.0`. `git ls-remote --tags origin` shows no tags on the remote (checked 2026-10-14).
  - Publishing that draft creates tag `v0.1.0` on the draft's target, which is `main` at publish time. With this workflow on `main`, that tag runs the workflow and, if the gate passes, publishes `0.1.0`, `0.1`, `latest` and `sha-<short>` to GHCR.
- **PR flow:** the ccd PR for this task is the first CI run in the repo. The PR page shows the `test` job running, and the `image` job is skipped because the ref is not a tag. Andrew sees the gate pass or fail on the PR itself, before anything can push.

## Acceptance
- [ ] `.github/workflows/ci.yml` is the only file under `.github/`. Its `on:` has exactly three triggers: `pull_request` with `branches: [main]`, `push` with `branches: [main]`, and `push` with `tags: ['v*']`. It has no `workflow_dispatch`, `pull_request_target`, `schedule` or `release` trigger.
- [ ] Top-level `permissions:` is exactly `contents: read`. Only the `image` job sets `packages: write`, and it sets `contents: read` with it. No job sets `write` on any other scope.
- [ ] The `test` job runs on `ubuntu-latest`. It checks out, sets up Node with `node-version: '22'` (npm cache allowed), runs `npm ci`, then `npm run verify`, then `npm run test:scripts`. The workflow mentions no `test:e2e`, `e2e.sh`, `test:conformance` or `conformance.sh`.
- [ ] The `image` job has `needs: test` and `if: startsWith(github.ref, 'refs/tags/v')`. On a PR or a push to `main`, it shows as skipped and nothing logs in to a registry.
- [ ] In the `image` job, before any login or build step, a step runs `node scripts/bump-version.mjs --check "${GITHUB_REF_NAME#v}"`. A tag whose version differs from package.json fails the job, and no image is pushed.
- [ ] No `run:` block interpolates a `${{ ... }}` expression. Values reach shell steps only through `env:` or the runner's own variables, such as `GITHUB_REF_NAME`.
- [ ] The image job:
  - sets up QEMU and buildx;
  - logs in to `ghcr.io` with `username: ${{ github.actor }}` and `password: ${{ secrets.GITHUB_TOKEN }}`;
  - builds with docker/build-push-action, using `context: .`, `file: gateway/Dockerfile`, `platforms: linux/amd64,linux/arm64` and `push: true`, with tags and labels taken from the metadata step's outputs.
- [ ] The metadata step:
  - has `images: ghcr.io/aindriub/foundry-agent-gateway`, all lowercase;
  - has exactly the tag rules `type=semver,pattern={{version}}`, `type=semver,pattern={{major}}.{{minor}}` and `type=sha` (prefix `sha-`);
  - has no `type=raw` rule and no literal `latest` tag;
  - has `flavor` `latest=auto`, or leaves it at that default.
- [ ] The only `secrets.` reference in the workflow is `secrets.GITHUB_TOKEN`.
- [ ] Every `uses:` is pinned to a major tag matching `@v\d+$`. None is pinned to a branch such as `@main` or `@master`.
- [ ] Each job sets `timeout-minutes`: at most 30 for `test` and at most 60 for `image`. A `gha` build cache is allowed. Any `concurrency` group must not cancel tag runs.
- [ ] `scripts/test/ci-workflow.test.mjs` asserts every item above against the workflow text:
  - the triggers, and the absence of the forbidden ones;
  - the permissions;
  - the gate commands, and that no e2e or conformance command appears;
  - `needs` and `if` on the image job;
  - the version-check step, and that it comes before the login step;
  - that no `${{` appears inside a `run:` block;
  - the platforms, image name and tag rules, with no `type=raw` and no `latest`;
  - `secrets.GITHUB_TOKEN` as the only secret;
  - the `@vN` pins;
  - that `node-version` agrees with the `FROM node:<major>` lines in `gateway/Dockerfile`.

  The test reads files only and adds no dependency.
- [ ] `npm run verify` and `npm run test:scripts` pass locally. The new test is picked up by the existing `scripts/test/*.test.mjs` glob, so package.json does not change.
- [ ] On the task's PR, the `test` job runs and passes, and the `image` job is skipped. This is the repo's first CI run, so paste the run URL into the PR description.
- [ ] **Manual check (Andrew, after merge):**
  1. From up-to-date `main`, create a scratch commit that only runs `npm run bump-version -- 0.1.0-rc.1`. Do not push it to `main`.
  2. Tag that commit `v0.1.0-rc.1` and push only the tag: `git push origin v0.1.0-rc.1`.
  3. In the Actions tab, `test` then `image` both pass.
  4. On the profile's Packages page, `foundry-agent-gateway` exists, is **Private**, and is linked to `AindriuB/agent-gateway`.
  5. Its versions are `0.1.0-rc.1` and `sha-<short>`, with no `latest` and no `0.1`.
  6. After `docker login ghcr.io` with a classic PAT that has only `read:packages`, `docker buildx imagetools inspect ghcr.io/aindriub/foundry-agent-gateway:0.1.0-rc.1` lists `linux/amd64` and `linux/arm64`.
  7. Optional negative check: a throwaway tag `v0.1.0-rc.2` on unmodified `main` (version 0.1.0) fails at the version-check step, and no `0.1.0-rc.2` appears in the package.

  Afterwards, delete the rc tags from the remote. Keep or delete the rc package versions as Andrew prefers.

## Docs (scribe, at record time; not the implementer)
- docs/releasing.md:
  - Add a "Publish the server image" section. It covers how to bump and merge the version, then tag `vX.Y.Z` on `main` and push the tag, and which tags each kind of tag produces.
  - State that the first push creates a **private** package linked to the repo through `org.opencontainers.image.source`, and that it stays private until MVP B is done.
  - State that publishing the v0.1.0 draft creates the `v0.1.0` tag and therefore publishes the image.
  - Explain how to pull the private image on the VPS: create a classic PAT with only `read:packages`, run `docker login ghcr.io -u <user> --password-stdin`, then `docker pull ghcr.io/aindriub/foundry-agent-gateway:<version>`. The token stays on the VPS and never goes into a doc or `.env.example`.
  - Replace the "registry not configured" paragraph (:34-35) with a pointer to the workflow. release.mjs still refuses `--push-image`.
- docs/plan/specs/2026-10-09-agent-gateway.md:292,295: the registry is now GHCR, and Actions is available for the tag build.

## Out of scope
- scripts/release.mjs and its `--push-image` refusal, scripts/bump-version.mjs, and docs/releasing.md content. These belong to 41, 42 and the scribe.
- Switching gateway/docker/compose.yaml (:8, `image: foundry-agent-gateway:${GATEWAY_VERSION:-latest}`), compose.byo-caddy.yaml or gateway/docker/README.md to pull from GHCR. That is a follow-up for whoever next owns gateway/docker/.
- Building the image on PRs or on `main`, even without pushing. It is left out to save minutes on a private repo.
- Making the package or the repo public, Docker Hub, image signing, provenance or SBOM attestations, and release automation such as creating GitHub releases or `npm publish` from CI.
- Running e2e or conformance suites in CI, or adding a self-hosted runner.
- Adding `.nvmrc`, changing `engines`, or adding any dependency.

## Review round 1 — findings

- [P3] scripts/test/ci-workflow.test.mjs:77-82 — the version-check test only proves the command appears before login and build, not that it can fail the job. Adding `continue-on-error: true` or `if: false` to the "Check tag matches repo version" step (ci.yml:40) still passes the test. route: implementer. Assert the image job has no `continue-on-error` and that the check step has no `if:`, and confirm both mutations fail.
- [P3, cheap] scripts/test/ci-workflow.test.mjs:145 — a `concurrency` block with `cancel-in-progress: ${{ true }}` (or any expression) gets past the regex. route: implementer. Tighten it so the mutation fails.
- [P3, cheap] .github/workflows/ci.yml:67-68 — the `type=gha` build cache was not in the spec, and it almost never hits: a tag run can restore only from its own tag ref and from main, and main never builds the image. With `mode=max` it fills cache quota that nothing reads. route: implementer. Remove the cache-from and cache-to lines, and update the test if it references them.
- [NOTE for Andrew, no change] build-push-action@v6 adds a provenance attestation by default, so `imagetools inspect` shows `unknown/unknown` entries next to amd64 and arm64 and GHCR shows extra untagged entries. Expected; out of scope.

## Review round 2 — findings

- [P3] scripts/test/ci-workflow.test.mjs:82 — the version-check assertion is a substring match, so appending `|| true` to the run line (ci.yml:41) still passes, and a mismatched tag would push. route: implementer. Anchor the whole line, e.g. `/^ {8}run: node scripts\/bump-version\.mjs --check "\$\{GITHUB_REF_NAME#v\}"$/m` within the step, and confirm the `|| true` mutation fails.
- [P3] scripts/test/ci-workflow.test.mjs:149 — a top-level `concurrency: group: ci` with no `cancel-in-progress` still lets GitHub cancel a pending tag run when newer runs queue. route: implementer. Assert there is no `concurrency:` key at all (`/^\s*concurrency:/m`), and confirm by mutation.

### Residuals

- A regex static test cannot catch every way to defeat the workflow's gates; the PR review of ci.yml changes remains the main guard.
