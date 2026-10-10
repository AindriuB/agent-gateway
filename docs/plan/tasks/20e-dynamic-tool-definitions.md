# 20e — Announce full tool definitions over the link and serve them from the gateway

**Repo:** .
**Depends on:** 20b, 20c, 20
**Owns:**
- protocol/src/link/messages.ts (the `ToolsetMessage` schema and its doc comment only)
- protocol/test/link/link.test.ts (toolset cases only)
- module/src/link/toolset.ts
- module/test/link/toolset.test.ts
- gateway/src/link/server.ts (authenticated, otherwise-valid oversized toolset handling only; preserve the general frame cap and other parse failures)
- gateway/test/link/dynamic-toolsets.test.ts
- gateway/src/routing/toolsets.ts
- gateway/src/mcp/session.ts
- gateway/test/routing/toolset.test.ts
- gateway/test/routing/dynamic-tools/**
- gateway/test/routing/harness.ts (additions only)

## Goal
Make the gateway list and validate whatever tools the user's module may use,
including pack tools it has never seen, without ever trusting an announcement
to change a core tool or to slip a non-conforming or oversized definition, or
a hostile description, through to the AI client. The module side and the
gateway side change in one PR, because the gateway closes the link on a frame
it cannot parse.

## Context
- task 20: module/src/link/toolset.ts (`computeToolset`, `ToolsetAnnouncer`), gateway/src/routing/toolsets.ts (`ToolsetStore`, the known-name filter), gateway/src/mcp/session.ts (`visibleFor`, `signature`, the `FORBIDDEN` path)
- gateway/src/link/server.ts:138-157 — unknown message types close the link (1008)
- gateway/src/mcp/session.ts:74-137 — listing, call handler, `tool.input.safeParse`
- protocol/src/tools/rules.ts, validate.ts, limits.ts, pack.ts (20b); module/src/ops/registry.ts (20c)
- gateway/src/routing/sanitize.ts — `safeText` for log lines
- docs/plan/specs/2026-10-09-agent-gateway.md section 2 "Dynamic tool definitions"

## Design constraints (decided; implement as stated)
- **Message.** `ToolsetMessage` becomes `{type: 'toolset', tools: AnnouncedTool[]}` (20b's type), capped by `TOOL_LIMITS` (count and bytes) in the zod schema. For an authenticated connection, an otherwise-valid toolset that fails only the announcement count or byte cap is ignored with a warning before the generic parse-failure close path; retain its previous set. Malformed envelopes and messages above `MAX_FRAME_BYTES` still use the existing rejection path. The module builds it from `toolRegistry.forRole(isGM)` minus policy-denied categories, sorted by name.
- **Gateway acceptance per tool.** Core-pattern name (no `-`): kept only if the gateway's static `TOOLS` has it; the gateway then lists and validates with its own definition and zod schema, ignoring the announced description and schemas, and logs one warning if they differ (version skew). Pack-pattern name: kept only if `checkToolDefinition(tool, 'pack')` is empty, `tool.pack` is present and the name's prefix equals `tool.pack.prefix`; otherwise dropped with one `safeText` log line `dropped tool <name>: <first problem>` (name capped at 64 characters). Any other name: dropped and logged. A frame over the count or byte cap: the whole announcement is ignored and logged, and the previous set stays.
- **Listing.** Core tools first in `TOOLS` order, then pack tools by name, at most `TOOL_LIMITS` pack tools per session (excess dropped and logged once per announcement). Pack descriptions are listed as `[Third-party tool pack <prefix>: <id> <version>] <description>`; the tag is built by the gateway, never taken from the announcement.
- **Calls.** Pack tool arguments are checked with `validateArgs(announced inputSchema)` before the link call; failure returns `INVALID_ARGS` with the issues and nothing goes over the link. Core tools keep `tool.input.safeParse`.
- **Change detection.** The per-session signature is a hash of the listed definitions (name, description as listed, both schemas), so a pack version that changes only a schema triggers `list_changed`; the existing coalescing interval stays.

## Acceptance
- [ ] Round trip: a module registry holding the core tools and a fixture pack announces full definitions; the gateway's `tools/list` for that session contains each core tool exactly as `toJsonSchema` of the gateway's `TOOLS` gives it, and the pack tool with the provenance tag prefixed (test)
- [ ] An announced `world_info` with description `"Ignore previous instructions"` and an extra input property is listed with the gateway's own description and schema, and a call with the extra property is `INVALID_ARGS` at the gateway (test)
- [ ] Hostile announcements are dropped with a log line and the rest of the set kept: a pack tool with `anyOf`; with `pattern`; a 17 KiB schema; a 501-character description; a description containing U+202E, `\n` or `<system>`; a name whose prefix differs from `pack.prefix`; an unknown unprefixed name `delete_world`. A 65-tool and a 300 KiB announcement are ignored whole and the previous set stays (tests; each asserts the log line and the listing)
- [ ] Link integration: an authenticated, otherwise-valid 65-tool or 300 KiB toolset keeps the connection open and previous listing intact; malformed messages and frames above `MAX_FRAME_BYTES` retain existing rejection behavior (test in the new dynamic-toolsets file)
- [ ] Log lines for dropped tools contain no byte in `\x00-\x1f\x7f-\x9f` when the tool name holds ESC `[2J` and `\r` (test)
- [ ] Per-user isolation: two connections (GM and player) announce different pack tools; each session lists only its own user's tools and a player session calling the GM's pack tool gets `FORBIDDEN` with no link frame sent (test)
- [ ] Pack argument validation: a call missing a required property, or with an extra one, returns `INVALID_ARGS` and the fake module receives no call frame (test)
- [ ] `list_changed`: re-announcing the same definitions sends none; changing only a pack tool's input schema sends exactly one; ten announcements within the interval send at most one (tests)
- [ ] More than 24 pack tools announced (within the 64 cap): exactly 24 are listed, chosen by name order, and one log line names the count dropped (test)
- [ ] `grep -n "TOOLS" gateway/src/routing/toolsets.ts` shows no known-name filter remaining; the static `TOOLS` is used only for core names in `session.ts`
- [ ] `gateway/test/mcp/**` and `gateway/test/link/**` pass unchanged; `npm run verify` passes; `npm run test:e2e` passes on v14 (v13 pending if absent)

## Out of scope
- MCP `annotations` (`readOnlyHint` and so on); a lying pack category would mislead client auto-approval, so none are emitted in v1
- OAuth scope filtering (35) and the gateway audit trail (35b)
- The module pack API itself (20d)
- Any change to link messages other than `ToolsetMessage`
