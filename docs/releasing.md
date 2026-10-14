# Releasing

A release is one local command. GitHub Actions runs only the tests and, on a version tag,
publishes the server-mode image (see "Publishing the image"). Quench and remote OAuth
conformance are not gates yet.

```
npm run release -- <version> [--allow-missing-v13] [--publish-npm] [--push-image]
```

## What the script does

1. Refuses to start on a dirty tree or on any branch except `main`.
2. Runs `scripts/bump-version.mjs <version>`: root, `protocol`, `module` and `gateway`
   `package.json`, `package-lock.json`, `module.json` (`version` and the `download` tag) and
   `gateway/mcpb/manifest.json`, and `GATEWAY_VERSION` in `gateway/docker/.env.example`. `npm run bump-version -- --check` reports any that disagree.
3. Runs the gates in order, aborting on the first failure: `npm run verify`
   (which already runs the script tests), `npm run test:scripts` (run again as its own gate), `npm run test:conformance` (must print
   `conformance: ok (inspector <v>, stdio, http)`), `npm run test:e2e -- --foundry v14`,
   `npm run test:e2e -- --foundry v13`. A v13 `SKIP:` line counts as absent and aborts unless
   `--allow-missing-v13` is passed; the summary then says so.
4. Builds `agent-gateway.zip`, `foundry-agent-gateway-<version>.tgz` and
   `foundry-agent-gateway.mcpb` into `dist/release/` and prints each SHA-256.
5. Builds and tags the server-mode image locally as `foundry-agent-gateway:<version>` with
   `docker build -f gateway/Dockerfile`. This needs a running Docker daemon whenever
   `gateway/Dockerfile` exists. Nothing is pushed.
6. Prints the planned actions and `Ask Foundry checklist: N of 6 answered`, then asks for `yes`.
   Any other answer exits 0 having uploaded nothing.
7. After `yes`: `gh release create v<version> --draft` with the zip, `module.json` and `.mcpb`
   (notes carry the line "Platforms: macOS verified; Windows untested in this release"), then
   `npm publish -w gateway --dry-run`.
8. A real `npm publish` happens only with `--publish-npm` and a second typed confirmation,
   `publish foundry-agent-gateway@<version>`.

`--push-image` is still refused with "registry not configured"; the script never pushes the
image. GHCR is the registry, and the tag workflow below does the pushing.

The script never publishes the draft, never tags and never pushes. The version bump is left
uncommitted: commit it on a branch and open a PR for Andrew. Land ONLY that version-bump PR
before publishing the draft. If anything else lands on `main` first, re-run the release,
because the tag is created from `main`'s HEAD at publish time.

A declined or aborted run leaves the bumped tree dirty. Reset it with `git checkout -- .`
before retrying.

## Publishing the image

`.github/workflows/ci.yml` builds and pushes the image when a `v*` tag is pushed. It runs the
tests first and checks that the tag matches the repo version, so bump the version on `main`
(the release PR) before tagging. To publish by hand:

```
git tag v<version> <commit on main>
git push origin v<version>
```

Publishing the v0.1.0 draft GitHub release creates the `v0.1.0` tag and so triggers the push of
`0.1.0`, `0.1` and `latest` (plus `sha-*`) to `ghcr.io/aindriub/foundry-agent-gateway`. A
prerelease tag such as `v0.1.0-rc.1` gets its exact version and `sha-*` but never `latest`.
The image is multi-arch (amd64, arm64); the extra `unknown/unknown` entries in
`docker buildx imagetools inspect` are provenance attestations and are expected.

The package is private. To pull it on a VPS, run `docker login ghcr.io` with a GitHub token
that has `read:packages`. Both Compose files in `gateway/docker/` pull
`ghcr.io/aindriub/foundry-agent-gateway:${GATEWAY_VERSION}` by default, and `bump-version` keeps
`GATEWAY_VERSION` in `.env.example` at the repo version. Pulls fail until v0.1.0 is published;
use `docker compose up -d --build` until then.

## Stops that need Andrew's explicit go-ahead

- Publishing the draft GitHub release.
- `npm publish` (the real one).
- The Foundry package listing.

## Manifest URL

`module.json` `manifest` points at `releases/latest/download/module.json`. That URL only
resolves once a release is published; a draft does not count. Until then the Foundry install
by manifest URL fails with a 404.

## Before Foundry submission

The first listing waits until all six questions are answered. Record each answer, the date and
the source (a link or a quote of the reply). The release script counts a question as answered
when its `Answer` line is not blank.

### 1. May paid packs be sold outside Premium Content while the core is listed?
- Answer:
- Date:
- Source:

### 2. What is the Premium Content fee, and do code-only modules fit it?
- Answer:
- Date:
- Source:

### 3. Does each pack need the "AI Tools" tag and its own attestation?
- Answer:
- Date:
- Source:

### 4. Do agents reading compendium or game-system data trip the other-modules context rule?
- Answer:
- Date:
- Source:

### 5. Is minified or obfuscated code acceptable in premium packs?
- Answer:
- Date:
- Source:

### 6. What consent UI satisfies the runtime-code rule for agent-run macros?
- Answer:
- Date:
- Source:
