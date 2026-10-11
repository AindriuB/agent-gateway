# 21b — Use native provenance for audit journal designation and witnessed creates

**Repo:** .
**Status:** Complete; merged in PR #60 (`0d7a4b3`). Combined task 21 native acceptance passed on v13.351 and v14.369 using GM designation and attested creation observations.

**Depends on:** 19
**Owns:**
- module/src/audit/journal.ts
- module/src/audit/witness.ts
- module/test/audit/journal.test.ts
- module/test/audit/guard.test.ts (trusted journal fixtures/assertions only)
- module/test/audit/mutation-results.test.ts (trusted journal fixtures/assertions only)
- module/test/audit/witness-retry.test.ts
- module/test/audit/witness.test.ts
- module/test/audit/hardening.test.ts (creation witness security regressions only)
- module/test/audit/capture-safety.test.ts (creation witness bounds/regressions only)
- module/test/stubs/foundry.ts (native world Setting document metadata support only)

## Goal
Restore native v13/v14 audit persistence and player-created undo targets without
relying on the nonexistent `_stats.createdBy` field. Task 21 remains blocked on
this prerequisite's verified integration and its own native acceptance.

The journal trust claim is explicitly **GM-designated**, replacing the current
implementation's unverifiable historical GM-created claim. The factory still
creates genuine documents as the designated GM. Witnessed creation authority
comes from a native create hook's server-set user identity and the GM's own
observation, not a player claim or a last-editor inference.

## Context
- module/src/audit/journal.ts:35-104 — current trust predicate and creation factory
- module/src/audit/witness.ts:315-425 — native creation observations and assembled targets
- module/src/audit/relay.ts:52-75 — only the designated active GM persists records
- module/src/audit/index.ts:50-100 — native hooks, relay, sink and journal initialization
- module/test/audit/journal.test.ts; module/test/audit/witness.test.ts — existing security fixtures
- Native v13.351 and v14.369 read-only evidence confirms DocumentStats lacks createdBy; both persisted world Setting documents expose an exact key, user:null, decoded value and server-managed lastModifiedBy resolving an existing GM. Raw Setting source.value is JSON encoded; document.value is decoded

## Acceptance
- [ ] Journal trust uses the persisted native world Setting document from `game.settings.storage.get('world').getSetting('agent-gateway.auditJournalId')`. Require exact key, world user:null, decoded document.value equal to the selected journal's exact ID, and server-managed `_stats.lastModifiedBy` resolving an existing current GM. Missing, inconsistent or inaccessible provenance fails closed
- [ ] World scope alone is insufficient: SETTINGS_MODIFY can be delegated. A player-written setting cannot designate a trusted journal even if the journal has GM ownership, GM lastModifiedBy, or fabricated creator flags. Never substitute a journal's lastModifiedBy for its creator or trust caller-provided metadata
- [ ] Preserve the selected journal flag, default ownership NONE and effective exclusion of every non-GM user. An unselected flagged journal is not trusted. A changed/deleted/demoted Setting writer invalidates trust immediately on recheck
- [ ] Existing journals whose persisted Setting was last written by a current GM can be recognized without configuration changes. Missing/untrusted provenance is never silently adopted, reset, replaced or repaired. Preserve existing journal contents
- [ ] Genuine factory creation is limited to the designated active GM. Await the journal creation and Setting persistence, then reread the complete trust predicate before returning a trusted journal. Rejected writes, absent writer proof and mismatched readback fail closed; never return an unverified newly created journal
- [ ] Native-shaped journal fixtures without createdBy prove trusted GM designation succeeds; wrong key/user/value, missing Setting/stats/writer, non-GM/unknown/demoted writer, forged journal metadata, effective player access and nonzero default ownership fail. Factory failure/readback tests establish the same boundary
- [ ] Creation witnessing removes the nonexistent creator-field requirement. A supported target is eligible only after a declared creation intent in an unexpired bounded call and a native create hook whose server-set userId matches that call's authenticated sender via existing live(userId, options) correlation. A supplied callId/options or player audit payload alone never authorizes a target
- [ ] Validate bounded canonical supported UUID and native document type/ID/parent identity; reject audit-protected documents/parents. Capture the actual native document identity and finite modification version. At assembly, freshly resolve from the GM's authoritative world and require matching identity/version before marking a newly created target undoable. Missing/different/replaced/changed documents remain view-only
- [ ] Wrong hook user, wrong/missing call ID, absent creation intent, expired call, forged claimed targets, unsupported/malformed/oversized UUIDs, protected audit targets, missing fresh documents and inconsistent versions fail closed. Preserve existing snapshot/recreation refusal, bounds, intervention checks and retry capture lifecycle
- [ ] Duplicate delivery of the same creation observation does not duplicate targets; distinct creations or unsafe delete/recreate under one UUID cannot authorize an unsafe undo. Do not add a blanket player OWNER requirement where native creation permissions legitimately differ, such as chat
- [ ] Meaningful tests use native-shaped stats without createdBy for a valid attested creation and the hostile cases above. Fixture metadata support must be explicit; shared stubs must not fabricate GM provenance for every Setting automatically
- [ ] `npm run verify` passes, with independent source/security review. Native read-only preflight verifies the actual Setting anchor, designated controlled GM, declared audit subtype and trusted closed journal on both configured versions before any fixture writes
- [ ] After integration, task 21 repeats its separately approved exact native GM and player payloads on v13/v14 through cached SDK listings and the real approval UI. Verify real persisted audit pages, created UUID undo targets, append before-snapshots and zero no-chat targets, then exact fixture cleanup and retained audit UUIDs. Local tests or successful tool results alone do not establish native acceptance

## Out of scope
- Any weakened task 18 acceptance, cross-owner revocation design or gateway authority changes
- Manual or fabricated creator metadata, journal last-editor-as-creator inference, permission bypasses or unsigned role claims
- Automatic journal adoption/replacement, configuration migration, campaign writes or approval actions without the separately required human authorization
- Broad audit/undo redesign, new tool payloads, task 21 handler changes or bypassing approval/default policy
