# 11 — Wire MCP sessions through the link to the module dispatcher

**Repo:** .
**Depends on:** 05, 06, 07, 08
**Owns:**
- gateway/src/app.ts
- gateway/src/bin/cli.ts
- gateway/src/routing/**
- gateway/src/mcp/session.ts
- gateway/test/routing/**
- module/src/link/bridge.ts
- module/src/main.ts (insert the bridge install call only)
- module/test/link/bridge.test.ts

## Goal
Connect the pieces: the gateway starts the link server, prints the pairing code
on start (stderr), binds each MCP session to one connected Foundry user in one
world, filters the tool list by that user's role, and forwards calls over the
link; the module bridges inbound calls to `dispatch`. Without a connection,
tools keep returning "world offline".

## Context
- docs/plan/specs/2026-10-09-agent-gateway.md:96-101 — sessions bind to one Foundry user in one world; tool list from role; several connections
- docs/plan/specs/2026-10-09-agent-gateway.md:113-118 — lifecycle
- gateway/src/link/** (06), gateway/src/mcp/** (05), module/src/link/** (07), module/src/ops/** (08)

## Acceptance
- [ ] On start the CLI prints `Pairing code: XXXX-XXXX (expires in 10 min)` and the link URL to stderr
- [ ] Session binding: config option `--world <id> --user <name>`; if omitted and exactly one connection exists it binds to it; with several and no selector, `tools/call` returns an error listing the available world/user pairs
- [ ] `tools/list` is `toolsForRole(user.isGM)` of the bound connection; when the bound connection appears or disappears the server sends `notifications/tools/list_changed`
- [ ] `tools/call` validates args with the protocol schema at the gateway (defence in depth), forwards via `LinkRegistry.call`, maps `result` to MCP text + `structuredContent` and `error` to `isError: true` with `{code}`
- [ ] `module/src/link/bridge.ts` installs `onCall` on the link client to run `dispatch` as `game.user`, with `ctx.agent = {id: welcome.agentId, ownerUserId: game.user.id, headless: false}` and `ctx.sessionId` from the call
- [ ] Integration test in `gateway/test/routing/`: in-process gateway + fake module client using the real protocol, MCP client lists and calls a fixture tool, then disconnect yields `WORLD_OFFLINE`
- [ ] Manual check on foundry.local v14: pair, then `world_info` and `document_search` through MCP Inspector return `test-world` data; PR includes output. v13 pending if absent.

## Out of scope
- Playwright automation (12)
- Policy, approvals (13+), HTTP transports (34)
