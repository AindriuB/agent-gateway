# 05 — Build the gateway skeleton with a stdio MCP server

**Repo:** .
**Depends on:** 03
**Owns:**
- gateway/src/bin/**
- gateway/src/app.ts
- gateway/src/config/**
- gateway/src/mcp/**
- gateway/src/log.ts
- gateway/test/mcp/**
- gateway/test/config/**

## Goal
Make `npx foundry-agent-gateway` start a working MCP server over stdio that
lists tools from the `protocol` registry and answers every call with a
"world offline" result until a module is connected. This fixes the gateway's
composition root, config loading and logging (stderr only, since stdout is the
MCP channel).

## Context
- docs/plan/specs/2026-10-09-agent-gateway.md:92-104 — gateway is thin, no game logic; sessions bind to one Foundry user in one world
- docs/plan/specs/2026-10-09-agent-gateway.md:113-118 — tools return "world offline" while no module is connected
- protocol/src/tools/define.ts, protocol/src/tools/index.ts — from 03
- docs/conventions.md — default ports, layout

## Acceptance
- [ ] `gateway/src/bin/cli.ts` parses `--version`, `--help`, `--config <path>`, `--link-port <n>`; unknown flags exit 2 with usage on stderr
- [ ] `gateway/src/config/` loads config from file then env (`AGENT_GATEWAY_*`) then flags, validated with zod; a config file readable by group or other is refused with an error naming the path and `chmod 600`
- [ ] `gateway/src/app.ts` exposes `createApp(config)` returning start/stop and a `ModuleConnections` interface (`get(worldId,userId)`, `any()`) with an in-memory empty implementation that later tasks replace
- [ ] `gateway/src/mcp/` builds an MCP server with `@modelcontextprotocol/sdk` over stdio; `tools/list` returns the protocol tools for the bound role with JSON Schema from `toJsonSchema`; with an empty registry it returns `[]`
- [ ] With no module connected, `tools/call` for any registered tool returns `isError: true` with text containing `world offline` and structured `{code:'WORLD_OFFLINE'}` (tested with a fixture tool)
- [ ] Nothing is written to stdout except MCP frames (test spawns the CLI and asserts every stdout line parses as JSON-RPC)
- [ ] `npx @modelcontextprotocol/inspector` against `node gateway/dist/bin/cli.js` connects and lists tools; PR includes the output

## Out of scope
- WebSocket link server, pairing, SQLite (06)
- Routing calls to a module (11)
- HTTP transports and auth (34, 35)
