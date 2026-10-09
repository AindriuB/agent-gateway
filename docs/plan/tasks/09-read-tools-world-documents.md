# 09 — Add read tools world_info, document_search and document_get

**Repo:** .
**Depends on:** 08
**Owns:**
- protocol/src/tools/world-info.ts
- protocol/src/tools/document-search.ts
- protocol/src/tools/document-get.ts
- protocol/src/tools/index.ts (insertions only)
- protocol/test/tools/documents-read.test.ts
- module/src/tools/world-info.ts
- module/src/tools/document-search.ts
- module/src/tools/document-get.ts
- module/src/tools/index.ts (insertions only)
- module/test/tools/world-info.test.ts
- module/test/tools/document-read.test.ts
- module/test/stubs/** (insertions only)

## Goal
Ship the first three end-to-end-capable read tools, schema and handler together,
so the coverage and conservative-schema guards prove the pattern every later
tool follows. Results respect what the logged-in user can see.

## Context
- docs/plan/specs/2026-10-09-agent-gateway.md:143-157 — tool list, short text plus structured content, paging, markdown
- module/src/ops/**, module/src/serialise/** — dispatcher and serialiser (08)
- protocol/src/tools/define.ts — (03)

## Acceptance
- [ ] `world_info` (player, read): world id/title, system id/version, Foundry generation, current user name/role, active scene name, whether combat is active; no args
- [ ] `document_search` (player, read): args `type` (enum Actor, Item, JournalEntry, Scene, RollTable, Macro, Playlist), optional `query`, optional `folder`, `limit` (default 20, max 50); returns uuid, name, type, folder for documents the user can observe (`testUserPermission(user,'OBSERVER')`) only
- [ ] `document_get` (player, read): args `uuid`, optional `cursor`; returns serialised document through `serialiseDocument`, HTML fields as markdown, paged; a uuid the user cannot observe returns `FORBIDDEN`, an unknown one `INVALID_ARGS` with "not found"
- [ ] All three pass `conservative-schema.test.ts` and `coverage.test.ts` unchanged
- [ ] Unit tests: permission filtering, paging cursor round-trip, flag stripping applied
- [ ] `npm run verify` passes

## Out of scope
- Compendium and chat reads (10)
- Folder allowlists (13)
- Any write tool
