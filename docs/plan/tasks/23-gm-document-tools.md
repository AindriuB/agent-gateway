# 23 — Add GM tools document_create, document_update, document_delete and compendium_import

**Repo:** .
**Depends on:** 21, 20d, 20e
**Owns:**
- protocol/src/tools/document-create.ts
- protocol/src/tools/document-update.ts
- protocol/src/tools/document-delete.ts
- protocol/src/tools/compendium-import.ts
- protocol/src/tools/index.ts (insertions only)
- module/src/tools/document-create.ts
- module/src/tools/document-update.ts
- module/src/tools/document-delete.ts
- module/src/tools/compendium-import.ts
- module/src/tools/index.ts (insertions only)
- module/test/tools/gm-documents/**
- module/test/stubs/** (insertions only)

## Goal
Give the GM's agent full document control through the approval path:
`document_update` takes raw Foundry update data and is always diff-approved by
default; deletes are destructive.

## Context
- docs/plan/specs/2026-10-09-agent-gateway.md:151-153 — GM tools; `document_update` raw data, diff-approved, ask by default
- module/src/apps/approval/** diff (17); module/src/tools/_write.ts (21)

- These are core tools: add them to `protocol/src/tools/index.ts` `TOOLS` and `module/src/tools/index.ts` `HANDLERS` as before; `module/src/ops/core-tools.ts` (20c) registers them through the same registry path as pack tools, and `checkToolDefinition(…, 'core')` (20b) must pass for each (the 20b test sweeps `TOOLS`)
## Acceptance
- [ ] `document_create` (gm, write): args `type`, `data` (JSON string, parsed and size-limited, so the schema stays closed), optional `folder`, optional `parentUuid` for embedded docs
- [ ] `document_update` (gm, write): args `uuid`, `update` (JSON string of raw update data); the approval dialog shows a diff of current vs merged result
- [ ] `document_delete` (gm, destructive): args `uuids` (max 20); one grouped approval
- [ ] `compendium_import` (gm, write): args `uuid` of a compendium entry, optional `folder`
- [ ] With default world policy (GM agents: write ask_owner) every call prompts; audit entries allow undo of each (tests with stubs)
- [ ] Guards pass, including the tool-count limit; manual check on foundry.local v14

## Out of scope
- Tokens, combat, scenes (24); tables, playlists, notify (25)
