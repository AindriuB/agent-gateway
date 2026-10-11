# 23a — Restore and verify native embedded documents during Undo

**Repo:** .
**Depends on:** 19, 23 (including embedded actual-data create permission fix fae67f3)
**Status:** Complete and merged in PR #63 (head 0cf35c3, main 83d216d). Specified native v13.351/v14.369 acceptance passed on source a45541a; archived after merge. See PLAN and HISTORY for evidence and limits.
**Owns:**
- module/src/audit/undo.ts
- module/src/audit/undo-restoration.ts (optional shared bounded restoration/verification helper only)
- module/test/audit/undo-restoration.test.ts
- module/test/audit/undo.test.ts
- module/test/audit/undo-safety.test.ts
- module/test/audit/undo-confirmation.test.ts
- module/test/audit/undo-reservation.test.ts
- module/test/audit/witness.test.ts (native recreation fixture identity/registration and retained-ID options only)
- module/test/tools/gm-documents/fixtures.ts (shared native fixture canonical collection references, empty embedded collections and faithful embedded source serialization only)

The two narrowly annotated fixture allowances preserve all witness/integration assertions and add no runtime authority; module/test/tools/gm-documents/integration.test.ts itself is unchanged. Existing Undo test files may change fixtures and add restoration/security regressions; do not weaken their existing reservation, conflict or authorization assertions. Audit schemas, class allowlists, reservations, tool handlers, protocol definitions and UI are outside Owns. Report a concrete blocker before changing them.

## Goal and evidence

Native task23 v14 testing recreated three deleted roots through the human Audit UI, but the saved Actor ActiveEffect UUID was absent. PF2e v13 and v14 Actor creation calls migrateActorSource, which clears effects; Item creation also clears effects. Native keepEmbeddedIds cannot preserve source data removed by these system hooks. Current Undo treats a truthy root create result as complete without verifying descendants. Fix this underlying Undo defect without expanding its authority or claiming transactional native mutations.

## Context

- module/src/audit/undo.ts:42-57,175-201,266-420 — native permission adapters, recreation, conflict/retry plan and completion recording.
- module/src/audit/undo-classes.ts — existing world and embedded allowlists; unchanged.
- module/src/audit/record.ts and types.ts:64-85 — trusted before snapshots and existing stored-data bounds.
- module/src/audit/reservation.ts — server reservation and uncertain-outcome/manual-recovery boundary; unchanged.
- module/src/tools/_documents.ts — read-only reference for strict actual-data embedded candidates and canonical native permissions; do not import tool/audit execution side effects into Undo.

## Restoration and authority

- Operate only on the trusted, readable before snapshot selected by existing Undo eligibility and reservation logic. Preserve existing current native GM identity, audit protection, class allowlists, conflict confirmation and cross-client reservation. No tool may invoke Undo and no new document class is authorized.
- Before restoration writes, build a bounded subtree plan using native class metadata for embedded collection names, canonical class/parent relationships and saved child IDs. Support the existing allowed descendants needed for Actor/Item ActiveEffects, Actor Items and JournalEntry Pages, including Actor → Item → ActiveEffect. Do not mistake arbitrary arrays in system data or Actor.prototypeToken for embedded documents. Unsupported or unverifiable descendants refuse that restoration rather than silently disappear or create a new authority path.
- Respect existing AUDIT_LIMITS snapshot/entry sizes. Also bound traversal to depth 32, 20,000 visited values and 256 embedded descendants per target; invalid, cyclic, duplicate-ID, prototype-bearing or oversized plans fail before mutation. No unbounded recursion, document construction or native create batch.
- Recreate roots with their saved ID and native embedded-ID preservation options. Then resolve the exact canonical returned root and inspect native embedded collections. Explicitly create only saved supported children that are missing, with saved IDs and actual data, preserving native hooks. Reconcile nested children after their parent exists; native root/Item creation may have dropped effects.
- Both direct embedded recreation and missing-descendant repair must construct a strict native candidate from actual saved data with creation:true and the exact canonical parent, then use native instance create permission for the current GM. Do not use the inherited blank static canUserCreate sample for embedded permission, and do not replace native permissions with an isGM bypass. Preserve root class permission checks.
- Recheck current GM, held reservation, exact root/parent identity, native permissions, audit protection and relevant captured versions after every awaited boundary and immediately before each native mutation. Never restore into a replacement parent or a protected audit ancestor. No server CAS or immediate revocation claim is added.
- Use only missing-child creates. Never overwrite/delete unexpected children, replace a colliding child, or silently change IDs to make a restore succeed. Existing matching saved children may be retained after verification. Mismatched IDs, class, parent or content fail closed and remain incomplete; existing human conflict confirmation is not blanket authority to erase extras.

