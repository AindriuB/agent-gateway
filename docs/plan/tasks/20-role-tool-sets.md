# 20 — Filter tool lists by role and policy and announce changes

**Repo:** .
**Depends on:** 13
**Owns:**
- module/src/link/toolset.ts
- module/test/link/toolset.test.ts
- protocol/src/link/messages.ts (insertions only)
- gateway/src/routing/**
- gateway/src/mcp/session.ts
- gateway/test/routing/**

## Goal
Keep each session's tool list honest: the module tells the gateway which tools
its user may currently use (role plus categories not denied by policy), and the
gateway sends `tools/list_changed` whenever that set changes, such as a role
change or a GM policy edit.

## Context
- docs/plan/specs/2026-10-09-agent-gateway.md:96-100 — tool list from the user's role; `tools/list_changed`
- docs/plan/specs/2026-10-09-agent-gateway.md:58-66 — keep tool sets small
- module/src/policy/** (13); gateway/src/routing/** (11)

## Acceptance
- [ ] New link message `toolset {tools: string[]}` sent after `welcome` and on `updateUser` (role) and policy setting changes
- [ ] Module computes the set as `toolsForRole(isGM)` minus tools whose category policy resolves to `deny` for this agent
- [ ] Gateway `tools/list` returns the intersection of role tools and the last `toolset`; a change triggers exactly one `notifications/tools/list_changed` (test)
- [ ] Calling a tool not in the current set returns `FORBIDDEN` at the gateway without a link round-trip
- [ ] `npm run verify` passes

## Out of scope
- OAuth scope filtering (35)
