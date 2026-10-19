# 143 — Scrub personal and infrastructure details from the public docs

**Repo:** .
**Depends on:** none
**Owns:**
- docs/dev.md
- docs/architecture.md
- docs/testing.md
- docs/releasing.md
- docs/security.md
- docs/spikes/foundry-socket-identity.md
- docs/guides/claude-desktop.md (the private-repository sentence at :11 only)

**Status:** Part of the go-public set (140-148), planned 2026-10-16 (Andrew's decision 8: scrub
docs/dev.md, docs/architecture.md and docs/testing.md; the same sweep covers the other public docs
that carry the same strings and are not owned by open tasks 113 and 114).

## Goal

After this, the public docs describe how anyone develops, tests and releases the project, with no
personal names, home paths, private hostnames, homelab details, internal workflow references or
"while the repo is private" instructions.

## Context

- docs/dev.md:9 — homelab checkout `/srv/dev/projects/…`, `/home/andrew/homelab/bin/foundry-link`,
  `ssh andrew@homelab.local`, "Relaunching the world stays Andrew-only". :10 `https://foundry.local`
  and `test-world`. :13 "There is no CI" (false once task 145 lands; CI runs on PRs).
- docs/architecture.md:1-10 (header written for agents; names `PROJECT.md`, `CLAUDE.md`,
  `AGENTS.md`), :60-95 "Repository topology" (agent-kit boilerplate, commented-out
  `git clone git@github.com:AindriuB/workspace.git .claude`), :130 links `docs/plan/PLAN.md`.
- docs/testing.md:37, :84, :115, :444 — "Andrew" as the approving human; long native-acceptance
  logs with harness SHA-256 values are public-safe and stay.
- docs/releasing.md:44, :69-73 (GHCR "The package is private" and `docker login`), :75 "Stops that
  need Andrew's explicit go-ahead", :87-120 "Self-hosted manifest (private testing)" including
  "Andrew's Caddy already mounts…" at :114.
- scripts/test/release.test.mjs:340-355 and scripts/test/docker-release.test.mjs:25-36 — read
  docs/releasing.md. The Ask Foundry checklist's `- Answer:` lines must stay byte-identical, and
  the file must keep whatever text bump-version rewrites.
- docs/security.md — keep content; add the reporting pointer.
- docs/spikes/foundry-socket-identity.md:51,122 — "homelab".
- docs/guides/claude-desktop.md:11 — "you need git access to the private repository".
- Task 140 adds CHANGELOG.md and SECURITY.md; task 145 adds PR-triggered CI.

## Acceptance

- [ ] `rg -n -i "andrew|homelab|/home/andrew|/srv/dev|aindriubannister|private repo|private repository|while the repo is private|PROJECT\.md|CLAUDE\.md|AGENTS\.md|docs/plan|workflow\.md|conventions\.md" docs/dev.md docs/architecture.md docs/testing.md docs/releasing.md docs/security.md docs/spikes/foundry-socket-identity.md docs/guides/claude-desktop.md`
      prints nothing. (`/home/you/…` and `/home/u/…` style placeholders elsewhere are fine.)
- [ ] docs/dev.md describes linking the repo into any Foundry data directory's `Data/modules`
      (symlink or copy, with the `dist/module/main.js` note) and reloading, with generic hosts
      (`https://foundry.example` or `localhost:30000`); it says CI runs `npm run verify` on PRs and
      that `npm run verify` locally is still expected.
- [ ] docs/architecture.md's header is a plain description for human readers; the "Repository
      topology" section is removed (the public repo is one clone); :130's "Not built yet" sentence
      no longer points at PLAN.md and is either brought up to date (37 and 38 are built) or removed.
- [ ] docs/testing.md refers to "the operator" or "a human approver" where it named Andrew;
      technical content, commands and recorded evidence are otherwise unchanged (diff shows
      wording-only edits on those lines).
- [ ] docs/releasing.md: the GHCR paragraph says the package is public and pulls need no login;
      the "Stops that need …" heading says "the maintainer's explicit go-ahead"; the self-hosted
      manifest section is retitled (e.g. "Self-hosted manifest (testing a build)"), keeps the
      generic `dl.example.org` steps, and drops the Andrew-specific Caddy sentence; a step "update
      CHANGELOG.md" is added before tagging. `node --test scripts/test/release.test.mjs
      scripts/test/docker-release.test.mjs` passes.
- [ ] docs/security.md gains a "Reporting a vulnerability" line pointing to SECURITY.md.
- [ ] docs/guides/claude-desktop.md:11 no longer mentions a private repository or git access.
- [ ] `npm run verify` exits 0.

## Out of scope

- docs/chatgpt-plugin.md, docs/guides/chatgpt.md, docs/compatibility.md (open task 113),
  docs/server-mode.md, docs/guides/headless.md, gateway/docker/** (open task 114; follow-up in 146).
- docs/claude-plugin.md (141), README.md (142), CHANGELOG.md and SECURITY.md themselves (140).
- docs/plan/**, docs/workflow.md, docs/conventions.md (moved private by 147, not edited here).
- Test files and screenshots (144). e2e/** (owned by the open image tasks).
- Rewriting history: these strings remain in older commits until task 148.

## Review round 1 — findings

Reviewed HEAD: bbe3e17ded20a0a6beb642491f357cc504619266

- [P2] docs/releasing.md:3-5 — intro still says CI "never runs on pull requests or on `main`, so local `npm run verify` is the PR gate", contradicting docs/dev.md:13 and task 145. route: implementer — reword to 145's triggers: tests run on pull requests, pushes to `main` and `v*` tags; only a `v*` tag also builds and pushes the image; "Run workflow" runs tests only; local verify still expected before pushing.
- [STYLE] docs/releasing.md:56 — 130-char prose line in a file wrapped at ~100 (.prettierrc printWidth 100). route: implementer.
- [P3] docs/architecture.md — after removing "Planned (MVP B)", the built headless runner is never mentioned. route: implementer — one bullet naming gateway/src/headless/ (runner logs in as an agent user with its own Chromium; no GM tab needed), migration 013, link to guides/headless.md.
- [NOTE] Acceptance asks for a step "update CHANGELOG.md"; make it a numbered step, not a sentence inside another paragraph.
- [NOTE, accepted residual] docs/testing.md and docs/spikes/foundry-socket-identity.md name `foundry.local` / `foundry13.local` / `test-world`: these are the e2e harness's documented defaults and generic test names; changing them is outside Owns.