## Verification, failures and retry

- Before recording a target in undoCompleted, freshly verify the exact root/embedded UUIDs and saved subtree data, including child IDs and ordinary native data. Ignore only server-managed _stats for this comparison; do not ignore effects, pages, ownership, flags or system fields to hide a native difference. A native veto, wrong/missing return, changed source or dropped child is a failure, not successful Undo.
- An originally deleted target whose previous attempt left its root present must follow restoration reconciliation on a confirmed retry, not the ordinary update path that strips embedded arrays. Keep the existing recreated/modified conflict confirmation and fresh version checks. Retain matching children and create only still-missing ones so a settled partial retry cannot duplicate successful work. Refuse differing/colliding existing children rather than overwrite them.
- A failed subtree must not enter undoCompleted, and the entry must not receive undoneAt/undoneBy until every eligible restoration succeeds. Preserve completed independent targets and report failed targets honestly. Do not automatically roll back recreated roots or children.
- Distinguish a known settled partial failure from an uncertain mutation/progress write. For an uncertain outcome retain the reservation/manual-recovery boundary as today; do not release and blindly replay. If current interfaces cannot establish safe retry identity/version after a partial create, stop that retry for explicit human recovery rather than inventing provenance or broad overwrite authority.
- Native hooks can transform/veto data and later edits can intervene. The repair is bounded verified restoration, not an atomic transaction or guaranteed restoration for every system/document shape. An unsupported transformation must produce an explicit incomplete result, never a false done mark.

## Acceptance and meaningful regressions

- [ ] Native-shaped v13/v14 Actor and Item create hooks strip effects; Undo restores the saved supported effects with exact IDs and data after parent creation. Journal root creation retaining saved Pages does not create them twice.
- [ ] Direct JournalEntryPage/ActiveEffect recreation passes strict required-name/actual-data parent permission checks where inherited blank static samples fail; denied native permissions still refuse.
- [ ] Root/child cancellation, child veto, missing/wrong returns, changed IDs/content, unsupported descendants and duplicate/prototype/size/depth/node bounds cannot be marked complete.
- [ ] Settled child failure and apply-then-reject outcomes have explicit safe handling; confirmed partial retry retains matching existing children, fills only missing children and never duplicates or overwrites collisions. Uncertain outcomes preserve manual recovery/reservation rather than auto-retry.
- [ ] Demotion, reservation loss, replaced parent/root, changed ownership/version and audit-protected ancestors after awaited work refuse before the next mutation; existing conflict and cross-client reservation regressions remain intact.
- [ ] Tests exercise real undoEntry completion/progress behavior, including failed subtree versus independent completed targets. No false undoneAt or undoCompleted on incomplete restoration.
- [ ] Supported-runtime npm run verify passes and independent security review passes before publication.
- [ ] Native acceptance remains separately gated by explicit test-world write/Undo/cleanup authorization. Validate actual human UI Undo on the approved exact task23 fixtures in v13/v14, exact root/child IDs and saved content, retained audits and exact fixture cleanup. Preserve historical failed evidence; do not claim prior v14 root-only Undo was a pass or infer native proof from stubs.

## Out of scope

No new Undo classes, audit adoption/settings changes, snapshot trust relaxation, reservation redesign, tool schema changes, broad world cleanup, private evidence/image export or automatic repair of the already-completed historical failed audit. Any such recovery needs its own explicit reviewed plan and authorization.
