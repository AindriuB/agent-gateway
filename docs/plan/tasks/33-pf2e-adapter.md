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

## Attempt 5 — failed
Head `ea22d19`. Tester PASS (`npm run verify`: 3,616 fast / 2,227 slow; e2e-unit 163; 6 pf2e e2e tests). Reviewer REQUEST CHANGES; strike identifier and synthetic-event dialog suppression confirmed against pf2e.mjs (:13765-13773, :19383, :20497, :36059), scope clean.
- `module/src/adapters/pf2e/index.ts:206-208` — `variant.roll` returns null without rolling (ranged with no ammo :35999-36005, out of range :36029-36031, unresolved origin); map null to a non-completed result instead of `completed: true`.
- `e2e/pf2e/pf2e.e2e.test.ts:136-141` — the 15 s bound wraps human approval (default GM policy asks for `document_create` and `action_perform`; APPROVAL_WAIT_MS 25 s). Handle `pending_approval` by polling the existing approval-status path to a terminal result, and do not bound wall-clock across human approval.
- `e2e/pf2e/pf2e.e2e.test.ts:143` — replace the post-hoc DOM count with a `Hooks.on('renderCheckModifiersDialog', …)` counter installed in the page before the call (CheckModifiersDialog, pf2e.mjs:19217) and assert it stayed zero.
- `e2e/pf2e/pf2e.e2e.test.ts:152` — require `t.undoable === true` (view-only `blankTarget` entries also have `existed:false`, audit/witness.ts:413, :469).
- `e2e/pf2e/pf2e.e2e.test.ts:159-161` — cleanup must not depend on the audit lookup: in `finally`, delete messages with `flags.pf2e.origin.uuid === <weapon uuid>` and `context.type === 'attack-roll'` (actor deletion does not remove chat).

## Attempt 6 — failed
Head `16176a2`. Tester PASS (`npm run verify` first run: 3,617 fast / 2,227 slow; e2e-unit 163). Reviewer REQUEST CHANGES; all Attempt 5 items fixed, adapter null-roll change correct, approval-text UUID regex confirmed (manager.ts:21-24, :664-669; document-create.ts:14), scope clean.
- `e2e/pf2e/pf2e.e2e.test.ts:128-144` — the frightened write test does not settle `pending_approval` (`conditions` with `change` is write → `ask_owner`). A late approval fails at :133 for harness reasons, and a pending restore makes :144 pass vacuously (undefined === undefined). Settle both calls and assert the restore against an actual read after it completes.
- `e2e/pf2e/pf2e.e2e.test.ts:148` — give tests that wait on human approval a per-test timeout that does not bound the human's decision (strike needs two approvals; each call waits 25 s before pending).
- `e2e/pf2e/pf2e.e2e.test.ts:33-34, :75` — treat an error result from `approval_status` as terminal (throw with its text) instead of polling silently; on the delete path include `actorUuid` in the thrown message so residue is named.
- Make cleanup robust to a timed-out or thrown `settle()`: `session.close()` and the actor delete attempt must still run (or report the residue UUID loudly).

## Attempt 7 — failed
Head `c54debb`. Tester PASS (`npm run verify`: 3,617 fast / 2,227 slow; e2e-unit 163). Reviewer REQUEST CHANGES; all other Attempt 6 items fixed, scope clean.
- `e2e/pf2e/pf2e.e2e.test.ts:16` — `HUMAN_TIMEOUT_MS` (10 min) is below the gateway approval TTL (60 min, module/src/approvals/config.ts:7). An approval between 10 and 60 min creates an unreported actor or chat message after the test gave up. Derive each human-waiting timeout from the TTL (import or mirror the constant) times the number of sequential approvals that test waits on, plus margin, and fix the comment at :14-15 to say the vitest timeout is what bounds the wait.

## Attempt 8 — live run failed (2 of 6)
Head `a854b38`, bundle `17a0793b…`, deployed to homelab; Foundry 14.369 / pf2e 8.6.0 `test-world`, 2026-10-12, Andrew approved. 4 passed (actions_list, inventory, conditions read, frightened 2 apply/restore). Cleanup exact: temporary actor deleted, no RESIDUE, no attack-roll message from the fixture left; audits retained.
- actor_summary: `perception` missing. Live pf2e 8.6.0 character `system.perception` is `{slug, value, totalModifier, dc, rank, …}` with no `mod`, and `system.attributes.perception` is undefined; `actor.perception.mod` is the Statistic. `module/src/adapters/pf2e/index.ts:107` reads `s.perception?.mod ?? s.attributes?.perception?.value`. Read `actor.perception?.mod` (fallback `system.perception.value`), and fix the unit fixture to the live shape.
- strike: the adapter worked — the audit page recorded `ChatMessage.<id> existed=false undoable=true` with `completed:true`, no dialog. The e2e lookup ran before the audit page was written and found nothing. Poll the journal for the matching `action_perform` page (bounded, e.g. 10 s) before asserting.

