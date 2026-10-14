# CLAUDE.md

@PROJECT.md

`PROJECT.md` is the single project guide for every AI agent; keep this file a
pointer and put shared instructions there. Claude Code only: agent definitions
live in `~/.claude/agents/`, and the loop is `/plan` → `/fanout` → `/review` →
`/verify` → `/record` (out of band: `/recon`, `/design`), described in `docs/workflow.md`.
