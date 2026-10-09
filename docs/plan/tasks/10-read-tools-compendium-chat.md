# 10 — Add read tools compendium_search, compendium_get and chat_read

**Repo:** .
**Depends on:** 08
**Owns:**
- protocol/src/tools/compendium-search.ts
- protocol/src/tools/compendium-get.ts
- protocol/src/tools/chat-read.ts
- protocol/src/tools/index.ts (insertions only)
- protocol/test/tools/compendium-chat.test.ts
- module/src/tools/compendium-search.ts
- module/src/tools/compendium-get.ts
- module/src/tools/chat-read.ts
- module/src/tools/index.ts (insertions only)
- module/test/tools/compendium.test.ts
- module/test/tools/chat-read.test.ts
- module/test/stubs/** (insertions only)

## Goal
Complete the foundations read set with compendium lookup and chat history,
following the pattern from 08. Compendium search must use pack indexes, not load
whole packs.

## Context
- docs/plan/specs/2026-10-09-agent-gateway.md:143-157 — tool list and result shape
- module/src/ops/**, module/src/serialise/** — (08)

## Acceptance
- [ ] `compendium_search` (player, read): args `query`, optional `packType` (Actor, Item, JournalEntry, RollTable, Scene, Macro), optional `pack`, `limit` (default 20, max 50); searches `pack.getIndex()` only (test asserts `getDocuments` is never called); skips packs the user cannot observe
- [ ] `compendium_get` (player, read): args `uuid` of a `Compendium.*` entry, optional `cursor`; serialised, markdown, paged like `document_get`
- [ ] `chat_read` (player, read): args `limit` (default 20, max 100), optional `before` message id; returns messages the user can see (whispers to others excluded), with speaker, timestamp, markdown content, roll formula and total when present, and an `aiAuthored` boolean read from `flags['agent-gateway']`
- [ ] Guards (`conservative-schema`, `coverage`, `tool-count`) pass unchanged
- [ ] `npm run verify` passes

## Out of scope
- `chat_post` and the AI marker (21)
- `compendium_import` (23)