## Attempt 9 — PR #86 review finding
Head `83b749d` passed live 6/6 on v14 (see PR #86). Code review [P2]: `module/src/adapters/pf2e/index.ts:203` — strike attribution (author + origin uuid + `attack-roll` + identifier) is not invocation-specific. The identifier is shared across MAP variants, so a second strike by the same user with the same weapon that overlaps `variant.roll` passes the same checks; both messages are recorded via `context.created` and Undo can delete the other attack's message.
- Prefer invocation-specific attribution: check whether pf2e 8.6.0's strike roll params accept a `callback` (or similar) that receives the created message (search pf2e.mjs around the strike `roll` at :36041-36063 / :20478-20497 and `Check.roll` :19383+), and record only that message.
- If no such hook exists: record a message as created only when exactly one candidate appeared during the call; if more than one matches, record none as undoable (view-only or omitted) and say so in the result. Do not serialize as the only fix — a human strike in the same client still overlaps.
- Add a unit test with two overlapping same-weapon strike messages during one call, asserting the other attack's message is never recorded as an undoable created target.

## Attempt 10 — failed
Head `6e106f4`. Reviewer REQUEST CHANGES. Character strikes are now invocation-specific via the Check.roll callback (pf2e.mjs:36064, :19504-19531), confirmed; scope clean.
- `module/src/adapters/pf2e/index.ts:182-194` — NPC/hazard strikes (`system.actions` from melee items, pf2e.mjs:39073, :20403) call `Ca.roll(y, b, c.event)` without the callback (:20499). They post a message, return `completed:true`, and record nothing, silently (a regression from 83b749d). Minimum fix: when the strike resolved but the callback never fired, say in the result that the attack message was posted but not audited and cannot be undone. Only if a provably invocation-specific signal exists on that path may it be recorded. Add a unit test where `roll` ignores `callback`.
- `module/test/adapters/pf2e/pf2e.test.ts:233-245` — make the overlap test real: two concurrent `performAction` calls whose `roll` mocks interleave on a shared deferred, each calling back with its own message; assert each records only its own uuid.
- `index.ts:184` — record from the callback only when `message?.id` is set (a cancelled create yields `new ChatMessagePF2e(undefined)`, :19528).

## Attempt 11 — failed
Head `32ed177`. Reviewer REQUEST CHANGES; adapter code is correct (per-call `record`/`attributed` closures; NPC/hazard disclosure honest; id guard), scope clean.
- `module/test/adapters/pf2e/pf2e.test.ts:226-245` — the overlap test shares one `ctx`/`created` spy, so it cannot catch cross-attribution. Give each concurrent `performAction` its own context and `created` spy; assert call 1 recorded exactly `['ChatMessage.mine1']` and call 2 exactly `['ChatMessage.mine2']`.
- `module/src/adapters/pf2e/index.ts:182` comments — fix pf2e citations: `new ChatMessagePF2e(O)` is pf2e.mjs:19536; the callback block is :19535-19537.
- `index.ts:204-206` — when the callback fired with an id-less (cancelled) message, do not say the message "was posted"; use distinct text that no message was created.

## Attempt 12 — PR #86 review findings (head 457cda3)
Live 6/6 on v14 at `457cda3`. Code review found two audit defects against Task31's contract (`docs/plan/done/31-adapter-interface.md`, "Mutation methods receive … `callOptions`, `snapshot`, `intendCreate` and `created` … snapshot validated existing targets before mutation and use existing call/audit correlation").
- [P2] `module/src/adapters/pf2e/index.ts:190` — native rolls, `toMessage` and condition/consume writes omit `context.callOptions`, so the GM audit witness cannot correlate player-created documents with the call and leaves them view-only even though their UUIDs were recorded. Pass `context.callOptions` into every native document operation that accepts create/update/delete options (strike `variant.roll` / `Check.roll` message creation, `item.toMessage`, `spell.toMessage`, `entry.consume`, `increaseCondition` / `decreaseCondition` / `ConditionManager.updateConditionValue`). Confirm in pf2e.mjs (cite lines) where each forwards its options to `ChatMessage.create` / `Document.update|create|delete`; where pf2e drops them, find the supported path that does carry them, or report the gap explicitly. Reuse how existing core write tools pass `callOptions` (module/src/tools/_write.ts and the witness/correlation code under module/src/audit/) — do not invent a new mechanism.
- [P2] `index.ts:249` — spell casting mutates the spellcasting-entry Item (slots) and/or the spell Item (innate/uses); conditions create/update/delete condition Items. Only the Actor is snapshotted, and Actor restoration excludes embedded collections, so Undo leaves slots/uses spent and conditions changed. Before mutating, enroll each existing embedded target via `context.snapshot` (entry, spell, existing condition Item) and declare new condition Items via `intendCreate`/`created`. Unit-test that each mutating path snapshots/declares exactly the embedded documents it touches.
- e2e: after the frightened apply/restore and the strike, assert the audit page's targets include the touched embedded documents and the ChatMessage as undoable (not view-only). Native Undo invocation stays out of scope unless Andrew asks.

## Attempt 13 — failed; Andrew's decisions (2026-10-12)
Head `0de4d8b`. Reviewer REQUEST CHANGES. Confirmed good: the chat path (native `create:false`, then `ChatMessage.create(data, {...opts, ...callOptions})`) is faithful, including whisper, blind and private GM rolls (foundry roll.mjs:947-953, chat-message.mjs:552-555), and it is undoable for GM and player callers (witness.ts:281-291, :354-363, :392-427). A stale target only makes that target non-undoable; Undo still restores the call's other targets (stage.ts:115-118, :218-223; undo.ts:258-262).

Andrew decided:
1. **Conditions use pf2e's native condition API** (`increaseCondition` / `decreaseCondition` / `ConditionManager.updateConditionValue`), as Acceptance says. Remove the replicated create/update/delete logic. These calls cannot carry callOptions, so condition changes are not undoable through audit:
   - Before the change, snapshot the existing condition Item and every Item it grants that pf2e will cascade-delete (`processGrantDeletions`, pf2e.mjs:45773-45789, :45387-45412). They go stale, so Undo refuses them and does not half-restore.
   - The conditions result must say plainly that the change cannot be undone.
2. **Spend gaps accepted, follow-up task to come.** `entry.consume` (slots, innate uses, focus points via the Actor) and strike ammo or thrown-weapon spending stay native, with no reimplementation and no `consumeAmmo:false`. Keep the snapshots taken before each spend.
   - Whenever a cast or strike actually spent something, the `action_perform` result must say that the spend cannot be undone. This uses the same style as the NPC-strike disclosure. It also covers focus points, where the Actor target goes stale.

Also fix:
- `index.ts:297-302` — pass `messageMode` when creating the `Item#toMessage` replica, as native does at pf2e.mjs:45495-45496.
- e2e — the frightened test must no longer expect undoable condition Items. Assert instead that the result carries the "cannot be undone" disclosure, and that the restore still yields the prior value. Keep the strike ChatMessage undoable assertion.

## Attempt 14 — failed (small)
Head `78f067a`. Tester PASS. Reviewer REQUEST CHANGES; all of Andrew's decisions were implemented correctly, and scope is clean.
- `module/src/adapters/pf2e/index.ts:522-524`: the value-update branch snapshots the whole cascade set, but `updateConditionValue` (pf2e.mjs:48967-48975) touches only the condition Item. Snapshot only `existing.uuid` there.
- `index.ts:384`: the "failed after its slot or focus point was spent" wording appears even when nothing was spent. Use it only when `spends` is non-empty.
- `index.ts:472-493`: when pf2e would cancel the deletion because of a `restrict` grant (pf2e.mjs:45389-45403), stop. Snapshot nothing and do not report success. Return what pf2e reports, or the unchanged conditions.

## Attempt 15 — PR #86 review findings (head 4fab588)
Live 6/6 on v14 at `4fab588`. The code review found two defects:
- [P2] `module/src/adapters/pf2e/index.ts:204`: actions are listed and run only from `actor.itemTypes.action`. pf2e also stores actionable abilities as `feat` Items that have an action cost. The pf2e 8.6.0 character sheet (`src/module/actor/character/sheet.ts` ~L417) lists them among actions. Include eligible feats, meaning those with `system.actionType.value` of action, reaction or free, in both `listActions` and `performAction`, with the same cost label and `toMessage` path. Confirm the eligibility rule in pf2e.mjs and cite lines. Add a unit test, and make the e2e check for a costed feat if one can be created on the temporary actor.
- [P2] `index.ts:383`: when a cast fails after `consume` spent something, the adapter throws. `invokeAdapter` (outside Owns) turns the throw into "System adapter returned an invalid result", which hides the spend disclosure, so a caller may retry and spend again. Inside Owns, return a valid result instead of throwing: `{completed:false, message: "Casting X failed after its <spend> was spent and cannot be undone: <reason>"}`. Use the same pattern for any other post-spend failure. Unit-test that the disclosure reaches the tool result.
