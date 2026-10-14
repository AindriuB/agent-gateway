# 78 — Pull the GHCR image in both Compose files by default

**Repo:** .
**Depends on:** none
**Status:** Requested by Andrew on 2026-10-14. Written against main 72561f9 (75, 76 and 77 merged, CI live). Closes the "Follow-up from 77" item in docs/plan/PLAN.md:36. No `v*` tag has been pushed yet, so no image exists in GHCR until the v0.1.0 release is published.
**Owns:**
- gateway/docker/compose.yaml
- gateway/docker/compose.byo-caddy.yaml
- gateway/docker/.env.example
- gateway/docker/README.md
- scripts/test/docker-byo-caddy.test.mjs
- scripts/test/docker-release.test.mjs

## Goal
Both Compose files should run the image that CI publishes, `ghcr.io/aindriub/foundry-agent-gateway:${GATEWAY_VERSION}`, so a VPS no longer has to build from source. Building from source must keep working for anyone who wants it, or for anyone using a version that has not been published. The README should explain how to log in to GHCR while the package is private, and how to pick a version.

## Context
- **Chosen shape: keep `build:` next to the new `image:`.** Do not add an override file. The reasons:
  - Building locally stays one flag, `docker compose up -d --build`. No third Compose file is needed, and `COMPOSE_FILE` stays free for the bring-your-own-Caddy switch (README "Bring your own Caddy", .env.example `#COMPOSE_FILE=`). An override would have to be chained as `COMPOSE_FILE=compose.byo-caddy.yaml:compose.build.yaml`, which is easy to get wrong.
  - The drift test already compares the `image` and `build` blocks of the two files (scripts/test/docker-byo-caddy.test.mjs:38-44), so it keeps covering both keys with no new machinery.
  - The cost: with `image` and `build` both set and the default `pull_policy`, Compose tries to pull first and builds only if the pull does not find the image. Whether a "denied" pull (private package, no login) also falls back to a build, or fails, depends on the Compose version. The README has to tell the reader to log in first, and must not promise either behaviour.
- **Image reference:** `image: ghcr.io/aindriub/foundry-agent-gateway:${GATEWAY_VERSION:?set GATEWAY_VERSION in .env}`.
  - Use the same `:?` form that DOMAIN, FOUNDRY_ORIGIN and ACME_EMAIL already use (gateway/docker/compose.yaml:16-17). Then the default lives only in .env.example and cannot drift from a second copy inside the Compose files.
  - Use the same string in both files, character for character.
  - The repository path must equal the `images:` value in .github/workflows/ci.yml (metadata-action step). Read ci.yml, but do not edit it.
- **GATEWAY_VERSION default:** `GATEWAY_VERSION=0.1.0`, the repo version (package.json:3) and the first tag the image job will publish (docs/releasing.md:57-60). There is no `latest` until a release exists. Pulls fail until v0.1.0 is published, and the README says to use `--build` until then.
- **Today's files:**
  - gateway/docker/compose.yaml:8-11 and compose.byo-caddy.yaml:8-11 hold `image: foundry-agent-gateway:${GATEWAY_VERSION:-latest}` plus `build:`.
  - gateway/docker/.env.example has no GATEWAY_VERSION line.
  - README "Start" (gateway/docker/README.md:16-24) and "Update" (:116-123) assume `--build`.
- **Private package:** docs/releasing.md:63-65 already describes `docker login ghcr.io` with a `read:packages` token. Follow its wording. Never put a token value in any file. Tell the reader to pass the token on stdin (`--password-stdin`).
- **Tests:**
  - scripts/test/docker-byo-caddy.test.mjs:38-44 is the drift test (`image`, `build`, `restart`, `environment` must be identical). Its `.env.example` test is at :74-84 and its README test at :86-110.
  - scripts/test/docker-release.test.mjs only covers the image step of scripts/release.mjs. Add the cross-file check there: the Compose image repository equals the ci.yml `images:` value.
- **The fast suite:** these are `node --test` script tests, run by `npm run test:scripts` and in CI.

## Acceptance
- [ ] Both gateway/docker/compose.yaml and compose.byo-caddy.yaml have exactly `image: ghcr.io/aindriub/foundry-agent-gateway:${GATEWAY_VERSION:?set GATEWAY_VERSION in .env}`, and still have a `build:` block with `context: ../..` and `dockerfile: gateway/Dockerfile`.
- [ ] `rg -n 'foundry-agent-gateway:\$\{GATEWAY_VERSION:-' gateway/docker` returns nothing. The old local-only image name and its `latest` default are gone.
- [ ] gateway/docker/.env.example has an uncommented `GATEWAY_VERSION=0.1.0` line, with a comment saying which tags exist (`X.Y.Z`, `X.Y`) and how to build locally (`docker compose up -d --build`). The word `latest` does not appear in .env.example.
- [ ] README "Start" shows `docker login ghcr.io -u <github-user> --password-stdin` with a `read:packages` token as a step that is needed while the package is private, then `docker compose pull` and `docker compose up -d`. It keeps `docker compose up -d --build` as the build-from-source alternative, and says to use it until v0.1.0 is published.
- [ ] README "Update" says to change `GATEWAY_VERSION` in `.env`, then `docker compose pull && docker compose up -d`. The parenthetical "once an image is published" at README.md:123 is gone.
- [ ] scripts/test/docker-byo-caddy.test.mjs asserts the new image line in both files, keeps the drift test over `image` and `build`, asserts `GATEWAY_VERSION=` in .env.example with no `latest`, and asserts that the README contains `ghcr.io`, `read:packages`, `--password-stdin`, `GATEWAY_VERSION` and `--build`.
- [ ] scripts/test/docker-release.test.mjs gains a test showing that the repository part of both Compose `image:` lines equals the `images:` value in .github/workflows/ci.yml.
- [ ] `npm run test:scripts` and `npm run verify` pass.
- [ ] Optional, if a Docker daemon is at hand: `docker compose -f gateway/docker/compose.yaml config` with a filled-in `.env` resolves the image to `ghcr.io/aindriub/foundry-agent-gateway:0.1.0`. Report the result. CI does not need it.

