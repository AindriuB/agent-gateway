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
      this order:
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
         --title "Agent Gateway 0.3.0" --notes-file … --latest <assets>`; check
         `curl -sIL https://github.com/AindriuB/agent-gateway/releases/latest/download/module.json`
         returns 200 once public, and that module.json's `download` URL resolves.
      8. OWNER: repo settings: enable private vulnerability reporting (SECURITY.md relies on it),
         Actions "Require approval for first-time contributors", branch protection on main
         requiring the `test` check, Issues on, Discussions per preference.
      9. OWNER: GHCR package `foundry-agent-gateway`: connect it to the new repo (Package
         settings, Manage Actions access, give the new repo write) and set visibility to
         **public**; check `docker pull ghcr.io/aindriub/foundry-agent-gateway:0.3.0` without
         login.
      10. OWNER: flip AindriuB/agent-gateway to **public**; re-run step 7's curl.
      11. OWNER: on each machine, re-clone or re-point local checkouts (`git remote set-url`),
          run 147's `link.sh`, and delete old worktrees whose branches are pre-rewrite.
      12. Then cut 0.4.0 from the public repo with the normal release script (separate work).
- [ ] RUNBOOK.md has a rollback section: until step 10, deleting the new repo and renaming the
      archive back restores the old state; after step 10, visibility can be flipped back but
      clones made in the meantime cannot be recalled.
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
