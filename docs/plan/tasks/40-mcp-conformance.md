# 40 — Add MCP conformance and cross-vendor schema checks

**Repo:** .
**Depends on:** 35, 20e
**Owns:**
- scripts/conformance.sh
- gateway/test/conformance/**
- docs/compatibility.md
- package.json (`test:conformance` script insertion only)

## Goal
Automate what can be automated of the compatibility matrix: run MCP Inspector's
CLI against stdio, local HTTP and OAuth modes, and keep a manual checklist for
Claude, ChatGPT and Gemini to tick before each release.

## Context
- docs/plan/specs/2026-10-09-agent-gateway.md:58-66 — cross-vendor rules and compatibility matrix
- gateway transports (05, 34, 35)

## Acceptance
- [ ] `npm run test:conformance` starts the gateway in each mode with a fake module and runs `@modelcontextprotocol/inspector --cli` `tools/list` and one `tools/call`; non-zero on any failure
- [ ] A test asserts every emitted `inputSchema` has `type: object`, `additionalProperties: false` and no `$ref`
- [ ] The fake module also announces a fixture pack tool; the same checks cover it, and every listed tool name matches `^[a-zA-Z0-9_-]{1,64}$` with at least 27 characters to spare (the vendor intersection recorded in `docs/packs/naming.md`, 20b)
- [ ] `docs/compatibility.md` holds the matrix (client x transport) with a manual checklist per release for Claude Desktop, Claude Code, claude.ai, ChatGPT, Gemini CLI, Gemini app
- [ ] PR includes a passing run

## Out of scope
- Per-client setup guides (43)
