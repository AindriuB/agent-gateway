# 147 — Move the internal process docs to a private companion repo

**Repo:** new private repo `AindriuB/agent-gateway-internal` (Decided Q8; created by the owner), seeded from this repo
**Depends on:** 140, 141, 142, 143, 144, 145, 146, playtest tasks 109, 110, 111, 113, 114, and image tasks 53, 121, 123 merged to `main` (not 112;
  Amendment 2)
**Owns:**
- the whole companion repo (new): CLAUDE.md, AGENTS.md, PROJECT.md, docs/plan/**,
  docs/workflow.md, docs/conventions.md as extracted, plus link.sh, README.md and
  ops/hosted-build.md (new)
- in this repo: nothing. The files leave the public history in task 148, not by a delete commit
  here.

**Status:** Part of the go-public set (140-148), planned 2026-10-16. Sequential: runs after the
whole cleanup wave, the playtest tasks named in Q9 and the image wave have merged, at a **freeze SHA**
of `main` that the owner declares (no merges to `main` between this task's extraction and 148's
push). Recorded decisions:
- Decision 1 (Andrew, 2026-10-16): internal process docs move to a private companion repo, not the
  public tree: `docs/plan/**` (PLAN, HISTORY, HISTORY-INDEX, tasks, done, specs, mvp-b-threats),
  CLAUDE.md, AGENTS.md, PROJECT.md, docs/workflow.md, docs/conventions.md.
- On conventions.md: its contributor-facing content is useful, so task 140 published it as
  CONTRIBUTING.md. The private conventions.md keeps only the agent-facing rules and points at
  CONTRIBUTING.md for the rest.
- Q8 — Decided (owner, 2026-10-16): the companion is a NEW private repo
  `AindriuB/agent-gateway-internal`. The renamed archive `agent-gateway-private` (task 148) stays
  frozen as-is and is not the docs home.
- Q9 — Decided (owner, 2026-10-16; amended 2026-10-16, Amendment 2): the freeze SHA is cut only
  after 146 plus 109, 110, 111, 113 and 114 have merged to `main`. This is a precondition,
  checked below before extraction. Going public does NOT wait for 112.
- 112 (persist pending approvals, decided as option A) lands in the public repo after it goes
  public. If its branch exists at freeze time, it is marked "port" rather than blocking, and it
  is ported by bundle per 148 Amendment 4's procedure (148 runbook step 1).
- Q6 — Decided (owner, 2026-10-16): the hosted gw.aindriub.app build steps live in the companion
  (`ops/hosted-build.md`), not in the public docs/chatgpt-plugin.md (146).
- Q15 — Decided (owner, 2026-10-16): the per-connection frame budget (T17) and capability
  negotiation in `welcome` are not prerequisites for going public or for 0.4.0; they stay
  follow-ups.

## Goal

The planning and agent-guidance files keep their full history and keep working for every agent
session, but live in a private repo. A public checkout gains them locally by running one script,
and they never show up as untracked or committed files in the public repo.

## Context

- PROJECT.md (whole file) — the router; its table points at `docs/plan/*`, `docs/workflow.md`,
  `docs/conventions.md`, `docs/architecture.md`, `docs/testing.md`. The last two stay public.
- CLAUDE.md, AGENTS.md — pointers to PROJECT.md.
- docs/conventions.md:41-57 — the shared insertion-only list: agent-facing, stays private.
- CONTRIBUTING.md (from 140) — the public home of style, layout, tests, i18n, ports and PR format.
- `.claude/` is untracked and holds the agent-kit worktree scripts (docs/architecture.md before 143,
  "Repository topology"); new worktrees will need the companion links too. That script lives
  outside this repo.
- package.json:17 — the `lint` glob excludes `docs/plan/**`; harmless once the path is a symlink.
- Git: `<git-common-dir>/info/exclude` is shared by every worktree of a clone and is never pushed.
- docs/chatgpt-plugin.md:3-7 before 146 merges (e.g. at e8f0a64): the foundry.aindriub.app and
  gw.aindriub.app endpoints, the source for `ops/hosted-build.md`; scripts/build-chatgpt-plugin.mjs:2
  for the `--gateway-url` usage.

## Acceptance

- [ ] **Freeze precondition (Q9).** Before extraction, the PR quotes the output of
      `gh pr list -R AindriuB/agent-gateway --state open --json number,title,headRefName` and
      `git fetch origin && git branch -r --no-merged origin/main`, and, for each `<id>` of 146,
      109, 110, 111, 113 and 114, of
      `git log --merges --format='%h %s' origin/main | rg -e "(^|[ /])task/<id>-|claude/task-<id>\b"`
      printing at least one merge. The check matches task branch names only, never PR numbers
      (`#110` is PR 110, not task 110), and uses all merges reachable from main, not
      `--first-parent`, because playtest tasks reach main through a wave branch (e.g. 113 via
      `merge 113: task/113-...` inside `claude/playtest-wave-2`). `docs/plan/done/<id>-*.md` is not
      used: it lags the merge (140-145 merged without one). Checked on origin/main at 7fd545c: 110,
      113 and 114 found; 109, 111 and 146 not yet (Amendment 3). No open PR and no unmerged branch
      carries any of those tasks (`headRefName` or branch name matching the same pattern, or a PR
      title starting `<id>:`), and each remaining open PR or unmerged branch is listed with the
      owner's word "abandon" or "port" next to it.
      An open PR or unmerged branch for 112 does not block: it is listed and marked "port"
      (Amendment 2). If any of the six is unmerged, the task stops and reports; it does not
      extract.
- [ ] The companion repo's history is produced by `git filter-repo` on a fresh clone of this repo
      at the freeze SHA, keeping only `CLAUDE.md`, `AGENTS.md`, `PROJECT.md`, `docs/plan/`,
      `docs/workflow.md`, `docs/conventions.md` (each `--path`), with the same mailmap as 148. The
      exact command is in the companion README. `git log --oneline -- docs/plan/PLAN.md | wc -l` in
      the companion equals the same count in the original at the freeze SHA.
- [ ] The companion tree lists exactly those paths plus `link.sh`, `README.md` and
      `ops/hosted-build.md` (148 adds `ops/go-public/` later).
- [ ] `ops/hosted-build.md` gives the exact hosted ChatGPT plugin build command
      (`node scripts/build-chatgpt-plugin.mjs --gateway-url https://gw.aindriub.app`) and the
      hosted endpoints from the pre-146 docs/chatgpt-plugin.md:3-7 (Foundry URL, MCP endpoint,
      OAuth resource metadata URL); `rg -n "aindriub\.app" docs/chatgpt-plugin.md` on the public main
      prints nothing.
- [ ] `link.sh <public-checkout>` creates symlinks in the checkout for the six paths, adds the six
      names to `$(git -C <checkout> rev-parse --git-common-dir)/info/exclude` once (idempotent),
      refuses with exit 1 and no change if any target exists as a regular file or directory, and
      works for a worktree path. Verified in the PR: on a scratch clone with the six paths deleted,
      after `link.sh`, `cat <checkout>/PROJECT.md` works and `git -C <checkout> status --porcelain`
      is empty.
- [ ] Companion PROJECT.md is updated for two repos: plan and history edits are committed in the
      companion; code and public-docs PRs go to the public repo; rule 7 (PR, Andrew reviews, never
      push to `main`) applies to both; the table row for conventions names CONTRIBUTING.md (public)
      and docs/conventions.md (agent rules). Stays under its 50-line cap.
- [ ] Companion docs/conventions.md drops the sections now in CONTRIBUTING.md and keeps the
      insertion-only list and agent-only rules, with a pointer to CONTRIBUTING.md.
- [ ] Companion README says what the repo is, how to link it, and that it must stay private.
- [ ] Nothing in this repo changes (empty diff on the public repo).
- [ ] No push is done by the implementer. The owner creates `AindriuB/agent-gateway-internal`
      as a new private repo and pushes (owner action). Nothing is pushed to, renamed in or
      changed on `agent-gateway-private`.

## Out of scope

- Rewriting the public repo's history and every GitHub-side step (148).
- Editing CONTRIBUTING.md or any public doc (140, 142, 143, 146).
- The agent-kit (`~/.claude`, the untracked `.claude/` worktree scripts): teaching them to run
  `link.sh` for new worktrees is a change in that repo; report it as a follow-up.
- Porting open branches (148's runbook covers it; by Q9 none of 146, 109, 110, 111, 113 or 114
  needs porting; 112, if open, is ported by bundle there).
- The frame budget (T17) and `welcome` capability negotiation (follow-ups, Q15).

## Owner questions

- Q8 companion name — Decided (owner, 2026-10-16): a NEW private repo
  `AindriuB/agent-gateway-internal`; `agent-gateway-private` stays frozen as-is.
- Q9 freeze SHA — Decided (owner, 2026-10-16; amended by Amendment 2): the owner declares it only
  after 140-146, 109, 110, 111, 113, 114 and 53, 121, 123 are merged, checked by the
  freeze-precondition acceptance item. 112 is not a precondition.

## Amendments

### Amendment 1 (owner answers, 2026-10-16)

- Q8: repo name fixed; the archive is frozen and is not the docs home.
- Q9: freeze waits for 146 and playtest tasks 109-114; added to Depends on and as a checked
  precondition listing open PRs and unmerged branches.
- Q6: the hosted build steps removed from the public doc by 146 land here as
  `ops/hosted-build.md`.
- Q15: T17 frame budget and `welcome` capability negotiation recorded as non-prerequisites.

### Amendment 2 (owner decision, Andrew, 2026-10-16)

- Going public does NOT wait for homelab task 112 (persist pending approvals, now decided as
  option A). Q9's freeze precondition changes from "146 and 109-114" to "146 plus 109, 110, 111,
  113 and 114" in Depends on, the Q9 decision, the freeze-precondition acceptance item (the
  `rg` check and the list of six) and the Q9 owner-question entry. Supersedes the Q9 line of
  Amendment 1.
- 112 lands in the public repo after it goes public. If its branch exists at freeze time, it is
  marked "port" rather than blocking, and it is ported by bundle per 148 Amendment 4's procedure
  (148 runbook step 1: verified `open-branches.bundle`, re-applied onto the rewritten main by
  cherry-pick or `git rebase --rebase-merges`, never by patches alone).

### Amendment 3 (coordinator review, 2026-10-16)

- The freeze-precondition check `git log --oneline origin/main | rg -e '#?(<ids>)\b'` counted PR
  numbers as task merges (`Merge pull request #110 from AindriuB/claude/plan-72` matched task
  110). It now matches task identifiers only: per id, a merge subject reachable from origin/main
  naming the task branch (`task/<id>-` or `claude/task-<id>`). Chosen over `<id>:` commit
  subjects (they also appear on review commits before merge, and 114 has none) and over
  `docs/plan/done/<id>-*.md` (it lags the merge). Not `--first-parent`: 110, 113 and 114 reached
  main through playtest wave branches. Tested on origin/main at 7fd545c: 110 (d9aaad7), 113
  (3465879) and 114 (d74783a) found; 109, 111, 112 and 146 not found. The open-PR and
  unmerged-branch check uses the same branch pattern. 148's step 1 script uses the same check.
