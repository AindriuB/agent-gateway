# 20b — Add runtime tool-definition rules and a JSON Schema subset validator to protocol

**Repo:** .
**Depends on:** none
**Owns:**
- protocol/src/tools/rules.ts
- protocol/src/tools/limits.ts
- protocol/src/tools/validate.ts
- protocol/src/tools/pack.ts
- protocol/src/tools/index.ts (insertions only: `export *` lines for the four files above)
- protocol/test/tools/conservative-schema.test.ts
- protocol/test/tools/fixtures.ts (insertions only)
- protocol/test/tools/rules/**
- docs/packs/naming.md
- docs/plan/tasks/20b-tool-definition-runtime-rules.md (scope and acceptance amendments only)
- protocol/vitest.config.ts
- protocol/vitest.slow.config.ts
- vitest.config.ts
- package.json (scripts insertions only)

## Goal
Move the conservative-schema check out of a test and into `protocol/src`, so the
module (at pack registration) and the gateway (at announcement) can enforce it on
tool definitions they did not write. Add the rest of the runtime rules a
third-party definition must meet (names, sizes, plain-text descriptions, a
keyword allowlist), and a small validator for that JSON Schema subset, so pack
tool arguments can be checked without zod. The core's own tools must pass the
same rules.

## Context
- protocol/test/tools/conservative-schema.test.ts:15-112 — the walker to move (`walk`, `resolveRef`, `conservativeProblems`); it is a denylist today
- protocol/src/tools/define.ts:7 — `TOOL_NAME_PATTERN` for core names
- protocol/src/tools/json-schema.ts — `toJsonSchema`, what zod emits for core tools
- protocol/src/link/messages.ts:4 — `MAX_FRAME_BYTES` (1 MiB), which the announcement cap must sit well under
- docs/plan/specs/2026-10-09-agent-gateway.md — "Cross-vendor rules", section 1 "Tool packs", section 2 "Dynamic tool definitions"
- docs/plan/HISTORY.md, task 09 entry — "start from an allowlist" (grep `## 2026-10-10 — World document read tools`)

## Design constraints (decided; implement as stated)
- **Names.** Core: `TOOL_NAME_PATTERN` unchanged. Pack prefix: `^[a-z][a-z0-9]{1,9}$`. Pack-local tool name: `^[a-z][a-z0-9_]{1,24}$`. Full pack name `<prefix>-<name>`, at most 36 characters. Reserved prefixes: `ag`, `agent`, `core`, `foundry`, `gateway`, `mcp`. Pack id: `^[a-z0-9][a-z0-9_-]{0,63}$`. Pack version: `^\d{1,4}\.\d{1,4}\.\d{1,4}(-[0-9A-Za-z.]{1,20})?$`. Rationale (36 = 64 minus Claude Code's 27-character `mcp__foundry-agent-gateway__` prefix, rounded down; `-` and `_` are in every vendor's allowed set, `.` is not in OpenAI's) goes in `docs/packs/naming.md`, with the source URL and date for each vendor rule the implementer checks (MCP tool-name guidance, Anthropic, OpenAI, Gemini function-name rules). If a checked source is stricter than these patterns, tighten the pattern and say so in the PR; never loosen it.
- **Schema keyword allowlist** (every schema node, input and output): `type` (a single string), `properties`, `required`, `additionalProperties` (must be `false` on objects), `description`, `items`, `enum`, `default`, `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `minLength`, `maxLength`, `minItems`, `maxItems`. Any other keyword is a problem, including `pattern`, `format`, `$ref`, `$defs`, `oneOf`, `anyOf`, `allOf`, `not`, `if`, `propertyNames`, `patternProperties`, `title`. Root must be `type: "object"`. The existing depth-3 and every-property-has-a-description rules stay.
- **Limits** in `limits.ts`, one exported `TOOL_LIMITS` object: schema JSON (each of input, output) at most 16 KiB; at most 32 properties per object; `enum` at most 50 values, each a string of at most 64 characters or a finite number; tool description at most 500 characters; property description at most 200 characters; at most 32 tools per pack; one announcement at most 64 tools and 256 KiB; at most 24 pack tools listed per session; pack handler result text at most 64 KiB and structured JSON at most 64 KiB.
- **Plain-text rule** for every description, enum string and string `default`: no character in Unicode categories Cc or Cf (this covers newline, tab, zero-width and bidi controls), no U+2028/U+2029, none of `` < > ` ``, no `](`, no `://`, not empty or whitespace-only.
- **API.** `checkToolDefinition(def: AnnouncedTool, origin: 'core' | 'pack'): string[]` returns problems (empty means valid); `origin: 'pack'` adds the pack name, prefix, id and version rules. `validateArgs(schema, value): {ok: true, value} | {ok: false, issues: {path, message}[]}` supports exactly the allowlisted keywords, applies top-level `default`s for missing properties to a copy and never mutates its input. `pack.ts` exports `PACK_API_VERSION = '1.0'` (major.minor), the `AnnouncedTool` type `{name, description, category, minRole, inputSchema, outputSchema, pack?: {id, version, prefix}}` and `parseApiVersion`.

## Acceptance
- [ ] `conservative-schema.test.ts` imports the checker from `../../src/tools/rules.js`; its local copy of the walker is gone, and every existing `it` in that file still passes against the moved code
- [ ] Every entry of `TOOLS`, converted with `toJsonSchema`, gives `checkToolDefinition(def, 'core')` = `[]` (test iterates `TOOLS`, so later core tools are covered automatically)
- [ ] Hostile-schema tests under `protocol/test/tools/rules/`, one assertion each that a problem naming the cause is returned: `pattern`, `format`, `$ref` (local and remote), `$defs`, each of `oneOf`/`anyOf`/`allOf`/`not`/`if`, a type array, `additionalProperties` missing or `true` or a schema, depth 4, 33 properties, a 51-value enum, an enum string with U+202E, a 17 KiB input schema, root `type: "array"`, an `__proto__` property name, a `constructor` property name
- [ ] Description tests: 501-character tool description, 201-character property description, embedded `\n`, U+200B, U+202E, `<system>`, a backtick, `[x](y)`, `https://x` and an empty string each produce a problem; a plain 500-character ASCII description produces none
- [ ] Name tests: `hello-world_clock` passes for a pack with prefix `hello`; refused with a reason: no prefix, prefix not matching the declared one, `ag-x1` (reserved), `Hello-x1`, `hello.x1`, `hello-x-y`, a 37-character name, and any core-pattern name with `origin: 'pack'`
- [ ] `validateArgs` tests: accepts a valid value; rejects a missing required property, an extra property, a wrong type, an integer given 1.5, out-of-range number, too-long string, too-many items, an enum miss; applies a top-level default without mutating the input object (`Object.isFrozen` input still accepted); for every `TOOLS` input schema, a value that zod accepts is accepted and a value with an extra property is rejected by both
- [ ] `validateArgs` on a 10,000-element array of objects at depth 3 finishes and its run time ratio for n versus 4n is under 6 (min of 5 runs), placed in a `*.slow.test.ts` file with a small fast sample
- [ ] Fast `npm test` excludes `*.slow.test.ts`; the protocol slow project is wired into root `test:slow` and `npm run verify`
- [ ] `docs/packs/naming.md` lists each vendor rule with source URL and the date checked
- [ ] `npm run verify` passes

## Out of scope
- Any module or gateway code that calls these rules (20c, 20d, 20e)
- Changing `ToolsetMessage` or any link message (20e)
- Relaxing any existing core schema rule
