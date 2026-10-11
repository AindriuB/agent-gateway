# 15a — Publish world enforcement as one complete snapshot

**Repo:** .
**Status:** Planned follow-up to the cross-GM save race in task 15 / PR #57.
**Depends on:** 15, 17
**Owns:**
- module/src/policy/snapshot.ts (new validated snapshot storage/legacy adapter)
- module/src/policy/store.ts
- module/src/policy/stage.ts (capture one complete snapshot for live policy inputs)
- module/src/policy/folders.ts
- module/src/ratelimit/store.ts
- module/src/apps/policy/index.ts
- module/src/apps/policy/model.ts
- module/src/tools/document-get.ts (capture the folder-enforcement snapshot before UUID resolution and pass it to the existing readable-tree check only)
- module/test/policy/snapshot.test.ts (new)
- module/test/policy/matrix.test.ts
- module/test/policy/stage.test.ts
- module/test/policy/folders.test.ts
- module/test/ratelimit/stage.test.ts
- module/test/apps/policy/policy.test.ts
- module/test/tools/document-read.test.ts
- module/test/stubs/foundry.ts (narrow persisted world Setting collection/value/identity metadata needed by the storage regressions; preserve existing defaults and test interfaces)
- lang/en.json (insertions under `AGENT_GATEWAY.PolicyApp.*` only, if a localized initialization/repair notification is needed)

## Goal
Prevent two GM clients from publishing a hybrid world configuration that neither
submitted. A browser-local mutex or reordered writes cannot serialize clients.
Each successful publication must replace the complete enforcement record with
one validated value; the last complete writer wins. This is not compare-and-swap
and does not prevent one complete proposal from superseding another.

## Context and verified boundary
- module/src/apps/policy/index.ts — the current multi-setting save can interleave another GM's folder/rate/toggle changes before its final matrix write.
- module/src/policy/store.ts, module/src/ratelimit/store.ts — all enforcement readers and setting registrations must use the same authoritative record.
- module/src/policy/stage.ts and module/src/ratelimit/stage.ts — the default policy-to-rate path calls `next()` synchronously; there is no await between those reads.
- module/src/tools/document-get.ts — UUID resolution awaits before the folder check; capture the full admission snapshot before this await.
- Native v13/v14 client storage updates an existing Setting with one serialized `value`; the absent-key path creates a Setting. Read-only server inspection found storage keyed by document `_id`, not a verified unique Setting key. Never infer singleton uniqueness from `getSetting(key)` returning the first match.

## Storage and compatibility contract
- Reuse `agent-gateway.worldPolicy` as a versioned envelope containing the complete world matrix, both agent-enable flags, both folder allowlists and the complete rate configuration, including per-agent overrides. Validate/copy the whole record before publication. No mutable live-cache references may become an admitted snapshot.
- The envelope must omit the legacy top-level agent-class rows: old `loadMatrix` readers then deny rather than combine a new matrix with old unrestricted folders. All participating clients still need the updated module/reload; old code cannot be made to honor new enforcement or migration rules.
- A registered world-scope migration latch may only advance to `true`, before the first envelope publication. Never reset it or compensate it on failure. Before migration, only an explicitly valid legacy matrix/settings layout may provide the compatibility snapshot; malformed or ambiguous formats must fail closed. After migration, a legacy matrix, absent record, unknown version or corrupt envelope must never trigger legacy fallback.
- Inspect the actual persisted world Setting collection and exact namespace/key/user identity. A cache lookup or first-match `getSetting` alone is insufficient. Require one matching authoritative document for a usable migrated snapshot; unreadable storage, duplicate records, inconsistent identities or invalid latch state deny access. Validate the complete payload, including false flags, empty-list semantics, all matrix cells and rate override corruption; no permissive defaults for a malformed migrated envelope.
- Initialization is unique-or-denied, not invented CAS. Concurrent first creation can produce duplicate records: once observed, reads deny and saves report initialization/repair required. Recheck storage after initialization/publication; never choose an arbitrary duplicate, silently delete another client's record, reset migration or retry indefinitely. Competing latch creation must likewise remain fail closed. A valid singleton update replaces its full serialized value in one operation.
- Legacy toggle controls must cease presenting independent authoritative writes after migration. Keep existing exported reader/helper interfaces where practical, but adapt `saveWorldPolicy` and `saveRateLimits` to publish a complete validated record rather than downgrade the envelope or mutate legacy mirrors. Direct legacy-key writes after migration must not influence enforcement. No authoritative folder/toggle/rate mirrors may be maintained through separate writes.
- All world getters, live policy decisions, folder checks, settings-form state and rate-limit reads derive from the record. Each decision captures one complete parsed snapshot. The default synchronous policy/rate path must remain coherent; `document_get` carries its handler-entry snapshot across UUID resolution. Search and world-info folder checks are synchronous and can consume the complete current record through the existing helper.

