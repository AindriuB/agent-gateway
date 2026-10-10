# Architecture

The shape of the system: what the pieces are, what talks to what, and where the
boundaries are. `explorer` and `architect` read this before inferring
structure from the filesystem, so keeping it honest saves every session a
search.

Keep it to the parts that are stable. Anything that changes weekly belongs in a
repo's own `PROJECT.md` (the agent guide that `CLAUDE.md` and `AGENTS.md` point to), not here.

## Components

<!--
| Component | Directory | Port | Owns |
|---|---|---|---|
| ... | ... | ... | ... |
-->

## Repository topology

A workspace root spans several repositories that a single `git clone` does not
obtain. Say which they are, which are deliberately untracked here and why, and
give the exact commands that assemble a working setup from scratch — including
which remotes are SSH and which are HTTPS, rather than assuming one everywhere.

`.claude/` is untracked on purpose: it holds the worktree scripts installed from
the agent-kit repo, whose single clone lives outside every project it serves and
is refreshed with `git -C <kit> pull`. The roles themselves are not here at all —
`agents/` and `commands/` are symlinked into `~/.claude`, shared by every
project. Tracking any of it here would fork the harness away from that upstream.
Sibling project directories
are likewise untracked — each is its own repository with its own remote, a plain
directory this repo's `.gitignore` excludes, not a submodule and not a nested
tracked tree. Git has no record of them at all from this repo's side, so nothing
about cloning this repo alone tells you they exist.

<!--
| Repo | Role | Tracked here? |
|---|---|---|
| ... | ... | ... |
-->

<!--
```
git clone <workspace-repo> <dir> && cd <dir>
git clone <project-repo-1>
git clone <project-repo-2>
git clone git@github.com:AindriuB/workspace.git .claude && .claude/install.sh
```
-->

If a repo has been renamed, say so and say what older `HISTORY.md` entries call
it — otherwise every entry written before the rename reads as a fourth repo that
does not exist.

## How they talk

<!-- Synchronous calls, queues, shared databases. Name the contract and where it
     is defined. Direction matters: say who calls whom. -->

## Boundaries that must not be crossed

<!-- e.g. "nothing but the transaction service writes to the ledger tables" —
     the rules whose violation is a defect regardless of how the code reads. -->

## Decisions worth knowing

<!-- One line each, with the date and the alternative that was rejected. -->
