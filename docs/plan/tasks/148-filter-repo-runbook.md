# 148 — Filtered-history public copy: runbook and verification script

**Repo:** the private companion repo from 147 (`AindriuB/agent-gateway-internal`, Decided Q8)
**Depends on:** 147
**Owns:**
- ops/go-public/** in the companion repo (new): `RUNBOOK.md`, `filter.sh`, `verify.sh`,
  `replacements.txt`, `mailmap`, `internal-paths.txt`, `strip-blobs.txt` (only if 144 found any)
- ops/go-public/out/** in the companion repo (new): preserved filter-repo maps (Amendment 2)

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
- Q9 — Decided (owner, 2026-10-16; amended by Amendment 7): the freeze commit is cut only after
  146 plus 109, 110, 111, 113 and 114 have merged (147's freeze precondition). Going public does
  NOT wait for 112 (persist pending approvals, decided as option A): it lands in the public repo
  after it goes public. If its branch exists at freeze time, it is marked "port" rather than
  blocking, and it is ported by bundle per Amendment 4's procedure (step 1).
- Q10 — Decided (owner, 2026-10-16): rewritten history maps the author and committer NAME to
  `AindriuB` and the email to `3417729+AindriuB@users.noreply.github.com`. GitHub's own merge
  committer (`GitHub <noreply@github.com>`) is left as is. LICENSE keeps the legal name.
- Q11 — Decided (owner, 2026-10-16): keep tags v0.1.0, v0.1.1, v0.2.0, v0.3.0; drop v0.1.0-rc.1,
  v0.1.0-rc.2 and any other `*-rc*` tag; drop the 0.1.0 draft release; re-create only the 0.3.0
  release, with its assets, on the new repo.
- Q12 — Decided (owner, 2026-10-16): "Merge pull request #NNN" messages stay unchanged. Task 146
  adds one line to CONTRIBUTING.md saying pre-public PR numbers refer to the private archive.
- Q13/Q14 — Decided (owner, 2026-10-16): the early `.github/FUNDING.yml` and the
  gw.aindriub.app / dl.aindriub.app hostnames stay in history; no rewrite rule for them.
- Q15 — Decided (owner, 2026-10-16): the per-connection frame budget (T17) and capability
  negotiation in `welcome` are not prerequisites for going public or for 0.4.0; they stay
  follow-ups.

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
  - `.github/FUNDING.yml` existed early in main's history (`github: AindriuB`,
    `ko_fi: AindriuB`; added c117d4d, removed 5f8ed04) and 146 adds a new one
    (`github: AindriuB` then `ko_fi: aindriub`, 146 Amendment 2). Both stay (Q13): the old one is
    kept in history as is, the new one is in the tree.
  - Kept public identity, never a personal-string hit: the GHCR image
    `ghcr.io/aindriub/foundry-agent-gateway`; module.json's `url`, `manifest` and `download` URLs
    on `https://github.com/AindriuB/agent-gateway`; `"authors": [{ "name": "AindriuB" }]` in
    module.json and `"author": "AindriuB"` in package.json; the FUNDING.yml handles and README's
    `https://github.com/sponsors/AindriuB` and `https://ko-fi.com/aindriub` links (146); the
    rewritten identity `AindriuB <3417729+AindriuB@users.noreply.github.com>` (Q10).
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
      ref except `refs/heads/main` and the tags `v0.1.0`, `v0.1.1`, `v0.2.0`, `v0.3.0` (Q11), then runs one
      `git filter-repo` with `--invert-paths --paths-from-file internal-paths.txt`,
      `--replace-text replacements.txt`, `--mailmap mailmap`, and `--strip-blobs-with-ids
      strip-blobs.txt` if present. Default empty-commit pruning stays on (plan-only commits
      disappear; say so in RUNBOOK.md).
- [ ] Straight after a successful (non-dry) run, `filter.sh` copies `commit-map` and `ref-map`
      from `"$(git -C <mirror-clone-dir> rev-parse --git-dir)/filter-repo/"` (a mirror clone is
      bare and has no nested `.git`; never hard-code `.git/filter-repo/`) to
      `ops/go-public/out/<freeze-sha>/` in the companion repo (or a path given with `--out`), and
      prints the two destination paths. It exits non-zero if either source file is missing or the
      copy fails. These preserved copies are the only maps that count: filter-repo's own copies
      are local metadata and do not survive a push and clone (Amendment 2).
- [ ] `replacements.txt` replaces the exact Ascend path-data literal with a neutral valid path
      (e.g. `M0 0`) and the Ascend copyright comment line with a neutral line, plus each personal
      path from the discovery with a generic one (`/home/andrew/homelab/bin/foundry-link` to
      `<foundry-link script>`, `andrew@homelab.local` to `user@foundry-host`,
      `/srv/dev/projects/foundry-modules/agent-gateway` to `<checkout>`, and each "homelab"
      phrase found in docs/spikes/foundry-socket-identity.md and docs/testing.md history to a
      generic "test server" phrase). Rules are literal or anchored regexes, never a bare
      `homelab` word replacement across all files without first listing every hit.
- [ ] `mailmap` is exactly the one line
      `AindriuB <3417729+AindriuB@users.noreply.github.com> <aindriubannister@gmail.com>`, so the
      name and email of every author and committer with the old email change (Q10). After the run,
      `git log --all --format='%an <%ae>%n%cn <%ce>' | sort -u` prints only
      `AindriuB <3417729+AindriuB@users.noreply.github.com>` and `GitHub <noreply@github.com>`.
      LICENSE is byte-identical at main before and after (`git diff <old> <new> -- LICENSE` empty).
- [ ] `filter.sh --dry-run` runs `git filter-repo --dry-run` and leaves
      `$(git rev-parse --git-dir)/filter-repo/fast-export.original` and `.filtered` for
      inspection; RUNBOOK.md says how to diff them.
- [ ] `verify.sh --commit-map <path> [--ref-map <path>] <original-mirror> <rewritten-repo>`
      exits 0 only if all of these hold, printing one PASS/FAIL line per check and never printing
      a matched secret-like value. `--commit-map` is required and always points at the preserved
      copy from `filter.sh`, never at the rewritten repo's own `filter-repo/` directory. If the
      flag is absent, the file does not exist or is empty, or its header is not filter-repo's
      `old new` header, verify.sh prints `FAIL commit-map: <reason>` and exits non-zero before
      running any check (Amendment 2):
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
         By Q13/Q14, `patterns.txt` contains no pattern that matches `gw.aindriub.app`,
         `dl.aindriub.app`, `AindriuB`/`aindriub` on its own, either FUNDING.yml content, or
         any of the kept public identity listed in Context. verify.sh runs a pattern self-test
         before the scan, using the same matcher and case rule as the scan, and fails it unless
         the patterns match none of `https://gw.aindriub.app/mcp`,
         `https://dl.aindriub.app/x.zip`, `github: AindriuB`, `ko_fi: AindriuB`,
         `ko_fi: aindriub`, `https://github.com/sponsors/AindriuB`,
         `https://ko-fi.com/aindriub`, `ghcr.io/aindriub/foundry-agent-gateway:0.3.0`,
         `https://github.com/AindriuB/agent-gateway/releases/latest/download/module.json`,
         `https://github.com/AindriuB/agent-gateway/releases/download/v0.3.0/agent-gateway.zip`,
         `"authors": [{ "name": "AindriuB" }]`, `"author": "AindriuB"` and
         `AindriuB <3417729+AindriuB@users.noreply.github.com>`, and match each of
         `/home/andrew/x`, `/Users/Andrew/x`, `aindriubannister@gmail.com` and `homelab`.
      4. **Identity.** Every author and committer in the rewritten repo is
         `AindriuB <3417729+AindriuB@users.noreply.github.com>` or `GitHub <noreply@github.com>`
         (name and email both checked, Q10).
      5. **Refs.** Only main and exactly the tags v0.1.0, v0.1.1, v0.2.0, v0.3.0 exist
         (`git tag -l '*-rc*'` is empty); each tag points at the rewritten
         counterpart of its old commit, looked up in the `--commit-map` file (the mapping table
         is printed). An old tag commit missing from the map fails.
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
      1. OWNER: declare the freeze SHA only once 147's freeze precondition holds (146 plus 109,
         110, 111, 113 and 114 merged); stop merging to main. SCRIPT: print
         `gh pr list -R AindriuB/agent-gateway --state open --json number,title,headRefName` and
         `git branch -r --no-merged origin/main`, and exit non-zero if any open PR or unmerged
         branch names task 146, 109, 110, 111, 113 or 114. An open PR or unmerged branch for
         112 does not fail the check; the script lists it pre-marked "port" (Amendment 7).
         OWNER: mark each remaining open PR or branch "abandon" or "port". Before any PR is closed or any branch deleted, every branch to port goes into a
         self-contained `<backup-dir>/open-branches.bundle` outside the checkout
         (`git bundle create` with no `^` exclusions, then `git bundle verify`), and the bundle
         is restored into a scratch repository (`git -C <scratch> fetch <bundle>
         'refs/heads/*:refs/heads/*'`). For each branch, compare the tip commit id, the
         `<branch>^{tree}` id and the full `git ls-tree -r --full-tree <branch>` output between
         the original and the scratch copy, printing one PASS/FAIL line per branch; nothing is
         closed or deleted until every line is PASS (Amendment 4). Once the rewritten main exists
         (after step 6), fetch the bundle into a checkout of it under `refs/old/*` and re-apply
         each branch, excluding internal paths: branches containing merges
         (`git rev-list --merges <base>..refs/old/<branch>` non-empty) by `git cherry-pick`
         (`-m 1` for merge commits) or `git rebase --rebase-merges --onto main <base> <branch>`;
         linear branches may use `git format-patch` piped to `git am`, but only as the carrier.
         Patches are never the backup.
      2. SCRIPT: fresh `git clone --mirror` of AindriuB/agent-gateway; `filter.sh` (which
         preserves commit-map and ref-map under `ops/go-public/out/<freeze-sha>/`; commit that
         folder to the private companion); `verify.sh --commit-map
         ops/go-public/out/<freeze-sha>/commit-map <original-mirror> <rewritten-mirror>`.
      3. OWNER: download all assets of the 0.3.0 release with `gh release download v0.3.0` into
         a local folder, and record its title and notes. The 0.1.0 draft is not re-created
         (Q11); it stays on the frozen archive.
      4. OWNER: rename AindriuB/agent-gateway to AindriuB/agent-gateway-private (Settings,
         Rename); confirm it stays private. GitHub's redirect from the old name ends as soon as a
         new repo takes the name, which is what makes module.json's URLs hit the new repo.
      5. OWNER: create AindriuB/agent-gateway as **private** first, empty, no README.
      6. OWNER: push the rewritten main and tags (`git push origin main v0.1.0 v0.1.1 v0.2.0
         v0.3.0`, tags named explicitly; never `--mirror`, never `--force` to the archive).
      7. OWNER: re-create releases with `gh release create v0.3.0 -R AindriuB/agent-gateway
         --title "Agent Gateway 0.3.0" --notes-file … --latest <assets>`; while the repo is
         private, check them with `gh release view` and `gh release download` (authenticated).
      8. OWNER: repo settings that work while private: Actions "Require approval for
         first-time contributors", branch protection on main requiring the `test` check, Issues
         on, Discussions per preference. Private vulnerability reporting is NOT here: GitHub
         offers it only on public repos, so it moves to step 12 (Amendment 2).
      9. OWNER: GHCR package `foundry-agent-gateway`: connect it to the new repo (Package
         settings, Manage Actions access, give the new repo write). Visibility stays **private**;
         check an authenticated `docker pull ghcr.io/aindriub/foundry-agent-gateway:0.3.0`.
      10. OWNER + SCRIPT: pre-publish check. Fresh `git clone --mirror` of the pushed private
          AindriuB/agent-gateway and re-run `verify.sh --commit-map
          ops/go-public/out/<freeze-sha>/commit-map <original-mirror> <that clone>` with the same
          preserved map as step 2 (the clone has no `filter-repo/` metadata): all PASS.
          Confirm the package's version list holds nothing that should not go public.
      11. OWNER: **PUBLISH GATE.** Andrew explicitly confirms, in writing in the cut-over PR or
          issue, that steps 1-10 passed and that he is publishing. This is the point of no return:
          nothing after it can be fully rolled back, because clones, forks and pulled images made
          after it cannot be recalled. No step before the gate makes anything public.
      12. OWNER: flip AindriuB/agent-gateway to **public**; check
          `curl -sIL https://github.com/AindriuB/agent-gateway/releases/latest/download/module.json`
          returns 200, and that module.json's `download` URL resolves. Straight after the flip,
          enable private vulnerability reporting (Settings, Code security; SECURITY.md from task
          140 relies on it), then check that the "Report a vulnerability" button SECURITY.md
          points to appears on https://github.com/AindriuB/agent-gateway/security and opens the
          advisory form (`…/security/advisories/new`) when signed in as an account other than
          the owner.
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
      2. Preserve: commit uncommitted changes to a `wip/<name>` branch in that worktree. Every
         inventoried branch tip (every local branch from step 1 with commits not on main, including
         each worktree's branch and the `wip/*` branches just made) goes into a self-contained
         bundle outside the checkout: `git bundle create <backup-dir>/branches.bundle <every such
         branch>` (no `^` exclusions, so the full history including merge commits and their
         conflict resolutions travels), then `git bundle verify <backup-dir>/branches.bundle`
         (Amendment 4). `git format-patch` is **NOT** the backup: it skips merge commits and any
         change made in a merge. It may still be used later, in step 4, only as a transport for
         re-applying linear work. Stashes are **not** exported with `git stash show -p` (by default it drops
         untracked files and binary content; Amendment 3). Instead, for each entry N, without
         touching the stash stack: `git branch wip/stash-N stash@{N}` (the stash commit, whose
         parents are the base `^1`, the index `^2` and, when present, the untracked-files commit
         `^3`, so all three trees travel with it), plus `git branch wip/stash-N-untracked
         stash@{N}^3` when `git rev-parse -q --verify stash@{N}^3` succeeds. Then write one
         self-contained bundle outside the checkout:
         `git bundle create <backup-dir>/stashes.bundle <every wip/stash-* branch>` (no `^`
         exclusions), and `git bundle verify` it. The runbook never runs `git stash` push, pop,
         apply, drop or show -p.
      2a. Verify the backup before it counts as complete; any mismatch stops the migration for
         that machine. List the folder and confirm it is non-empty for each item in the
         inventory. Then restore the bundle into a scratch repository outside the checkout
         (`git init <scratch> && git -C <scratch> fetch <backup-dir>/stashes.bundle
         'refs/heads/*:refs/heads/*'`) and, for every stash N and every tree that exists on the
         original (`stash@{N}`, `stash@{N}^2`, `stash@{N}^3`), compare the original's
         `git rev-parse <rev>^{tree}` with the scratch copy's `wip/stash-N`, `wip/stash-N^2`,
         `wip/stash-N^3` tree ids, and diff `git ls-tree -r --full-tree` output (mode, blob hash,
         path) between the two, so untracked and binary files are covered by content hash. A
         tree present on one side and absent on the other is a failure. The step prints one
         PASS/FAIL line per stash and per tree. Branches are verified the same way (Amendment 4):
         fetch `<backup-dir>/branches.bundle` into the scratch repository with the same
         `'refs/heads/*:refs/heads/*'` refspec, and for every inventoried branch check that
         (a) `git rev-parse <branch>` in the scratch copy equals the original's commit id, so the
         whole history including merges survived, (b) `git rev-parse <branch>^{tree}` matches,
         and (c) `git ls-tree -r --full-tree <branch>` output is identical on both sides. A branch
         missing from the restored repo is a failure. The step prints one PASS/FAIL line per
         branch. Nothing (worktree, branch or checkout) is removed, reset or renamed until every
         stash, tree and branch line is PASS; a non-empty folder alone never counts as a pass.
      3. Replace: fresh `git clone https://github.com/AindriuB/agent-gateway` into a new directory
         (preferred), or, only once step 2 is confirmed, `git fetch` the new remote and
         `git reset --hard origin/main` in the main checkout after removing each old worktree with
         `git worktree remove` and deleting its pre-rewrite branch. The old checkout directory is
         kept (renamed) until Andrew deletes it.
      4. Run 147's `link.sh` in the new checkout and in each new worktree; fetch
         `branches.bundle` into the new checkout under a separate namespace (e.g.
         `'refs/heads/*:refs/old/*'`) and re-apply preserved work onto the new main, excluding
         internal paths. Linear branches may use `git format-patch` from the bundle refs piped to
         `git am` as transport only. Branches containing merges
         (`git rev-list --merges <base>..refs/old/<branch>` is non-empty) are re-applied by
         `git cherry-pick` of their commits (`-m 1` for merges) or by
         `git rebase --rebase-merges --onto main <base> <branch>` from the bundle refs, never by
         patches alone. Stash work is
         re-applied from the bundle's `wip/stash-N` branches (tracked changes via
         `git diff wip/stash-N^1 wip/stash-N`, untracked files via
         `git restore --source=wip/stash-N^3 -- <paths>`), never via `git stash apply`.
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
- [ ] Q12: `git -C <rewritten-repo> show main:CONTRIBUTING.md | rg -c "private archive"` prints
      `1` (the line task 146 added); verify.sh runs this check and prints PASS/FAIL. RUNBOOK.md says "Merge pull request #NNN" messages are left unchanged and points at
      that CONTRIBUTING.md line.
- [ ] After step 7, `gh release list -R AindriuB/agent-gateway` lists only "Agent Gateway 0.3.0"
      (Latest), and its asset names equal those downloaded in step 3.
- [ ] Nothing is pushed, renamed or created on GitHub by the implementer
      (`gh api` calls in scripts are read-only, and the scripts refuse to run `git push`).

## Out of scope

- Any change to the public repo's tree (tasks 140-146 did the tree; this task only rewrites
  history).
- Cutting, tagging or publishing 0.4.0; npm publish; the Foundry package listing; Ask Foundry
  answers.
- The hosted builds on dl.aindriub.app (unaffected: they are built from the tree).
- Rewriting e2e/** comments or "Andrew" as a first name anywhere in history.
- Re-numbering or rewriting `#NNN` PR references in commit messages (Decided Q12: unchanged).
- Rewriting the gw./dl.aindriub.app hostnames or the early FUNDING.yml in history (Q13/Q14).
- The per-connection frame budget (T17) and `welcome` capability negotiation (Q15: follow-ups,
  not prerequisites for going public or for 0.4.0).

## Owner questions

- Q10 commit author name — Decided (owner, 2026-10-16): map name to "AindriuB" and email to
  `3417729+AindriuB@users.noreply.github.com`, author and committer; LICENSE keeps the legal name.
- Q11 tags and releases — Decided (owner, 2026-10-16): keep v0.1.0, v0.1.1, v0.2.0, v0.3.0; drop
  v0.1.0-rc.1, v0.1.0-rc.2 and any other rc tag; drop the 0.1.0 draft; re-create only the 0.3.0
  release with its assets.
- Q12 `Merge pull request #NNN` messages — Decided (owner, 2026-10-16): leave unchanged; one line
  in CONTRIBUTING.md (task 146) explains them.
- Q13 `.github/FUNDING.yml` in early history — Decided (owner, 2026-10-16): keep.
- Q14 gw./dl.aindriub.app hostnames in history — Decided (owner, 2026-10-16): keep, no rewrite;
  verify.sh does not count them as failures.
- Q15 frame budget (T17) and `welcome` capability negotiation — Decided (owner, 2026-10-16): not
  prerequisites for going public or 0.4.0; follow-ups.

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

### Amendment 2 (from external PR review, 2026-10-16)

- [P2] Step 8 enabled private vulnerability reporting while the new repo was still private, but
  GitHub offers that setting only on public repositories, so steps 1-10 could never all
  complete. Step 8 now keeps only the settings that work while private; enabling private
  vulnerability reporting moves to step 12 straight after the visibility flip, with a check that
  the "Report a vulnerability" entry point SECURITY.md (task 140) promises works on the public
  repo.
- [P2] Step 10 re-ran verify.sh against a fresh mirror, but check 5 read
  `.git/filter-repo/commit-map`, which is local metadata that does not survive a push and clone
  (and in a bare mirror lives at `$(git rev-parse --git-dir)/filter-repo/`, not under `.git/`).
  `filter.sh` now copies commit-map and ref-map to `ops/go-public/out/<freeze-sha>/` right after
  the run, resolving the source through `git rev-parse --git-dir`; `verify.sh` takes a required
  `--commit-map <path>` (optional `--ref-map`) used for both the step 2 and step 10 runs, and
  fails clearly when the map is missing, empty or malformed.

### Amendment 3 (from external PR review, 2026-10-16)

- [P2] Step 14's preserve step exported stashes with `git stash show -p`, which by default
  covers only tracked changes. A stash holding untracked files produced a non-empty patch that
  passed the "folder non-empty" check, yet restoring it dropped the untracked files, and deleting
  the old checkout would then lose them. Stashes are now preserved version-independently as
  `wip/stash-N` branches at `stash@{N}` (carrying the `^2` index and `^3` untracked parents),
  plus `wip/stash-N-untracked` at `stash@{N}^3` when present, written to a self-contained
  `git bundle` outside the checkout; the stash stack is never touched (no `git stash` push, pop,
  apply, drop or show -p). A new step 2a restores the bundle into a scratch repository and
  compares tree ids and `git ls-tree -r` listings (mode, blob hash, path) against the original
  `stash@{N}`, `^2` and `^3` trees, covering untracked and binary files; any mismatch fails the
  backup and blocks step 3. Step 4 re-applies stash work from those branches.

### Amendment 4 (from external PR review, 2026-10-16)

- [P2] Step 14's preserve step backed up unpushed branches with
  `git format-patch origin/main..<branch>`, which leaves out merge commits along with any
  conflict resolutions or changes made in a merge. Ordinary commits still made the backup folder
  non-empty, so the preservation check passed while work was missing, and deleting the old
  worktree and branch could then lose it. Every inventoried branch tip (all local branches not on
  the new main, including worktree and `wip/*` branches) now goes into a self-contained
  `branches.bundle` with no `^` exclusions, checked with `git bundle verify`. Step 2a restores it
  into the scratch repository and, per branch, compares the tip commit id, the `^{tree}` id and
  the full `git ls-tree -r --full-tree` listing against the original, printing one PASS/FAIL line
  per branch; nothing is removed, reset or renamed until every line passes. `format-patch` stays
  only as a transport for re-applying linear work in step 4 and is explicitly not the backup;
  branches containing merges are re-applied by cherry-pick or `git rebase --rebase-merges` from
  the bundle refs.
- [P2] Owner step 1 ported open PRs and branches with `git format-patch` from the old repo and
  `git am` onto the new main, which has the same merge-loss problem. Step 1 now carries each
  branch across as refs from a verified `open-branches.bundle` (no `^` exclusions,
  `git bundle verify`), compares tip commit id, `^{tree}` id and `git ls-tree -r --full-tree`
  output against the original in a scratch repository with one PASS/FAIL line per branch before
  anything is closed or deleted, and re-applies onto the rewritten main by cherry-pick (`-m 1`
  for merges) or `git rebase --rebase-merges`, keeping patches only as the carrier for linear
  branches.

### Amendment 5 (owner answers, 2026-10-16)

- Q9: runbook step 1 now requires 147's freeze precondition (146 and 109-114 merged) and a
  script check over open PRs and unmerged branches.
- Q10: concrete one-line `mailmap` (name and email); identity check covers names.
- Q11: the four kept tags are named in filter.sh, check 5, steps 3, 6 and 7; rc tags and the
  0.1.0 draft are dropped.
- Q12: PR-number messages unchanged; new acceptance item checks 146's CONTRIBUTING.md line.
- Q13/Q14: FUNDING.yml and gw./dl.aindriub.app hostnames stay; verify.sh's personal-string check
  gains a pattern self-test so they never count as failures while personal paths, the old email
  and the homelab name still do.
- Q15: T17 frame budget and `welcome` capability negotiation recorded as non-prerequisites.

### Amendment 6 (external review and owner decision, 2026-10-16)

- [P2, external review] 146's scrub `rg` could never pass because it also matched the kept GHCR
  image name. Checked here for the same trap: check 3's patterns did not hit the kept public
  identity, but the self-test only proved it for the hostnames and FUNDING.yml handles. Context
  now lists the kept public identity (GHCR image, module.json URLs on
  github.com/AindriuB/agent-gateway, author "AindriuB", FUNDING handles, the Sponsors and Ko-fi
  links, the Q10 noreply identity), and the self-test must show the patterns match none of it,
  with the same matcher and case rule as the scan, while personal paths, the old email and
  "homelab" still match. `gw.`/`dl.aindriub.app` stay non-failures here by Q14.
- Owner decision (146 Amendment 2): the new `.github/FUNDING.yml` is `github: AindriuB` then
  `ko_fi: aindriub`, and README links `https://github.com/sponsors/AindriuB`. Context updated;
  both are in the self-test's must-not-match list. Q13 still refers to the old FUNDING.yml in
  history (c117d4d to 5f8ed04), kept as is.

### Amendment 7 (owner decision, Andrew, 2026-10-16)

- Going public does NOT wait for homelab task 112 (persist pending approvals, now decided as
  option A). The Q9 freeze precondition changes from "146 and 109-114" to "146 plus 109, 110,
  111, 113 and 114" in the Q9 decision and in runbook step 1, including its script check, which
  no longer fails on a 112 PR or branch. Supersedes the Q9 line of Amendment 5.
- 112 lands in the public repo after it goes public. If its branch exists at freeze time, it is
  marked "port" rather than blocking, and it is ported by bundle per Amendment 4's procedure in
  step 1 (verified `open-branches.bundle`, PASS per branch before anything is closed or deleted,
  re-applied onto the rewritten main by cherry-pick or `git rebase --rebase-merges`).
