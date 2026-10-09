# 11 — Wire MCP sessions through the link to the module dispatcher

**Repo:** .
**Depends on:** 05, 06, 07, 08
**Owns:**
- gateway/src/app.ts
- gateway/src/bin/cli.ts
- gateway/src/routing/**
- gateway/src/mcp/session.ts
- gateway/test/routing/**
- gateway/src/link/registry.ts (isolation defect fixes only)
- gateway/src/link/server.ts (isolation defect fixes only)
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
- gateway/src/link/registry.ts:101-125 — connections keyed by (worldId, userId) from `hello`; same key replaces the old connection
- gateway/src/link/server.ts:145-155 — pending calls are per connection and settle only on the receiving socket
- gateway/test/link/server.test.ts:235-241 — the only two-user test today; it only counts connections
- module/src/ops/dispatch.ts:24 — `dispatch(call, user)` takes `OpUser` from its caller

## Acceptance
- [ ] On start the CLI prints `Pairing code: XXXX-XXXX (expires in 10 min)` and the link URL to stderr
- [ ] Session binding: config option `--world <id> --user <name>`; if omitted and exactly one connection exists it binds to it; with several and no selector, `tools/call` returns an error listing the available world/user pairs
- [ ] `tools/list` is `toolsForRole(user.isGM)` of the bound connection; when the bound connection appears or disappears the server sends `notifications/tools/list_changed`
- [ ] `tools/call` validates args with the protocol schema at the gateway (defence in depth), forwards via `LinkRegistry.call`, maps `result` to MCP text + `structuredContent` and `error` to `isError: true` with `{code}`
- [ ] `module/src/link/bridge.ts` installs `onCall` on the link client to run `dispatch` as `game.user`, with `ctx.agent = {id: welcome.agentId, ownerUserId: game.user.id, headless: false}` and `ctx.sessionId` from the call
- [ ] The bridge passes `{id: game.user.id, isGM: game.user.isGM}` as the `OpUser` to `dispatch` and never reads a user id, role or `isGM` from the call frame; `module/test/link/bridge.test.ts` sends a call frame carrying a forged `userId`/`isGM: true` while `game.user` is a player stub and asserts `dispatch` received the stub's id and `isGM: false`
- [ ] `gateway/test/routing/isolation.test.ts` runs an in-process gateway with two fake module clients connected at once (same world, users A and B, real protocol) and asserts:
  - a `tools/call` from an MCP session bound to A produces a `call` frame on A's socket only; B's socket receives nothing
  - A reconnecting with its stored token (replacing A's connection) leaves B's connection listed and B's in-flight pending call still settles with B's result
  - a `result` and an `error` frame sent by B carrying the id of A's pending call do not settle A's call; A's call still settles from A's socket
  - after A disconnects while B stays connected, a call from the session bound to A returns `WORLD_OFFLINE` and B's socket receives nothing (no fallback to "any" connection when more than one user is or was connected); when A reconnects the same session reaches A again
- [ ] A session is bound once, at bind time, to a (worldId, userId) pair and never rebinds itself to a different user; the implicit "exactly one connection" binding is recorded as that pair, not as "whatever is connected"
- [ ] Integration test in `gateway/test/routing/`: in-process gateway + fake module client using the real protocol, MCP client lists and calls a fixture tool, then disconnect yields `WORLD_OFFLINE`
- [ ] Manual check on foundry.local v14: pair, then `world_info` and `document_search` through MCP Inspector return `test-world` data; PR includes output. v13 pending if absent.

## Out of scope
- Playwright automation (12)
- Policy, approvals (13+), HTTP transports (34)
- Stopping a different browser from claiming a user id or replacing a pairing, and server-mode pairing confirmation (10b, 36); fixes to `gateway/src/link/**` here are limited to defects the isolation tests expose