## Out of scope
- .github/workflows/ci.yml, package.json and scripts/test/ci-workflow.test.mjs belong to task 80. Read ci.yml only.
- scripts/release.mjs still tags its local build `foundry-agent-gateway:<version>`, a different name from the Compose image. Leave it alone and note the mismatch in the PR.
- These are scribe items, done at record time, not by the implementer:
  - the docs/server-mode.md pointers (for example :9-11, "the image built from gateway/Dockerfile");
  - docs/releasing.md:63-65 ("set the gateway service's image … in place of the local build");
  - removing the "Actions is blocked by billing" notes in docs/plan/specs/2026-10-09-agent-gateway.md:295-297 and docs/releasing.md. Actions runs on this private repo; first green CI was 2026-10-14, PR #128.
- Making the package public and pushing the first tag both need Andrew.


## Amendment 1 — Andrew, 2026-10-14

**Decisions**
1. **Pull or build: keep `image:` and `build:` side by side**, as the Context section already plans. Add no override file. The README tells the reader either to run `docker login ghcr.io` before `docker compose pull`, or to use `docker compose up -d --build`. It promises nothing about what happens when a pull is denied: no fallback to a build and no failure mode.
2. **Version pin: scripts/bump-version.mjs owns `GATEWAY_VERSION`.** A bump sets `GATEWAY_VERSION=<version>` in gateway/docker/.env.example, and `--check` counts that line as one more place that must agree. Then the Compose default cannot drift from the repo version, and the CI image job's `bump-version.mjs --check "${GITHUB_REF_NAME#v}"` (.github/workflows/ci.yml:41) also guards the pin.

**Owns additions**
- scripts/bump-version.mjs
- scripts/test/bump-version.test.mjs
- scripts/test/release.test.mjs (only the `copied` fixture list, at :23-33; insertions only)

The release.test.mjs entry is needed because of the bump-version change, not as extra scope. release.test.mjs:23-33 and docker-release.test.mjs:22-32 copy a fixed file list into a fixture root, and scripts/release.mjs:62 runs bump-version there. Once bump-version reads .env.example, both fixtures fail with "no version found" unless they also copy `gateway/docker/.env.example`. docker-release.test.mjs is already owned by this task.

**Context additions**
- scripts/bump-version.mjs:37-59 is the target table. Add one entry for `gateway/docker/.env.example`. Its regex must match only the uncommented line, anchored at the start of a line, e.g. `/^(GATEWAY_VERSION=)([^\n]*)()$/m`, and use the existing group 1/2/3 shape. Text edits keep the comments and every other line byte for byte.
- `--check` on main 320ed14 prints `all 14 places agree on 0.1.0`. After this change it prints 15.
- scripts/test/bump-version.test.mjs:16-24 is the `files` list that both `beforeEach` and the nested "still passes after a bump" run copy. Add `gateway/docker/.env.example` to it.
- **CI tag check:** release.mjs bumps the working tree and does not commit. The release commit that gets tagged (docs/releasing.md:53) therefore carries the bumped .env.example along with the other files, and `--check "<tag minus v>"` passes. The scratch tag `v0.1.0-rc.1` points at a commit whose .env.example has no `GATEWAY_VERSION` line. Re-running the image job on that tag would fail, but it was a one-off check and is not re-run. Do not move or delete it.
- **Task 80:** 80 owns package.json (`scripts.verify` only), the `test` job step in .github/workflows/ci.yml, and scripts/test/ci-workflow.test.mjs. None of these is in 78's Owns after this amendment, and 78 still only reads ci.yml. No new dependency edge.

**Acceptance additions**
- [ ] `node scripts/bump-version.mjs 9.8.7 --root <copy>` leaves exactly one line `GATEWAY_VERSION=9.8.7` in the copy's gateway/docker/.env.example and changes no other line of that file. bump-version.test.mjs asserts this in the "sets the version in every file" test.
- [ ] bump-version.test.mjs has a test that sets only the .env.example line to `0.0.1-stale`, and then `--check` exits non-zero with stderr matching `/\.env\.example.* is 0\.0\.1-stale/`.
- [ ] On the branch, `node scripts/bump-version.mjs --check` prints `all 15 places agree on 0.1.0` (14 on main 320ed14).
- [ ] The existing bump-version tests (bump-version.test.mjs:41-125), including the nested "still passes after a bump" run, pass unchanged apart from the added `files` entry and the added assertions.
- [ ] scripts/test/release.test.mjs and scripts/test/docker-release.test.mjs list `gateway/docker/.env.example` in `copied`, and both pass.
- [ ] `git diff main -- scripts/test/release.test.mjs` shows only that one inserted line.

**Out of scope additions**
- The docs/releasing.md:14-16 list of files that bump-version touches is a scribe item at record time: add gateway/docker/.env.example.
- The `v0.1.0-rc.1` scratch tag: leave it as it is.
- scripts/release.mjs: no change. It already runs bump-version over the whole root.
