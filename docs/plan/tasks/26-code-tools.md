# 26 — Add code tools macro_run and script_run with mandatory confirmation

**Repo:** .
**Depends on:** 21, 20d, 20e
**Owns:**
- protocol/src/tools/macro-run.ts
- protocol/src/tools/script-run.ts
- protocol/src/tools/index.ts (insertions only)
- module/src/tools/macro-run.ts
- module/src/tools/script-run.ts
- module/src/tools/index.ts (insertions only)
- module/test/tools/code/**
- module/test/stubs/** (insertions only)

## Goal
Let a GM's agent run macros and ad-hoc scripts only after a human has read the
full source and confirmed, every time unless approved for the session; there is
no path to auto-run code.

## Context
- docs/plan/specs/2026-10-09-agent-gateway.md:86-88 — runtime code never runs unconfirmed
- docs/plan/specs/2026-10-09-agent-gateway.md:132-134 — code always ask, cannot be set to auto
- module/src/policy/** code coercion (13); module/src/apps/approval/** code rendering (17)

- These are core tools: add them to `protocol/src/tools/index.ts` `TOOLS` and `module/src/tools/index.ts` `HANDLERS` as before; `module/src/ops/core-tools.ts` (20c) registers them through the same registry path as pack tools, and `checkToolDefinition(…, 'core')` (20b) must pass for each (the 20b test sweeps `TOOLS`)
## Acceptance
- [ ] `macro_run` (gm, code): args `macroUuid`, optional `args` JSON string; the approval dialog shows the macro's full command text
- [ ] `script_run` (gm, code): args `source` (max 20000 chars); runs as an async function with `game`, `canvas`, `ui` in scope; return value serialised (max 4000 chars)
- [ ] A test proves both tools reach the approval stage even when policy storage has been tampered to `allow`
- [ ] A fixture pack tool registered with category `code` (20d) also reaches the approval stage under the same tampered policy (test), so the code rule holds for packs
- [ ] Errors thrown by scripts return `INTERNAL` with the error message only
- [ ] Guards pass; manual check on foundry.local v14 with a screenshot of the source in the dialog

## Out of scope
- Any sandboxing beyond Foundry's own permissions (documented in 43)
