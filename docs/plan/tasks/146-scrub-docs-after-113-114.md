# 146 — Scrub the docs held by tasks 113 and 114 once they merge

**Repo:** .
**Depends on:** 141, 113 (merged), 114 (merged)
**Owns:**
- docs/chatgpt-plugin.md
- gateway/docker/README.md
- gateway/docker/.env.example (comments only)
- scripts/test/docker-byo-caddy.test.mjs (the `describe('README', …)` block at :102-125 only)
- e2e/pf2e-choices/spike.e2e.test.ts (the comment on line 5 only)
- CONTRIBUTING.md (one-line insertion in "## Pull requests" only; 140 is merged, no open task
  owns it)
- README.md (one "Support the project" line in "## Contributing" only; 142 is merged, no open
  task owns it)
- .github/FUNDING.yml (new)
- scripts/test/ci-workflow.test.mjs (insert `'FUNDING.yml',` into the `allowed` list of the
  "keeps .github to the allowlisted files" test only; 145 is merged, no open task owns it)

**Status:** Part of the go-public set (140-148), planned 2026-10-16. Kept apart from 143 because
open tasks 113 (`docs/chatgpt-plugin.md`) and 114 (`gateway/docker/README.md`) own these files.
Start only after both have merged to `main`, and after 141 (which adds the plugin
`--gateway-url` flag this doc must describe). 147's freeze waits for this task to merge
(Amendment 1).

## Goal

The ChatGPT plugin doc and the Docker README read correctly for a stranger on a public repo: no
"Andrew's deployment", no hosted URL, and no "while the package is private, log in" step. The
last leftovers that name the owner go, CONTRIBUTING.md explains the pre-public PR numbers, and the
repo gets its GitHub Sponsors and Ko-fi funding links.

## Context

- docs/chatgpt-plugin.md:3-7, 92, 134, 140-142, 159 (line numbers as of 84aa248; re-check after
  113 merges) — "Andrew's existing deployment", foundry.aindriub.app / gw.aindriub.app, and
  live-run notes naming Andrew.
- scripts/build-chatgpt-plugin.mjs — the `--gateway-url` flag added by 141.
- gateway/docker/README.md:21-22 — "While the package is private, log in first with a token that
  has read:packages" and the `docker login` line; :52-53 "while the repo is private" pointer to
  the releasing.md section that 143 retitled.
- gateway/docker/.env.example:7 — image comment; check for "private".
- scripts/test/docker-byo-caddy.test.mjs:102-117 — asserts the docker README contains `ghcr.io`,
  `read:packages` and `--password-stdin`; these assertions encode the private-package login and
  change with it.
- docs/releasing.md — 143's heading name for the self-hosted manifest section.
- e2e/pf2e-choices/spike.e2e.test.ts:5 — "needs Andrew's per-run approval"; no task owns
  e2e/pf2e-choices/.
- CONTRIBUTING.md:44-52 — the "## Pull requests" section (from 140).
- README.md:91-93 — the "## Contributing" section (from 142).
- scripts/test/ci-workflow.test.mjs:200-215 — the `.github` allowlist test (from 145); the
  `allowed` array is sorted, so `'FUNDING.yml'` goes first, before
  `'ISSUE_TEMPLATE/bug_report.yml'`.

## Acceptance

