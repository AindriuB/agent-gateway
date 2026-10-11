# 23 — Add GM tools document_create, document_update, document_delete and compendium_import

**Repo:** .
**Status:** Implementation and specified native v13/v14 acceptance verified at a45541a; PR #63 awaiting merge. Contract remains active until merge; see PLAN and the task23/23a HISTORY entry for evidence and limits.
**Depends on:** 21, 20d, 20e
**Owns:**
- protocol/src/tools/document-create.ts
- protocol/src/tools/document-update.ts
- protocol/src/tools/document-delete.ts
- protocol/src/tools/compendium-import.ts
- protocol/src/tools/index.ts (insertions only)
- protocol/test/tools/rules/validate.test.ts (insertions for the four task23 canonical example arguments only)
- module/src/tools/_documents.ts (shared bounded JSON, class/canonical identity and fresh GM/document/folder guards only)
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
- [ ] With default world policy (GM agents: write ask_owner) every call prompts; audits retain snapshots/created targets for the existing undo machinery (tests with stubs); oversized/stale snapshots may be conservatively view-only, without widening undo authority
- [ ] Guards pass, including the tool-count limit; manual check on foundry.local v14

## Supported document boundary and native security
- The supported world roots are `Actor`, `Item` and `JournalEntry`. Supported embedded relationships are `Item` under `Actor`, `ActiveEffect` under `Actor` or `Item` (including an actor-owned Item), and `JournalEntryPage` under `JournalEntry`. Check every parent/root relationship and canonical collection membership. This is the bounded meaning of document control in this task; do not enumerate arbitrary CONFIG document classes.
- Scene/Token/Combat and their embedded classes remain task24; RollTable/TableResult and Playlist/PlaylistSound remain task25. Folder CRUD, Cards/Card, User, Setting, Macro, Adventure, ChatMessage and other classes are excluded. Do not expose credentials/configuration/script documents or weaken immutable AI markers through generic operations. Folder is only an optional existing destination, not a create/delete target.
- `type` names a supported Foundry document class (such as `Actor` or `JournalEntryPage`); any native system subtype remains in JSON `data.type`. A create's optional `folder` and `parentUuid` are mutually exclusive. A destination folder must be the canonical world Folder of the created/imported root class; reject embedded folder destinations, missing/wrong-type folders and invalid parent relationships. A raw update changing a root folder must undergo the same canonical same-class destination validation; a valid native null folder may clear it.
- Parse `data`/`update` only as a JSON plain-object root. Enforce at most 64 KiB UTF-8 input, depth 16 and 5,000 visited values, with bounded traversal and finite numbers. Reject prototype-bearing path segments (`__proto__`, `prototype`, `constructor`) in nested and dotted/deletion keys before native work. Keep protocol schemas closed and bounds consistent with handler parsing; strings, arrays and null as the root are invalid. Native `system` data and custom flags remain raw native data, not an invented sanitization format.
- Document identity is immutable: no caller-selected root `_id`, `_stats`, `pack` or parent/collection identity on create; no identity/version metadata mutation on update. Embedded collection data must stay within the supported relationship allowlist and preserve native identity rules; never use raw payloads to inject an unsupported descendant class. Existing embedded documents are updated through their canonical embedded UUID, not caller-supplied `_id` selectors inside a parent's raw embedded arrays. Reject those selectors rather than claiming unrestricted native embedded-array patch support; supported embedded creates remain available through the validated parent relationship. Reject reserved `flags.agent-gateway` manipulation, including nested/dotted/deletion forms and whole-flags erasure that would remove protected metadata, and the `agent-gateway.audit` page subtype. Preserve reserved metadata already on a document during unrelated valid edits. Reject audit journals and descendants before every mutation, even if a payload tries to remove their audit flag. Do not widen audit/undo allowlists.
- Authorization comes from the current native `game.user` and canonical `game.users` record matching `ctx.user.id`, with actual `isGM`, never payload role hints. Require native class/parent create permission, OWNER/update/delete permission as appropriate, and canonical current world documents. Recheck current GM, ownership, class/parent/folder identity and audit protection after awaited resolution/snapshots/creation intent and immediately before each native mutation. A stale approval cannot authorize an action after the GM is demoted, its document/parent is replaced or permissions change. There is no new CAS, revision lock or immediate revocation promise.
- Every mutation uses the existing fail-closed write/audit helper, awaited `snapshot` for existing targets, `intendCreate` before creation, `created` after obtaining the actual returned UUID, and `ctx.callOptions` on native operations. Validate canonical successful native return values rather than treating cancelled or missing results as success. Results expose bounded identifiers/counts, not raw document source.
- `document_update` retains the existing core approval renderer using `{uuid, update: <JSON string>}`. Use its bounded before/after merge and diff logic read-only; refuse mutation if a safe before/after diff cannot be computed (including the existing 1,000-row limit). An unavailable preview cannot authorize a mutation. Do not edit the task17 app, introduce a different merge approximation or claim native hooks/system side effects are predicted by the preview.
- `document_delete` accepts at most 20 UUIDs, deduplicates them and validates the complete set before any mutation. Reject ancestor/descendant overlap, compendium targets, unsupported classes or any protected audit target; snapshot every target before deletion. Revalidate immediately before each native delete and pass callOptions. Native multi-document work is not a transaction: a later native failure must report failure honestly while retaining audits of any earlier changes; no success-shaped partial result or unaudited rollback.
- `compendium_import` imports one supported top-level entry into a fresh world document; it never updates the pack or replaces an existing world document. Validate canonical pack/entry UUID, actual GM pack visibility, supported class and audit protection, then await loading. Use the native world collection's `fromCompendium` conversion with `keepId:false`, cleared source folder and native ownership/state/sort handling. Revalidate the converted data and fresh GM/destination after loading, then perform one audited native create and record its actual UUID. Do not blindly call `importFromCompendium`: its default keep-ID/replacement path can replace an existing document and drop audit options. Native v13/v14 source supports load/convert/create without a compat generation branch.

## Required regressions and evidence limits
- Exercise the real default-policy dispatcher/approval/audit path for all four definitions, with strict schemas and the four canonical tool examples. Prove no writes on non-GM/spoofed user, demotion or replaced-document/folder/parent after an awaited boundary; prove all native options carry the call ID.
- Cover JSON size/depth/node/prototype and malformed-root refusals, protected flag/deletion forms/audit subtype/ancestor rejection, forbidden document classes and unsupported embedded relationships. Test valid raw nested/dotted/deletion updates and their actual shared preview diff; an unreviewable/oversized before/after diff must refuse before mutation.
- Cover supported root and embedded create, matching/mismatched folders, actual created UUID capture, snapshots for update/delete, cancellation/missing native returns, duplicate/overlapping delete sets, invalid final member causing zero deletes, and honest late native failure with earlier changes audited. Stub undo tests exercise existing supported machinery only, not a new native Undo acceptance claim.
- Native-shaped v13/v14 compendium tests must prove source ID cannot replace a matching world ID, original pack data is preserved, ownership/folder conversion is native, and stale GM/folder checks precede the final create. Keep compendium reads bounded and result output short.
- The contract authorizes implementation/offline tests only. Native test-world writes, fixture creation and cleanup require the existing explicit approval workflow; do not infer them from the manual acceptance checkbox. No new script execution, administrative settings writes, audit adoption or broad cleanup is authorized.

## Out of scope
- Tokens, combat, scenes (24); tables, playlists, notify (25)
