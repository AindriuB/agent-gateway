# 33 — Add the pf2e system adapter

**Repo:** .
**Depends on:** 31
**Status:** Next system adapter by Andrew's priority change, after accepted Task31 bounded native validation is published/merged. Implementation has not started; no Task33 native fixtures or writes are authorized.
**Owns:**
- module/src/adapters/pf2e/**
- module/test/adapters/pf2e/**
- module/src/adapters/index.ts (registry insertion only)
- e2e/pf2e/**
- e2e/vitest.e2e.config.ts (add the pf2e spec to the e2e-live include list only)

## Goal
Implement the adapter for pf2e 8.6.x: summaries, strikes and actions with their
action costs, performing them through the system's own API, inventory with
bulk, and conditions with values.

## Context
- docs/plan/specs/2026-10-09-agent-gateway.md:159-161 — adapter interface
- homelab `test-world` runs pf2e 8.6.0
- module/src/adapters/types.ts, module/test/adapters/contract.ts (31)
- This adapter is internal to the core, not a tool pack (see 31); it adds no tool names and nothing to the pack API

## Acceptance
- [ ] Passes `contract.ts` with pf2e fixtures
- [ ] `actorSummary` includes HP, AC, level, saves, perception, speed, hero points; `listActions` covers strikes (with MAP variants), actions with action cost, spells by rank; `performAction` uses the system's strike/action/spell APIs
- [ ] `inventorySemantics` reports bulk, invested and equipped state; `conditions` handles valued conditions (e.g. frightened 2) via the system condition API
- [ ] e2e spec under `e2e/pf2e/` runs against `test-world` on foundry.local v14
- [ ] `npm run verify` passes

## Out of scope
- dnd5e (32)

## Attempt 1 — failed
Head `3f06dc9`. Tester PASS (`npm run verify`: 3,607 fast / 2,227 slow; e2e tsc and eslint clean). Reviewer REQUEST CHANGES:
- e2e spec is never collected: `e2e/vitest.e2e.config.ts` e2e-live `include` lacks `pf2e/**`. Now in Owns (Andrew approved 2026-10-12, commit `3f06dc9` by the planner, not the implementer).
- Fixture: Andrew chose a dedicated fixture. The spec must create its own temporary GM-owned pf2e character and delete exactly that UUID afterwards (no seed-manifest change, no repurposed actor). Native execution still needs Andrew's per-run approval.
- `module/src/adapters/pf2e/index.ts:157-163` — requested spell rank is not checked against `spell.baseRank`; native `cast` spends a lower slot and still casts at base rank (pf2e.mjs:53137 `computeCastRank`).
- `index.ts:152-155` — spell id's entry part is not checked against `spell.system.location.value`; a forged `spell:<otherEntry>:<spell>` spends another entry's slots.
- `index.ts:142-164` — strike/action/spell ChatMessages are created without `context.intendCreate`/`context.created`, so they escape the audit trail (Task 31 contract, `_write.ts:6`).
- `index.ts:164` — focus spell with 0 focus points reports `completed:true` though `consume` returned false.
- Suggestions: reject `persistent-damage` (native opens a GM dialog and applies nothing); e2e write test should restore prior frightened state, not remove it; format spell `cost` like `costLabel`.

## Attempt 2 — failed
Head `3f345c9`. Tester PASS (`npm run verify`: 3,610 fast / 2,227 slow; e2e-unit 163; e2e tsc/eslint clean). Reviewer REQUEST CHANGES; all Attempt 1 items confirmed fixed, scope clean.
- `module/src/adapters/pf2e/index.ts:61-68` — `auditedChat` records every `createChatMessage` by the same user while the call is in flight (e.g. a `chat_post` or another message during a check dialog). Those become `undoable` created targets, so audit Undo would delete messages the call never made. Record only messages provably produced by this call (e.g. use returned messages, or match speaker actor + origin item/flags); if a message cannot be attributed, do not record it as created.
- Suggestions: if `entry.cast` throws after `consume` succeeded, say in the error that the slot/focus point was spent; with no `rank`, pick the prepared slot rank (or return INVALID_ARGS) instead of letting native `consume` throw "Slot not given"; the e2e spec must assert the `document_delete` result so a refused delete is not silent.
- Tester: `vitest list --project e2e-live` showed no pf2e test names even with `AGENT_GATEWAY_E2E_PF2E=1`. Confirm the spec's tests are actually registered when enabled (not skipped by an import-time condition or hidden by `beforeAll`), so a live run cannot pass vacuously.

## Attempt 3 — failed
Head `f52d159`. Tester PASS (`npm run verify`: 3,612 fast / 2,227 slow; e2e-unit 163; 5 pf2e e2e tests always registered, run-time skip). Reviewer REQUEST CHANGES; other Attempt 2 items fixed, scope clean.
- `module/src/adapters/pf2e/index.ts:71` — attribution by `speaker.actor` + author is not proof: a concurrent `chat_post` with the same actor as speaker (chat-post.ts:116, :140) is recorded as a created target of the strike and deleted by its Undo. Attribute per path using pf2e 8.6.0 (pf2e.mjs):
  - Action: record only the message returned by `item.toMessage()` (:45496); no hook.
  - Spell: after `consume`, call `spell.toMessage(null, {actualCast: true, data: {castRank}})` directly and record its returned message (:53446, as `cast` does at :53789-53794); otherwise require `flags.pf2e.origin.uuid === spell.uuid` and `flags.pf2e.casting.id === entry.id`.
  - Strike: require `flags.pf2e.origin.uuid === item.uuid`, `flags.pf2e.context.type === 'attack-roll'` and `context.identifier === \`${item.id}.${slug}.${mapIndex}\`` (:19517, :20480-20481) in addition to author.
  - Add a unit test: a same-actor, same-author message without pf2e origin flags created during the call is not recorded.
- Pass `skipDialog: true` to `variant.roll` so a strike never blocks on a GM check dialog (:19383).
- Replace the bare `catch { return false }` around `consume` (index.ts:221-224) with INVALID_ARGS asking for `rank` on "Slot not given", or the native error text otherwise.

## Attempt 4 — failed
Head `9a565c3`. Tester PASS (`npm run verify`: 3,614 fast / 2,227 slow; e2e-unit 163). Reviewer REQUEST CHANGES; action and spell attribution, consume errors and the same-actor test are fixed, scope clean. The Attempt 3 note's strike identifier format was wrong; this corrects it.
- `module/src/adapters/pf2e/index.ts:186` — strike `context.identifier` is `${item.id}.${slug}.${melee|ranged}` (from `item.isMelee`), the same for all three MAP variants; the MAP index is only in `mapIncreases` (pf2e.mjs:36042 with :35845/:35920 for characters; :20373/:20480 for NPCs). Fix the identifier and the unit fixture at `module/test/adapters/pf2e/pf2e.test.ts:120`, which copied the wrong format.
- `index.ts:198` — `variant.roll({skipDialog: true})` is ignored: character/NPC `roll` never copy it into the check context, and `Check.roll` sets `skipDialog ??= !showCheckDialogs` (:19383, :36041-36063, :20478-20497). The only caller control that reaches it is `event` through `eventToRollParams` (:13768-13773), where Shift inverts the user setting. Make the strike never open the dialog regardless of the user's setting (verify the mechanism in source), and test the behaviour, not the argument shape.
- Add one live strike to `e2e/pf2e/pf2e.e2e.test.ts` on the temporary fixture (behind `AGENT_GATEWAY_E2E_PF2E_WRITE`) that asserts the strike completes without a dialog and its ChatMessage is recorded as a created audit target; clean that message up with the fixture.
