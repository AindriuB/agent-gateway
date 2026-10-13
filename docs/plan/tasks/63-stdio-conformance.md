# 63 — Add stdio MCP conformance and cross-vendor schema checks

**Repo:** .
**Depends on:** none
**Status:** MVP A
**Owns:**
- scripts/conformance.sh
- gateway/test/conformance/**
- docs/compatibility.md

## Goal
The MVP A slice of task 40: automate conformance for the one transport MVP A
ships (stdio), check every emitted tool schema against the cross-vendor rules,
and start the compatibility matrix with the Claude Desktop and Claude Code rows.
Task 40 later adds the local HTTP and OAuth modes to the same script.

## Context
- docs/plan/tasks/40-mcp-conformance.md — the full contract this is split from
- docs/plan/specs/2026-10-09-agent-gateway.md "Cross-vendor rules" (line 89 onward)
- gateway/test/routing/harness.ts — existing fake-module harness to reuse
- docs/packs/naming.md (20b) — tool-name rule and the 27-character margin
- gateway/src/app.ts:18 — default store at `~/.foundry-agent-gateway/gateway.db`, which the run must not touch

## Acceptance
- [ ] `scripts/conformance.sh` (bash, `set -euo pipefail`, expects a built tree) starts the gateway over stdio with a fake module connected, runs `npx -y @modelcontextprotocol/inspector@<exact pinned version> --cli` for `tools/list` and one `tools/call` that round-trips through the link to the fake module, and exits non-zero on any failure
- [ ] The run uses a temp `HOME` (or equivalent) and a non-default link port; it leaves `~/.foundry-agent-gateway` unchanged
- [ ] A vitest test under `gateway/test/conformance/` asserts every emitted `inputSchema`, core and a fixture pack tool announced by the fake module, has `type: "object"`, `additionalProperties: false` and no `$ref`, and every tool name matches `^[a-zA-Z0-9_-]{1,64}$` and is at most 37 characters
- [ ] `docs/compatibility.md` holds a client × transport matrix; the Claude Desktop (stdio and `.mcpb`) and Claude Code (stdio) rows are marked "MVP A" with a per-release manual checklist; local HTTP, OAuth, claude.ai, ChatGPT, Gemini CLI and Gemini app appear marked "not supported in this release (MVP B)"
- [ ] PR includes a passing `scripts/conformance.sh` run; `npm run verify` passes
- [ ] No `package.json` or `package-lock.json` change (64 adds the `test:conformance` alias)

## Out of scope
- Local HTTP and OAuth modes, and their matrix rows (40)
- Per-client setup guides (65, 43)
- Root `package.json` scripts (64)
