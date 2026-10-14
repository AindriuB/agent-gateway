# 66 — Cut the first MVP A release, privately

**Repo:** .
**Depends on:** 72, and the from-source install docs change (branch `claude/docs-private-install`, README.md and docs/guides/*) merged to `main`
**Status:** MVP A. 0.1.0 stays PRIVATE (Andrew, 2026-10-13): the GitHub repo `AindriuB/agent-gateway` stays private and does not change visibility, and nothing is published to npm. Stops for Andrew's explicit go-ahead before creating the GitHub draft release and before publishing it.
**Owns:**
- module.json (`version` and `download` only, written by `scripts/bump-version.mjs`)
- package.json, protocol/package.json, module/package.json, gateway/package.json (`version` only)
- gateway/mcpb/manifest.json (`version` only)
- package-lock.json (version fields only)
- docs/compatibility.md (ticking this release's manual checklist only)

## Goal
Cut 0.1.0 as a private release: land the version bump through a PR, run the
release script on `main` to produce the gated artefacts and a DRAFT GitHub
release in the private repo, and confirm the from-source install works from a
clean clone. npm stays a dry run. Every irreversible step waits for Andrew.

## Context
- docs/releasing.md and scripts/release.mjs (64): the gates, artefacts, SHA-256s, the `yes` prompt, the draft release, and the npm dry run (scripts/release.mjs:150-180)
- docs/releasing.md "Manifest URL": `releases/latest/download/module.json` needs a published release, and in a private repo its assets need GitHub auth to download, so Foundry manifest-URL install is not the path for 0.1.0
- README.md and docs/guides/* as rewritten on `claude/docs-private-install`: the from-source install path this release is checked against
- docs/compatibility.md (63): the manual per-release checklist

## Acceptance
- [ ] The release version is `0.1.0` (Andrew, 2026-10-13). Any bump goes on a branch and lands through a PR Andrew merges to `main`, as docs/releasing.md requires; that version-bump PR is the ONLY thing that lands on `main` between the release run and publishing the draft (otherwise re-run); `node scripts/bump-version.mjs --check` passes on `main`
- [ ] On `main`, `npm run release -- 0.1.0` (no `--publish-npm`) passes every gate and builds `agent-gateway.zip`, `foundry-agent-gateway-0.1.0.tgz` and `foundry-agent-gateway.mcpb`; the report to Andrew includes the gate summary, any `--allow-missing-v13` note, and the three SHA-256s
- [ ] STOP: the `yes` prompt (draft release creation) is answered only after Andrew's explicit go-ahead for v0.1.0; afterwards `gh release view v0.1.0 --repo AindriuB/agent-gateway --json isDraft` shows `"isDraft": true`
- [ ] npm is a dry run only: the run's npm step is `npm publish -w gateway --dry-run`, `--publish-npm` is never passed, and `npm view foundry-agent-gateway` still returns 404 afterwards
- [ ] STOP: publishing the draft as a private release is Andrew's call and is done by him or only after his explicit go-ahead
- [ ] `gh repo view AindriuB/agent-gateway --json visibility` reads `PRIVATE` before and after the release
- [ ] From-source install check: in a fresh temp directory, `git clone` of the private repo at the release commit, followed by exactly the from-source steps in README.md and docs/guides/*, completes with no undocumented step; the report lists each command and its result. Andrew does the Foundry (module enables on foundry.local v14, GM tab connects) and Claude Desktop parts manually, and the report hands him those steps
- [ ] The Claude Desktop (`.mcpb` and from-source) and Claude Code rows of the `docs/compatibility.md` checklist are ticked for 0.1.0 in a follow-up PR, from Andrew's manual results
- [ ] After the release is published, the after-action report for 0.1.0 is given to Andrew in chat (`/aar 0.1.0`) and never committed

## Out of scope
- Making the repo public, or any change to its visibility
- The real `npm publish` / `--publish-npm`
- Foundry package-listing submission, and completing the Ask Foundry checklist in docs/releasing.md
- Installing by manifest URL from `releases/latest/download/module.json` (needs a public release)
- Rewriting the install docs (that is the `claude/docs-private-install` change)
- Docker image (42) and anything MVP B
- Follow-up, not created here: a future "go public" task covering repo visibility, the real npm publish, the Foundry listing, the Ask Foundry answers and the manifest-URL install check

## Outcome (2026-10-14)
`npm run release -- 0.1.0 --allow-missing-v13` ran unattended on `main` at 975670b; Andrew gave the `yes` for the draft up front and it was piped in. The draft release "Agent Gateway 0.1.0" (tag v0.1.0, `isDraft` true) exists in the PRIVATE repo with `agent-gateway.zip`, `module.json` and `foundry-agent-gateway.mcpb`. It stays unpublished by Andrew's decision (2026-10-14): "I want the MVP B done before we push a public release".

Gates: verify passed (188 files / 4076 tests; slow suite 5 files / 2227 tests); test:scripts passed (31); conformance ok (inspector 2.10.1, stdio and http); e2e v14 passed (14 files passed, 1 skipped; 35 tests passed, opt-in suites skipped); e2e v13 skipped (no v13 instance, `--allow-missing-v13`).

SHA-256:
- agent-gateway.zip `9940513a24ebe349318a64d56783be6012932384d2f8008ec19ec43937737110`
- foundry-agent-gateway-0.1.0.tgz `ac8505e879bb3884f418b5c63b4b7af9d9c8424d2681370d1149ff620c63a6f3`
- foundry-agent-gateway.mcpb `6b0fec0a6fb81cff9d7ee100b4dfc98aa058a697284019f5bbe444bb8c8a8098`

Clean-clone check at 975670b (README from-source steps): `npm install`, build, `pack:module` and `pack:mcpb` succeeded; the zip holds `module.json` and `dist/module/main.js`; `cli.js --version` prints 0.1.0; the gateway starts and prints a pairing code (temp HOME, test ports). No undocumented step.

Acceptance status:
- Met: version 0.1.0; release run passes every gate and builds the three artefacts with SHA-256s reported (v13 skipped by flag); draft created with `isDraft` true; npm a dry run only, `npm view foundry-agent-gateway` still 404; repo still PRIVATE; clean-clone from-source install check.
- Pending Andrew: the manual Foundry part (module enables on foundry.local v14, GM tab connects) and the Claude Desktop part of the install check; the follow-up PR ticking the Claude Desktop (`.mcpb` and from-source) and Claude Code rows of `docs/compatibility.md` from his results.
- Deferred by decision (2026-10-14): publishing the draft, and the after-action report (`/aar 0.1.0`, never committed), which is due when the release is actually published.

Release-day problems:
1. The first gate run failed on the live e2e ambiguity suite, stale against task 71. Task 73 (PR #117) fixed it and the takeover e2e token assumption.
2. The first terminal tab closed on gate failure.
3. A run with `AGENT_GATEWAY_E2E_PF2E=1` hung for 50 minutes: `e2e/pf2e`'s `beforeAll` waits unbounded for a GM approval of a temporary actor. It had been described as read-only, which was wrong. Follow-up chip raised.
4. An untracked `output/` blocked the clean-tree check; fixed by PR #116.
5. The e2e pairings had to be redone after tasks 70 and 71, because legacy NULL-origin pairings were retired.
6. Andrew does not want to wait at an interactive prompt; follow-up chip raised for a `--confirm-draft` flag.