## Save and failure semantics
- Re-read current Foundry role, ceiling and corruption state at submission. Preserve the current corrupt-override rejection before any writes, valid per-agent overrides, player owner-only save path and draft-ceiling DOM behavior. Do not silently repair invalid overrides or broaden limits.
- Owner policy remains client-scoped. Validate it against the submitted world ceiling, persist it before publishing the complete world record, then publish that record once. If the owner write rejects, do not publish the world record. A failure may leave a client owner update applied; do not claim a transaction across client and world settings.
- Remove the multi-key quiesce/restriction/enable/final-matrix sequence. On publication failure, do not overwrite a concurrent GM's newer snapshot with a rollback or deny record. The durable world state may be the previous complete proposal or the complete proposal whose acknowledgement failed; malformed/duplicate state is denied by readers. Notifications must not claim a save succeeded when acknowledgement or verification failed.
- This is coherent ordinary admission, not immediate revocation of already-running calls or globally simultaneous propagation. An admitted read may finish under its complete captured snapshot. Existing live identity/ownership checks and approval rechecks remain intact; no new distributed lock, authority service or revision/CAS protocol.

## Acceptance
- [ ] Reproduce the two-GM race with independently scheduled clients sharing persisted storage: A requests enabled access limited to folder F and pauses; B requests disabled access with empty folders and completes; A resumes. Every observable usable enforcement record is one complete proposal, never enabled plus another proposal's unrestricted folders/rates. Exercise both completion orders and differing matrices, toggles, folders and rates.
- [ ] Fault injection covers each initialization step, owner write, publication and apply-then-reject acknowledgement. No compensating write can clobber the other GM's complete record. Fresh non-GM/stale-role/corrupt-rate rejection still produces zero world writes.
- [ ] Legacy/unmigrated reads, migration, monotonic-latch failures, post-migration legacy downgrade, unknown versions, malformed/missing fields, unreadable storage, forged/ambiguous record identity and absent/duplicate initial records are covered. Simultaneous first-create tests model a backend without key uniqueness and prove denial/repair reporting, not arbitrary selection.
- [ ] Actual policy evaluator/stage, folder filtering and real rate loader/resolver consume complete proposals. A deferred `document_get` UUID resolution combined with another publication uses its captured coherent snapshot; no old matrix/new unrestricted-folder mixture. Corrupt per-agent fallback remains strict and valid special-ID overrides survive a normal save.
- [ ] Existing settings menu/draft owner selectors, player privacy, native role checks, pending approval behavior and AI write/audit features remain unchanged. Adjust only obsolete storage-shape assertions in owned tests; do not weaken timing or security assertions.
- [ ] Focused storage, policy, rate and form tests pass independently; `npm run verify` passes with the supported runtime; independent security review passes before normal publication.

## Out of scope
Immediate distributed revocation, CAS/no-lost-update guarantees, socket locks,
a new server service, automatic duplicate repair/deletion, importing settings
from another world, unrelated UI features and live world settings changes for
validation. Do not widen ops/dispatcher or approval-manager scope without a
concrete new finding and an amended contract.
