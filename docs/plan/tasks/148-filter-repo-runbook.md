# 148 — Filtered-history public copy: runbook and verification script

**Repo:** the private companion repo from 147 (`AindriuB/agent-gateway-internal`, pending name)
**Depends on:** 147
**Owns:**
- ops/go-public/** in the companion repo (new): `RUNBOOK.md`, `filter.sh`, `verify.sh`,
  `replacements.txt`, `mailmap`, `internal-paths.txt`, `strip-blobs.txt` (only if 144 found any)

**Status:** Part of the go-public set (140-148), planned 2026-10-16. Sequential and last: it runs
at the freeze SHA declared for 147, after every cleanup task and the image wave have merged.
The 0.4.0 release is cut from the public repo after this task, not by it. Recorded decisions:
- Decision 2 (Andrew, 2026-10-16): publish a filtered-history copy, NOT a squash. Foundry's
  package reviewers read the commit history, so the code history stays real. Then rename the
  current repo to `agent-gateway-private` (the frozen archive), push the copy as
  `AindriuB/agent-gateway` so module.json's manifest and download URLs keep working, and re-create
  the releases and tags.
- Decision 6: LICENSE keeps "Copyright (c) 2026 Andrew Bannister"; the filter does not touch it.
- Decision 7: the Ascend-derived CSS values in `gateway/src/oauth/consent/style.ts` stay; the
  filter does not touch them. Only the Ascend **mark** (SVG path data) goes.
- These scripts contain the personal strings they hunt for, which is why they live in the private
  companion and never in the public tree.

**Every destructive or GitHub-side step is an owner action.** The implementer writes and
dry-runs the scripts on local clones only. The implementer never renames, creates, pushes to,
changes the visibility of, or deletes any GitHub repo, package, tag or release.

## Goal

A repeatable, checked procedure that turns the private repo at the freeze SHA into a public
history with the internal docs, the all-rights-reserved Ascend mark and personal paths and email
removed, whose code at every commit and tag is otherwise identical, plus the exact owner steps to
swap it in under the existing repo name and restore the releases.

## Context

- The filter targets (found 2026-10-16 at 84aa248; the implementer re-runs the discovery):
  - Internal paths (147's list): `CLAUDE.md`, `AGENTS.md`, `PROJECT.md`, `docs/plan/`,
    `docs/workflow.md`, `docs/conventions.md`.
  - The Ascend mark is not a separate file. It is the `ASCEND_PATH` SVG path-data string literal
    and its "(c) 2026 Andrew Bannister. All rights reserved. Not covered by this repository's MIT
    licence." comment in `gateway/src/oauth/consent/marks.ts`, added by task 75 in f1a2b94 ("75:
    add privacy, cookie and source footer to consent pages") and removed by task 82 in 6657c0a.
    See `git show f1a2b94:gateway/src/oauth/consent/marks.ts` lines 4-5 and 10-11. Replace the
    literal's content (not the file) so every commit in between still builds and its tests still
    pass: footer.test.ts at that time compared the rendered path to the imported `ASCEND_PATH`.
    `git log --all -S ASCEND_PATH` also hits c416623 (a docs/plan task file, dropped anyway).
  - Personal paths and infrastructure outside the internal docs: `docs/dev.md`
    (`/home/andrew/homelab/bin/foundry-link`, `ssh andrew@homelab.local`,
    `/srv/dev/projects/foundry-modules/agent-gateway`), plus the word "homelab" in older versions
    of `docs/spikes/foundry-socket-identity.md` and `docs/testing.md` (143 fixes the current
    tree; the history still needs replacement rules). `/Users/<name>` appears only in internal
    docs. Generic placeholders (`/Users/a/`, `/home/u/`, `/home/you/`, `foundry.local`) stay.
  - Author email: 1,251 commits, all `aindriubannister@gmail.com` (160 committed by
    `noreply@github.com`, the PR merges). GitHub user id for AindriuB is 3417729, so the noreply
    address is `3417729+AindriuB@users.noreply.github.com`. Commit messages contain no personal
    path or email (checked on main).
  - `.github/FUNDING.yml` existed early in main's history and was later removed; it is public
    content, keep unless Andrew says otherwise.
  - Screenshot blobs: whatever 144 reported (possibly none).
- Refs: tags v0.1.0, v0.1.0-rc.2, v0.1.1, v0.2.0, v0.3.0 are ancestors of main; v0.1.0-rc.1 is
  not (a scratch commit). Releases on GitHub: "Agent Gateway 0.3.0" (published, Latest, assets
  include module.json and agent-gateway.zip) and "Agent Gateway 0.1.0" (draft, never published).
- module.json `manifest` = `https://github.com/AindriuB/agent-gateway/releases/latest/download/module.json`;
  `download` = `…/releases/download/v<version>/agent-gateway.zip`. The GHCR package
  `ghcr.io/aindriub/foundry-agent-gateway` is private and linked to the current repo.
- Open branches and worktrees on the old repo (Codex 84 branch, playtest PRs, any unmerged task
  branch) have pre-rewrite SHAs and cannot merge into the new history.

## Acceptance

- [ ] `filter.sh <mirror-clone-dir>` refuses unless the dir is a fresh `git clone --mirror` (no
      worktrees, filter-repo's own fresh-clone check not overridden with `--force`), deletes every
      ref except `refs/heads/main` and the release tags chosen (see owner questions), then runs one
      `git filter-repo` with `--invert-paths --paths-from-file internal-paths.txt`,
      `--replace-text replacements.txt`, `--mailmap mailmap`, and `--strip-blobs-with-ids
      strip-blobs.txt` if present. Default empty-commit pruning stays on (plan-only commits
      disappear; say so in RUNBOOK.md).
- [ ] `replacements.txt` replaces the exact Ascend path-data literal with a neutral valid path
      (e.g. `M0 0`) and the Ascend copyright comment line with a neutral line, plus each personal
      path from the discovery with a generic one (`/home/andrew/homelab/bin/foundry-link` to
      `<foundry-link script>`, `andrew@homelab.local` to `user@foundry-host`,
      `/srv/dev/projects/foundry-modules/agent-gateway` to `<checkout>`, and each "homelab"
      phrase found in docs/spikes/foundry-socket-identity.md and docs/testing.md history to a
      generic "test server" phrase). Rules are literal or anchored regexes, never a bare
      `homelab` word replacement across all files without first listing every hit.
- [ ] `mailmap` maps `aindriubannister@gmail.com` to `3417729+AindriuB@users.noreply.github.com`
      for author and committer; the display name follows Andrew's answer below.
- [ ] `filter.sh --dry-run` runs `git filter-repo --dry-run` and leaves
      `.git/filter-repo/fast-export.original` and `.filtered` for inspection; RUNBOOK.md says how to
      diff them.
- [ ] `verify.sh <original-mirror> <rewritten-repo>` exits 0 only if all of these hold, printing
      one PASS/FAIL line per check and never printing a matched secret-like value:
      1. **File list diff.** The set of paths ever present (`git log --all --format= --name-only
         | sort -u`) after the run equals the set before minus exactly the internal paths (and
         any stripped screenshot paths if a blob strip removed the only version). Any other
         difference fails.
      2. **Tree equivalence.** For main and every kept tag, `git diff --name-only <old> <new>`
         lists only internal paths and files touched by a replacement rule; for the replacement
         files the line diff contains only replacement hits.
      3. **Personal strings.** Every blob reachable from every ref of the rewritten repo
         (`git rev-list --objects --all | git cat-file --batch`) and every commit message has
         zero matches for the patterns in a private `patterns.txt` (at least:
         `aindriubannister`, `@gmail.com`, `/Users/andrew`, `/Users/Andrew`, `/home/andrew`,
         `andrew@`, `homelab`, `/srv/dev/`, the first 24 characters of the Ascend path literal,
         `ASCEND_PATH = '` followed by a non-placeholder, `All rights reserved` in marks.ts).
         The first name "Andrew" alone is not a pattern: it stays in LICENSE by decision 6.
      4. **Identity.** Every author and committer email in the rewritten repo is the AindriuB
         noreply address or `noreply@github.com`.
      5. **Refs.** Only main and the chosen tags exist; each tag points at the rewritten
         counterpart of its old commit (a mapping table from `.git/filter-repo/commit-map` is
         printed).
      6. **Build.** In a temp worktree of the rewritten main, `npm ci && npm run verify` exits 0;
         at the rewritten v0.3.0, `npm ci && npm run build && node scripts/pack-module.mjs`
         produces an `agent-gateway.zip` whose file list matches the published 0.3.0 asset.
      7. **Secret scan.** If `gitleaks` is installed, `gitleaks detect` over the rewritten repo
         reports no findings beyond an allowlist of known test fixtures (listed in the script with
         a reason each); if not installed, the check prints SKIP and RUNBOOK.md makes it an owner
         step.
- [ ] The PR (in the companion) includes the output of `filter.sh --dry-run` and a full
      `verify.sh` run against a local mirror of the current main (not the freeze SHA yet), all
      PASS, or each FAIL explained.
- [ ] RUNBOOK.md gives the cut-over as numbered steps, each marked **OWNER** or **SCRIPT**, in
      this order. Steps 1-10 are all reversible and nothing in them is visible outside the
      owner's account; step 11 is the single publish gate; steps 12-13 publish (Amendment 1):
      1. OWNER: declare the freeze SHA; stop merging to main; list and close or port open PRs and
         branches (port with `git format-patch` from the old repo and `git am` onto the new main,
         excluding internal paths).
      2. SCRIPT: fresh `git clone --mirror` of AindriuB/agent-gateway; `filter.sh`; `verify.sh`.
      3. OWNER: download all assets of the 0.3.0 release (and 0.1.0 draft if kept) with
         `gh release download` into a local folder, and record release titles and notes.
      4. OWNER: rename AindriuB/agent-gateway to AindriuB/agent-gateway-private (Settings,
         Rename); confirm it stays private. GitHub's redirect from the old name ends as soon as a
         new repo takes the name, which is what makes module.json's URLs hit the new repo.
      5. OWNER: create AindriuB/agent-gateway as **private** first, empty, no README.
      6. OWNER: push the rewritten main and tags (`git push origin main` and the tag list
         explicitly; never `--mirror`, never `--force` to the archive).
      7. OWNER: re-create releases with `gh release create v0.3.0 -R AindriuB/agent-gateway
         --title "Agent Gateway 0.3.0" --notes-file … --latest <assets>`; while the repo is
         private, check them with `gh release view` and `gh release download` (authenticated).
      8. OWNER: repo settings: enable private vulnerability reporting (SECURITY.md relies on it),
         Actions "Require approval for first-time contributors", branch protection on main
         requiring the `test` check, Issues on, Discussions per preference.
      9. OWNER: GHCR package `foundry-agent-gateway`: connect it to the new repo (Package
         settings, Manage Actions access, give the new repo write). Visibility stays **private**;
         check an authenticated `docker pull ghcr.io/aindriub/foundry-agent-gateway:0.3.0`.
      10. OWNER + SCRIPT: pre-publish check. Fresh `git clone --mirror` of the pushed private
          AindriuB/agent-gateway and re-run `verify.sh <original-mirror> <that clone>`: all PASS.
          Confirm the package's version list holds nothing that should not go public.
      11. OWNER: **PUBLISH GATE.** Andrew explicitly confirms, in writing in the cut-over PR or
          issue, that steps 1-10 passed and that he is publishing. This is the point of no return:
          nothing after it can be fully rolled back, because clones, forks and pulled images made
          after it cannot be recalled. No step before the gate makes anything public.
      12. OWNER: flip AindriuB/agent-gateway to **public**; check
          `curl -sIL https://github.com/AindriuB/agent-gateway/releases/latest/download/module.json`
          returns 200, and that module.json's `download` URL resolves.
      13. OWNER: set the GHCR package visibility to **public**; check
          `docker pull ghcr.io/aindriub/foundry-agent-gateway:0.3.0` without login. Last, because
          GitHub documents package visibility as one-way (public cannot be set back to private).
      14. OWNER: migrate each machine's local checkouts (see the migration acceptance item below).
          `git remote set-url` alone is not a migration and the runbook must say so.
      15. Then cut 0.4.0 from the public repo with the normal release script (separate work).
- [ ] RUNBOOK.md's step 14 is a local-checkout migration that never silently discards local work
      and never uses `git stash` (Amendment 1). An existing checkout is still on the original
      history with the internal docs tracked, so 147's `link.sh` refuses there (its targets exist
      as regular files); every `.claude/worktrees/*` and other `git worktree list` entry on an
      existing checkout also points at the old history. For each machine:
      1. Inventory, per clone and per worktree (`git worktree list`): uncommitted changes
         (`git status --porcelain`), branches with commits not on the old origin/main
         (`git log --branches --not origin/main --oneline`), and stashes (`git stash list`, read
         only).
      2. Preserve: commit uncommitted changes to a `wip/<name>` branch in that worktree; export
         every unpushed branch and every existing stash entry as patches
         (`git format-patch origin/main..<branch> -o <backup-dir>/<branch>/`,
         `git stash show -p stash@{N} > <backup-dir>/stash-N.patch`) to a folder outside the
         checkout; list the folder and confirm it is non-empty for each item in the inventory.
      3. Replace: fresh `git clone https://github.com/AindriuB/agent-gateway` into a new directory
         (preferred), or, only once step 2 is confirmed, `git fetch` the new remote and
         `git reset --hard origin/main` in the main checkout after removing each old worktree with
         `git worktree remove` and deleting its pre-rewrite branch. The old checkout directory is
         kept (renamed) until Andrew deletes it.
      4. Run 147's `link.sh` in the new checkout and in each new worktree; re-apply preserved work
         with `git am`/`git apply` onto the new main, excluding internal paths.
- [ ] RUNBOOK.md has a rollback section (Amendment 1):
      - Before the publish gate (steps 1-10): delete the new private AindriuB/agent-gateway,
        rename the archive back to AindriuB/agent-gateway, and re-point the GHCR package's Actions
        access to it. This fully restores the old state; nothing was ever public.
      - After the gate, rollback is partial and the section says so plainly. Repo: flip it back to
        private (public forks detach and stay public); clones made meanwhile cannot be recalled.
        GHCR package: GitHub does not allow a public package to be made private again, so
        rollback is deleting the affected versions (or the whole package) and re-publishing them
        privately under new tags; GitHub may refuse to delete public versions above its download
        threshold without a support request. Images already pulled cannot be recalled.
- [ ] Nothing is pushed, renamed or created on GitHub by the implementer
      (`gh api` calls in scripts are read-only, and the scripts refuse to run `git push`).

## Out of scope

- Any change to the public repo's tree (tasks 140-146 did the tree; this task only rewrites
  history).
- Cutting, tagging or publishing 0.4.0; npm publish; the Foundry package listing; Ask Foundry
  answers.
- The hosted builds on dl.aindriub.app (unaffected: they are built from the tree).
- Rewriting e2e/** comments or "Andrew" as a first name anywhere in history.
- Re-numbering or rewriting `#NNN` PR references in commit messages (owner question).

## Owner questions

- Commit author **name**: keep "Andrew Bannister" (consistent with LICENSE) or map it to
  "AindriuB" alongside the email?
- Tags to keep: all of v0.1.0, v0.1.1, v0.2.0, v0.3.0? Drop the rc tags (v0.1.0-rc.1 is not on
  main; v0.1.0-rc.2 is)? Re-create the never-published 0.1.0 draft or drop it? Proposal: keep the
  four release tags, drop both rc tags, re-create only 0.3.0 as a release.
- `Merge pull request #NNN` messages will point at unrelated or missing numbers in the new repo:
  leave them, or rewrite to plain "Merge branch …" with `--replace-message`?
- `.github/FUNDING.yml` in early history: keep (default) or drop?
- Whether the hosted `gw.aindriub.app` / `dl.aindriub.app` URLs in older commits of the plugin
  files and docs should also be replaced. Default: keep; they are public service hostnames, not
  personal data.

## Amendments

### Amendment 1 (from external PR review, 2026-10-16)

- [P2] Step 11 let an existing local checkout just `git remote set-url`. That checkout stays on
  the original history with the internal docs tracked, so 147's `link.sh` refuses (its targets
  exist). Replaced by step 14 plus the migration acceptance item: inventory, preserve via WIP
  branches and patches (never `git stash`), then fresh clone or hard reset, then `link.sh`,
  covering every worktree including `.claude/worktrees/*`.
- [P2] The rollback promised restoration "until step 10", but step 9 had already made the GHCR
  package public. Reordered: every reversible step (rename, private create, push, releases,
  settings, package link, re-verify) comes first, then a single OWNER publish gate (step 11),
  then repo public (12) and package public (13). The rollback section now says what is and is
  not reversible after the gate, including the package.
