# 03 — Build the tool definition framework and JSON Schema generation

**Repo:** .
**Depends on:** 01
**Owns:**
- protocol/src/tools/**
- protocol/test/tools/**

## Goal
Give every tool a single zod definition in `protocol/` carrying name, minimum
role, category, input and output schemas and which side handles it, from which
the gateway emits client-facing JSON Schema and the module validates arguments.
Enforce the cross-vendor schema rules mechanically so later tool tasks cannot
drift. Ship the framework with an empty registry; tools arrive in 09 onward.

## Context
- docs/plan/specs/2026-10-09-agent-gateway.md:58-66 — conservative JSON Schema: no `oneOf`, no deep nesting, no open objects; small tool sets
- docs/plan/specs/2026-10-09-agent-gateway.md:74-76 — operation registry fields: name, minimum role, schema, category
- docs/plan/specs/2026-10-09-agent-gateway.md:143-161 — full tool list, role split, short text plus structured content
- docs/conventions.md — `protocol/src/tools/index.ts` is insertion-only

## Acceptance
- [ ] `defineTool({name, minRole: 'player'|'gm', category: 'read'|'write'|'destructive'|'code', handledBy: 'module'|'gateway', description, input, output})` exported from `protocol/src/tools/define.ts`; `name` must match `/^[a-z][a-z0-9_]{2,40}$/`
- [ ] `protocol/src/tools/index.ts` exports `TOOLS` (readonly array, empty in this PR) and `toolsForRole(isGM)`; later tasks only append entries
- [ ] `toJsonSchema(tool)` uses zod v4 JSON Schema output and returns `inputSchema`/`outputSchema` objects
- [ ] `protocol/test/tools/conservative-schema.test.ts` sweeps every entry in `TOOLS` plus fixture tools and fails on: `oneOf`/`anyOf`/`allOf`, object nesting deeper than 3, `additionalProperties` not `false`, missing `description` on top-level properties; it has fixtures proving each failure fires
- [ ] `protocol/test/tools/tool-count.test.ts` fails if `toolsForRole(false).length > 24` or `toolsForRole(true).length > 36`; the limits are named constants with a comment pointing at spec section 4
- [ ] Duplicate tool names in `TOOLS` fail a test
- [ ] `npm test -w protocol` passes

## Out of scope
- Any concrete tool schema (09, 10 and later vertical tasks)
- Link messages (02)
- Gateway MCP wiring (05)
