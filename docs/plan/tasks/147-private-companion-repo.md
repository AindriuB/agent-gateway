# 147 — Move the internal process docs to a private companion repo

**Repo:** new private repo `AindriuB/agent-gateway-internal` (name pending Andrew; created by him), seeded from this repo
**Depends on:** 140, 141, 142, 143, 144, 145, 146, and image tasks 53, 121, 123 merged to `main`
**Owns:**
- the whole companion repo (new): CLAUDE.md, AGENTS.md, PROJECT.md, docs/plan/**,
  docs/workflow.md, docs/conventions.md as extracted, plus link.sh and README.md (new)
- in this repo: nothing. The files leave the public history in task 148, not by a delete commit
  here.

**Status:** Part of the go-public set (140-148), planned 2026-10-16. Sequential: runs after the
whole cleanup wave and the image wave have merged, at a **freeze SHA** of `main` that Andrew
declares (no merges to `main` between this task's extraction and 148's push). Recorded decisions:
- Decision 1 (Andrew, 2026-10-16): internal process docs move to a private companion repo, not the
  public tree: `docs/plan/**` (PLAN, HISTORY, HISTORY-INDEX, tasks, done, specs, mvp-b-threats),
  CLAUDE.md, AGENTS.md, PROJECT.md, docs/workflow.md, docs/conventions.md.
- On conventions.md: its contributor-facing content is useful, so task 140 published it as
  CONTRIBUTING.md. The private conventions.md keeps only the agent-facing rules and points at
  CONTRIBUTING.md for the rest.
- The companion is a new docs-only repo, separate from `agent-gateway-private` (the renamed,
  frozen archive of the original, task 148), unless Andrew answers otherwise.

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

## Acceptance

- [ ] The companion repo's history is produced by `git filter-repo` on a fresh clone of this repo
      at the freeze SHA, keeping only `CLAUDE.md`, `AGENTS.md`, `PROJECT.md`, `docs/plan/`,
      `docs/workflow.md`, `docs/conventions.md` (each `--path`), with the same mailmap as 148. The
      exact command is in the companion README. `git log --oneline -- docs/plan/PLAN.md | wc -l` in
      the companion equals the same count in the original at the freeze SHA.
- [ ] The companion tree lists exactly those paths plus `link.sh` and `README.md`.
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
- [ ] No push is done by the implementer. Andrew creates the private repo and pushes
      (owner action).

## Out of scope

- Rewriting the public repo's history and every GitHub-side step (148).
- Editing CONTRIBUTING.md or any public doc (140, 142, 143, 146).
- The agent-kit (`~/.claude`, the untracked `.claude/` worktree scripts): teaching them to run
  `link.sh` for new worktrees is a change in that repo; report it as a follow-up.
- Porting open branches (148's runbook covers it).

## Owner questions

- Companion name: `agent-gateway-internal` proposed. Or reuse the renamed archive
  `agent-gateway-private` as the live docs home (one fewer repo, but it also carries the full
  pre-rewrite code)?
- Freeze SHA: Andrew declares it once 140-146 and 53, 121, 123 are merged.
