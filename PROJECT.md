# agent-gateway

<!-- The single project guide for every AI agent (Claude, ChatGPT/Codex, Gemini, others).
     CLAUDE.md and AGENTS.md only point here; put shared instructions in this file.
     HARD CAP: 50 lines. This file is a router, not a manual. Detail belongs in docs/. -->

Foundry VTT module + MCP gateway. Spec: `docs/plan/specs/2026-10-09-agent-gateway.md`.

## Read on demand, not up front

| Need                                                             | File                         |
| ---------------------------------------------------------------- | ---------------------------- |
| How we work (the loop, roles, parallelism)                       | `docs/workflow.md`           |
| Code style, naming, commit format, test suites                   | `docs/conventions.md`        |
| What is open, in priority order                                  | `docs/plan/PLAN.md`          |
| What was already built: scan this, never open `HISTORY.md` whole | `docs/plan/HISTORY-INDEX.md` |
| One task's full contract                                         | `docs/plan/tasks/<id>.md`    |
| System shape, service boundaries, ports                          | `docs/architecture.md`       |
| End-to-end tests against a live Foundry                          | `docs/testing.md`            |

Load exactly one of these when the task needs it. Do not preload the set.

## Roles

Work is split by role, and each returns a conclusion, not a transcript.
Explorer (read-only recon) · architect (read-only judgement) · planner (writes
task files) · implementer (one task, one worktree) · tester (pass or fail, with
the minimal detail) · code-reviewer (hunts bugs and style breaks in a diff before verify; routes spec
changes to the orchestrator) · reviewer (checks a diff against its task) · scribe (the
only role that edits `PLAN.md`, `HISTORY*.md` and `docs/`). See `docs/workflow.md`.

## Rules that hold everywhere

1. One task = one worktree = one branch. Never two agents in one tree.
2. A task file names the files it owns. Editing outside that set is a bug:
   stop and report instead.
3. Never paste file contents into a summary. Cite `path:line`.
4. Prefer `rg` over `grep`, and read ranges over whole files.
5. Secrets, tokens and dumps never leave the machine and never enter a doc.
6. Only the scribe writes docs. Only the implementer writes code.
7. Every change lands via a PR Andrew reviews. Never push to `main`.
8. Never `git stash` (worktrees share one stash stack) and never `pkill`; stop
   only processes you started, by PID.
9. `npm run verify` (which also runs the script tests) must pass before a change is
   called done.

## Reviewing a PR

Check the diff against its task file's acceptance criteria and Owns list. Look
hardest at permission leaks, identity taken from anything but Foundry's
server-set user, escaping of untrusted text, and unbounded work or memory.
