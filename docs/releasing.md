# Releasing

A release is one local command. GitHub Actions is not used. Quench and remote
OAuth conformance are not gates yet.

```
npm run release -- <version> [--allow-missing-v13] [--publish-npm]
```

## What the script does

1. Refuses to start on a dirty tree or on any branch except `main`.
2. Runs `scripts/bump-version.mjs <version>`: root, `protocol`, `module` and `gateway`
   `package.json`, `package-lock.json`, `module.json` (`version` and the `download` tag) and
   `gateway/mcpb/manifest.json`. `npm run bump-version -- --check` reports any that disagree.
3. Runs the gates in order, aborting on the first failure: `npm run verify`,
   `npm run test:scripts`, `npm run test:conformance` (must print
   `conformance: ok (inspector <v>, stdio, http)`), `npm run test:e2e -- --foundry v14`,
   `npm run test:e2e -- --foundry v13`. A v13 `SKIP:` line counts as absent and aborts unless
   `--allow-missing-v13` is passed; the summary then says so.
4. Builds `agent-gateway.zip`, `foundry-agent-gateway-<version>.tgz` and
   `foundry-agent-gateway.mcpb` into `dist/release/` and prints each SHA-256.
5. Prints the planned actions and `Ask Foundry checklist: N of 6 answered`, then asks for `yes`.
   Any other answer exits 0 having uploaded nothing.
6. After `yes`: `gh release create v<version> --draft` with the zip, `module.json` and `.mcpb`
   (notes carry the line "Platforms: macOS verified; Windows untested in this release"), then
   `npm publish -w gateway --dry-run`.
7. A real `npm publish` happens only with `--publish-npm` and a second typed confirmation,
   `publish foundry-agent-gateway@<version>`.

The script never publishes the draft, never tags and never pushes. The version bump is left
uncommitted: commit it on a branch and open a PR for Andrew. Land ONLY that version-bump PR
before publishing the draft. If anything else lands on `main` first, re-run the release,
because the tag is created from `main`'s HEAD at publish time.

A declined or aborted run leaves the bumped tree dirty. Reset it with `git checkout -- .`
before retrying.

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
