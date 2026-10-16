# 146 — Scrub the docs held by tasks 113 and 114 once they merge

**Repo:** .
**Depends on:** 141, 113 (merged), 114 (merged)
**Owns:**
- docs/chatgpt-plugin.md
- gateway/docker/README.md
- gateway/docker/.env.example (comments only)
- scripts/test/docker-byo-caddy.test.mjs (the `describe('README', …)` block at :102-125 only)

**Status:** Part of the go-public set (140-148), planned 2026-10-16. Kept apart from 143 because
open tasks 113 (`docs/chatgpt-plugin.md`) and 114 (`gateway/docker/README.md`) own these files.
Start only after both have merged to `main`, and after 141 (which adds the plugin
`--gateway-url` flag this doc must describe).

## Goal

The ChatGPT plugin doc and the Docker README read correctly for a stranger on a public repo: no
"Andrew's deployment", the hosted URLs presented only as an example of a build-time choice, and no
"while the package is private, log in" step.

## Context

- docs/chatgpt-plugin.md:3-7, 92, 134, 140-142, 159 (line numbers as of 84aa248; re-check after
  113 merges) — "Andrew's existing deployment", foundry.aindriub.app / gw.aindriub.app, and
  live-run notes naming Andrew.
- scripts/build-chatgpt-plugin.mjs — the `--gateway-url` flag added by 141.
- gateway/docker/README.md:21-22 — "While the package is private, log in first with a token that
  has read:packages" and the `docker login` line; :52-53 "while the repo is private" pointer to
  the releasing.md section that 143 retitles.
- gateway/docker/.env.example:7 — image comment; check for "private".
- scripts/test/docker-byo-caddy.test.mjs:102-117 — asserts the docker README contains `ghcr.io`,
  `read:packages` and `--password-stdin`; these assertions encode the private-package login and
  change with it.
- docs/releasing.md — 143's new heading name for the self-hosted manifest section.

## Acceptance

- [ ] `rg -n -i "andrew|aindriub\.app|private" docs/chatgpt-plugin.md gateway/docker/README.md gateway/docker/.env.example`
      prints nothing except, in docs/chatgpt-plugin.md, a "Hosted build" example command using
      `--gateway-url https://gw.aindriub.app` if Andrew wants the hosted build documented publicly
      (default: use `https://gw.example.org` and keep the aindriub command out of the public tree).
- [ ] docs/chatgpt-plugin.md says the package ships with a placeholder URL and how to build one for
      your own gateway with `--gateway-url`; the live-verification notes describe the operator,
      not a named person.
- [ ] gateway/docker/README.md: `docker compose pull` needs no login; the login lines are removed
      or moved to an optional note for a private fork; the self-hosted manifest pointer names 143's
      heading.
- [ ] docker-byo-caddy.test.mjs's README test asserts `ghcr.io`, `GATEWAY_VERSION` and `--build`
      and no longer requires `read:packages` or `--password-stdin`; it asserts the README does not
      contain "While the package is private". The rest of the file is unchanged (diff).
- [ ] `npm run verify` exits 0.

## Out of scope

- docs/guides/chatgpt.md, docs/compatibility.md, docs/server-mode.md, docs/guides/headless.md:
  checked clean of personal strings at 84aa248 except `ghcr.io/aindriub/…` image names, which are
  correct and stay. Re-run the `rg` above on them after 113/114 merge; if new hits appear, report
  them rather than editing.
- Compose files, image names, `.env.example` values.
- Anything 141 owns (plugins, build scripts, docs/claude-plugin.md) and 143 owns (docs/releasing.md).