- [ ] With `P='andrew|aindriub|private (repo|repository|package|marketplace|plugin|deployment|release|testing)|while [^.]*\bprivate\b|\b(is|are|stays|remains) private\b'`,
      `rg -n -i "$P" docs/chatgpt-plugin.md gateway/docker/README.md gateway/docker/.env.example | sed -E 's#ghcr\.io/aindriub/foundry-agent-gateway##g' | rg -i "$P"`
      prints nothing (Decided Q6; Amendment 2). The `sed` deletes only the kept GHCR image name
      (`ghcr.io/aindriub/foundry-agent-gateway`, e.g. gateway/docker/.env.example:7), so the
      image name passes, while any other hit on the same line or elsewhere still fails:
      `foundry.aindriub.app`, `gw.aindriub.app`, any other `aindriub.app` host, "Andrew" and the
      old email. Do not use a line-dropping `rg -v` instead: it would hide an `aindriub.app` host
      sharing a line with the image name. The "private" part catches only private-hosting
      wording ("private plugin", "private package", "private repository", "a new private
      release", "(private testing)", "while the repo is private", "the package is private"); ordinary uses such as "printed code privately"
      (gateway/docker/README.md:113 on main, 2026-10-16), "save privately" or ChatGPT's
      "USER / PRIVATE" label pass and need no rewording. `$P` is a single word in both bash and
      zsh, so the command runs as written.
- [ ] docs/chatgpt-plugin.md says the package ships with a placeholder URL and shows how to build
      one for your own gateway with `--gateway-url https://gateway.example.invalid`;
      `rg -c "gateway\.example\.invalid" docs/chatgpt-plugin.md` is at least 1. It has no "hosted
      build" section. The live-verification notes describe "the operator", not a named person.
- [ ] gateway/docker/README.md: `docker compose pull` needs no login; the `docker login` and
      `read:packages` lines are removed (no "private fork" note); the self-hosted manifest
      pointer names 143's heading in docs/releasing.md.
- [ ] docker-byo-caddy.test.mjs's README test asserts `ghcr.io`, `GATEWAY_VERSION` and `--build`
      and no longer requires `read:packages` or `--password-stdin`; it asserts the README does not
      contain "While the package is private". The rest of the file is unchanged (diff).
- [ ] `sed -n 5p e2e/pf2e-choices/spike.e2e.test.ts` contains "needs the maintainer's per-run"
      and `rg -n Andrew e2e/pf2e-choices/spike.e2e.test.ts` prints nothing; the diff of that file
      is that one line.
- [ ] CONTRIBUTING.md gains exactly one line under "## Pull requests" (diff: one added line, plus
      a blank separator if needed, nothing removed) saying that pull request numbers in commit
      messages from before the repository went public (for example "Merge pull request #179")
      refer to the private archive, not to pull requests in this repository (Decided Q12);
      `rg -c "private archive" CONTRIBUTING.md` prints `1` (148 checks this).
- [ ] `.github/FUNDING.yml` is exactly two lines, `github: AindriuB` then `ko_fi: aindriub`:
      `printf 'github: AindriuB\nko_fi: aindriub\n' | cmp - .github/FUNDING.yml` exits 0 (Decided,
      owner 2026-10-16; reverses 140, see Amendments 1 and 2).
- [ ] The diff of scripts/test/ci-workflow.test.mjs is exactly one added line, `'FUNDING.yml',`,
      directly before `'ISSUE_TEMPLATE/bug_report.yml',`; every other assertion is unchanged. The
      PR quotes a local, uncommitted run with a temporary `.github/workflows/x.yml` in which the
      allowlist test fails with `workflows/x.yml is not allowlisted`.
- [ ] README.md's "## Contributing" section gains one line, `Support the project through
      [GitHub Sponsors](https://github.com/sponsors/AindriuB) or
      [Ko-fi](https://ko-fi.com/aindriub).` (diff: that line plus a blank separator, nothing
      removed; Amendment 2).
- [ ] `npm run test:scripts` passes and `npm run verify` exits 0.

## Out of scope

- docs/guides/chatgpt.md, docs/compatibility.md, docs/server-mode.md, docs/guides/headless.md:
  checked clean of personal strings at 84aa248 except `ghcr.io/aindriub/…` image names, which are
  correct and stay. Re-run the check above on them after 113/114 merge. The kept public identity
  is not a hit: the GHCR image name, `https://github.com/AindriuB/agent-gateway` and its
  `/releases/…`, `/issues` and `/blob/…` URLs (module.json's manifest and download), the
  `github.com/sponsors/AindriuB` and `ko-fi.com/aindriub` links, and the author name "AindriuB".
  If any other hit appears (an `aindriub.app` host, a personal path, the old email, "homelab",
  "Andrew"), report it rather than editing.
- Compose files, image names, `.env.example` values.
- Anything 141 owns (plugins, build scripts, docs/claude-plugin.md) and 143 owns (docs/releasing.md).
- The hosted gw.aindriub.app build steps: they go to the companion repo in 147, not here.
- Any other e2e/** comment, any other CONTRIBUTING.md, README.md or ci-workflow.test.mjs change,
  and any other `.github` file.
- The 145 workflow, CHANGELOG.md.

## Owner questions

- Q6 — Decided (owner, 2026-10-16): the public docs/chatgpt-plugin.md uses the neutral
  `gateway.example.invalid` example only. The hosted gw.aindriub.app build steps move to the
  companion repo (task 147), not the public doc.
- Q12 — Decided (owner, 2026-10-16): "Merge pull request #NNN" messages stay unchanged in the
  rewritten history; the one-line note goes in CONTRIBUTING.md, made by this task because 140 is
  already merged. 148 checks for it.
- Funding — Decided (owner, 2026-10-16): add `.github/FUNDING.yml` with `ko_fi: aindriub`
  (https://ko-fi.com/aindriub). Reverses 140's "no FUNDING.yml". Extended (owner, 2026-10-16,
  Amendment 2): GitHub Sponsors is set up too, so the file is `github: AindriuB` then
  `ko_fi: aindriub`, and the README line links both.

## Amendments

### Amendment 1 (owner answers, 2026-10-16)

- Q6: the hosted-build example is dropped from the public doc; `gateway.example.invalid` is the
  only example, and the `rg` acceptance now has no exception.
- The docker README's login lines are removed outright; the earlier "or moved to a private-fork
  note" option conflicted with the `rg … private` check.
- Added the unowned leftover e2e/pf2e-choices/spike.e2e.test.ts:5 ("needs Andrew's per-run …"
  becomes "needs the maintainer's per-run …").
- Q12: added the CONTRIBUTING.md one-line note on pre-public PR numbers.
- Funding: reverses task 140's decision ("No `.github/FUNDING.yml` is added", 140 acceptance and
  owner questions) and 145's use of `FUNDING.yml` as an example of an unlisted file. The owner
  now wants https://ko-fi.com/aindriub linked. This task adds `.github/FUNDING.yml` and allowlists
  it in 145's test; any other unlisted `.github` file must still fail.
- Proposed (planner): one "Support the project" line in README.md linking the Ko-fi page. README.md
  is a merged-task file no open task owns, so it is in Owns as a one-line insertion.
- 147's freeze SHA waits for this task to merge (Q9).

### Amendment 2 (external review and owner decision, 2026-10-16)

- [P2, external review] The scrub acceptance `rg -n -i "andrew|aindriub|private" …` could never
  pass: gateway/docker/.env.example:7 holds `ghcr.io/aindriub/foundry-agent-gateway`, which this
  task keeps. The check now deletes exactly that image name with `sed` before re-matching, so the
  image name passes while `aindriub.app` hosts, "Andrew" and the old email still fail, even on
  the same line.
- Owner decision: the "private" part is narrowed to private-hosting wording,
  `private (repo|repository|package|marketplace|plugin|deployment|release|testing)`,
  `while … private` and
  `is/are/stays/remains private`. Ordinary "private"/"privately" (e.g. "printed code privately",
  gateway/docker/README.md:113) passes and needs no rewording. Tested on main's three files: it
  still flags README.md:21, :52 and :53 ("(private testing)"), the "private plugin"/"private
  package" lines and the "a new private release" lines (:124, :165) of docs/chatgpt-plugin.md and every Andrew/aindriub.app line; it passes README.md:113, the
  `.env.example` image line, "Save privately" and "USER / PRIVATE"; it fails the samples "private
  plugin" and "private repository". The Out-of-scope re-run on other docs now lists the kept public
  identity (GHCR image, github.com/AindriuB/agent-gateway URLs, the Sponsors and Ko-fi links,
  author "AindriuB") as non-hits.
- Owner decision: GitHub Sponsors is set up alongside Ko-fi. `.github/FUNDING.yml` is now exactly
  `github: AindriuB` then `ko_fi: aindriub` (the `printf … | cmp` check matches); the README line
  links both GitHub Sponsors and Ko-fi and is an owner decision, no longer a planner proposal. The
  ci-workflow allowlist entry stays `'FUNDING.yml'`. 148's verify.sh self-test is updated so the
  new FUNDING.yml content and the Sponsors link never count as personal strings.
