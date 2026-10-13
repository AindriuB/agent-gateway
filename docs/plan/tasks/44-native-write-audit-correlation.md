# 44 — Correlate native system writes with their audited call

**Repo:** .
**Depends on:** 33
**Status:** Queued after 32 (Andrew, 2026-10-13). Must not be in flight alongside 45, 46 or 49, which add files under `module/src/adapters/pf2e/**`.
**Owns:**
- module/src/audit/**
- module/test/audit/**
- module/src/adapters/types.ts (AdapterExecutionContext additions only)
- module/src/adapters/pf2e/**
- module/test/adapters/pf2e/**
- module/src/tools/conditions.ts
- module/test/tools/adapters/**
- protocol/src/tools/conditions.ts
- protocol/test/tools/adapters/**
- e2e/pf2e/**

## Goal
System adapters must call native system APIs that write Foundry documents without
accepting the audit `callOptions`. Those writes reach the audit stage and witness
uncorrelated: their targets go stale, Undo refuses them, and newly created Items are
not recorded at all. Task 33 ships this fail-closed behaviour with disclosures.
This task adds a trusted core-side way to attribute native writes made during an
adapter call to that call, and to nothing else. It makes the pf2e adapter's spend,
condition and cascade writes undoable through it, removes the disclosures that
become false, and adds a bounded in-band `message` to the `conditions` output
(Andrew's decision, 2026-10-12, task 33 review).

## Context
- module/src/audit/stage.ts:264-300 — the audit stage mints `callId`, sets
  `ctx.callOptions = { agentGateway: { callId } }` and, on a GM client, watches
  changes through `snaps.intervene`. This is the only correlation today.
- module/src/audit/witness.ts:157-330 — `AuditWitness`: per-(sender, callId)
  records, admits a hook only when `call.sender === userId &&
  options?.agentGateway?.callId === call.callId` (around :282 and :314).
- module/src/audit/undo.ts:71-113, :295 — `conflictFor` makes un-correlated changes
  to a target read as conflicts, so Undo refuses.
- module/src/adapters/types.ts:11-17 — `AdapterExecutionContext` (trusted, never public).
- module/src/adapters/pf2e/index.ts:131, :258, :295-302, :354, :509 — current
  non-undoable disclosures and the condition Item enrolment.
- pf2e 8.6.0 native writers without `callOptions`: `SpellcastingEntryPF2e#consume`
  (slots, innate uses, focus points on the Actor); strike ammunition and thrown-weapon
  spending (`consumeAmmo`, `Check.roll`); `increaseCondition`, `decreaseCondition`,
  `ConditionManager.updateConditionValue`, including granted and cascaded condition Items.
- PROJECT.md "Reviewing a PR" — identity only from Foundry's server-set user; no
  unbounded work or memory.

## Design gate
Before writing code, run an `architect` pass on the correlation mechanism and record
its conclusion in the PR description. A scoped `preCreate`/`preUpdate`/`preDelete`
stamping hook is one candidate. The design must answer each of these:
- Scope. The hook is active only for the duration of the adapter's native call, only
  on the calling client, and only for documents the call enrolled: the Actor, its
  embedded Items and Items created under it. Writes to any other document are not stamped.
- Concurrency. The design says how two overlapping audited calls on the same client
  are told apart, for example by serialising native adapter writes per client or by
  refusing to stamp when more than one scope is open. Ambiguity resolves to *not
  attributed*, never to the wrong call.
- Identity. GM-side attribution still uses the server-set `userId` of the hook, never
  a value carried in options alone. Another user's write carrying a forged or copied
  `agentGateway.callId` is not admitted.
- Bounds. Stamped and recorded targets stay under the existing capture limits in
  module/src/audit/ (`CAPPED_NOTE`, `PATH_LIMIT_NOTE` behaviour unchanged).

## Acceptance
- [ ] PR description contains the architect's conclusion covering the four points in
      "Design gate"
- [ ] A native-write scope is exposed to adapters only through
      `AdapterExecutionContext` (no new public tool argument, no pack API change:
      `rg -n "nativeScope|native" protocol/src` shows no new input field)
- [ ] Unit test (module/test/audit/): a write stamped inside call A's scope is
      recorded on call A and is undoable; the same document written by native code
      after the scope closes is not attributed to A
- [ ] Unit test: with two overlapping scopes (calls A and B, same client), a native
      write is attributed to exactly one of them or to neither, never to both. A write to
      B's enrolled document is never recorded on A.
- [ ] Unit test: a write by another user, including one whose options carry A's
      `agentGateway.callId`, is not attributed to A on the GM witness; A's Undo then
      reports a conflict for that target
- [ ] Unit test: a write to a document outside the call's enrolled set (another
      Actor) made during the scope is not stamped
- [ ] Unit test: an Item created natively inside the scope (e.g. a granted condition
      Item) is recorded as a created target and Undo deletes it
- [ ] pf2e unit tests: spell slot / innate use / focus point spends, ammunition and
      thrown-weapon spends, and `conditions` changes (including valued, granted and
      cascaded condition Items) each produce audit targets that Undo restores
      exactly in the fixture
- [ ] The disclosures at module/src/adapters/pf2e/index.ts (spend "cannot be
      undone", condition non-undoable notes) are removed for every write now
      correlated. A disclosure remains only for writes that are still uncorrelated,
      and a test asserts which.
- [ ] `conditionsOutput` gains `message: z.string().max(2000).optional()`;
      protocol/test/tools/adapters/ asserts it is optional and rejects 2,001 chars
- [ ] module/src/tools/conditions.ts passes the adapter's `message` through; a test
      shows a condition change with an undo limit returns it in-band
- [ ] e2e/pf2e/ live spec (foundry.local v14, `test-world`, pf2e 8.6.0, dedicated
      temporary GM-owned character deleted by exact UUID afterwards) casts a slotted
      spell, applies frightened 2 and then Undoes both. It asserts the slot count and
      the condition state return to their before-values. Native execution needs
      Andrew's per-run approval.
- [ ] `npm run verify` passes

## Out of scope
- The dnd5e adapter itself (task 32). The mechanism must be system-agnostic, but
  wiring dnd5e is not part of this task.
- The generic adapter (module/src/adapters/generic/**) and the adapter registry
  (module/src/adapters/index.ts)
- Changing `action_perform` output shape (protocol/src/tools/action-perform.ts)
- Attributing writes made by modules or macros outside an adapter call
- PROTOCOL_VERSION or link message changes (protocol/src/link/**); if the architect
  finds a bump is required, stop and report
