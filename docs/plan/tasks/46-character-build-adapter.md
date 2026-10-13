# 46 — Add a bounded character-build interface (pf2e first)

**Repo:** .
**Depends on:** none
**Status:** Next (Andrew, 2026-10-13): wave 1, before 32
**Owns:**
- protocol/src/tools/character-build.ts (new)
- protocol/src/tools/index.ts (insertion only)
- protocol/test/tools/character-build.test.ts (new)
- protocol/test/tools/rules/validate.test.ts (insert one `character_build` example only; exhaustiveness guard)
- module/src/tools/character-build.ts (new)
- module/src/tools/index.ts (insertion only)
- module/src/ops/context.ts (insert one `character_build` write-escalation clause in `actionCategory` only)
- module/src/adapters/build.ts (new: build-hook registry and types, system-agnostic)
- module/src/adapters/generic/build.ts (new)
- module/src/adapters/pf2e/build.ts (new)
- module/test/tools/character-build/** (new)
- module/test/adapters/pf2e/build.test.ts (new)
- e2e/pf2e-build/** (new)
- e2e/vitest.e2e.config.ts (insert one `pf2e-build/**/*.e2e.test.ts` line in the e2e-live include list only)

Overlap:
- `module/src/adapters/pf2e/build.ts` is under task 44's `module/src/adapters/pf2e/**`. 46 and 44 must not be in flight together.
- Task 49 depends on this task and extends its files.
- The build hook has its own registry, so this task leaves `module/src/adapters/types.ts`, `index.ts`, `generic/index.ts` and `pf2e/index.ts` alone; those belong to 32 and 44.
- dnd5e (32) may register a build hook later, as a follow-up after both tasks merge.

## Goal
Give agents a discoverable, validated way to make character-building choices on an owned Actor.
These are attribute boosts, key attribute, skill ranks and feat slot assignment. In the
2026-10-13 usability test they only worked through raw `document_update` and `script_run` writes.
The tool describes the build state and applies a bounded batch of changes as one approved, audited
write. pf2e is implemented first; every other system answers "unsupported".

## Context
- pf2e 8.6.0 (homelab `/srv/data/foundry/data/Data/systems/pf2e/pf2e.mjs`). The native `AttributeBuilder` is at :23827. Its writes are the paths to mirror:
  - ancestry boosts: `system.boosts.<slot>.selected` (:23911-23925)
  - background boosts (:23958-23967)
  - class key attribute: `system.keyAbility.selected` on the class Item, or `system.details.keyability.value` in manual mode (:23969-23970)
  - level boosts: actor `system.build.attributes.boosts.<level>` (:23972-23975)
- `ClassPF2e#prepareBaseData` defaults `keyAbility.selected` (:52201-52203).
- Skill ranks live at `system.skills.<slug>.rank` on the character. Feat slots are `system.location` on feat Items, grouped by `actor.feats`.
- module/src/tools/conditions.ts:18-28 and module/src/ops/context.ts:7-22 show the read tool that escalates to `write` when a change is present. Follow that pattern.
- module/src/tools/_adapters.ts:98-147 `invokeAdapter`. Use its actor checks, snapshot and `AdapterExecutionContext` construction. Do not add to `SystemAdapter` (types.ts:24-46).
- docs/plan/tasks/44-native-write-audit-correlation.md covers rule-element side effects of pf2e writes, which are not correlated today.
- protocol/test/tools/tool-count.test.ts:6-7 sets MAX_PLAYER_TOOLS 24 and MAX_GM_TOOLS 36. There are 33 tools today (22 player); this task adds one player tool.

## Acceptance
- [ ] A new tool `character_build` (minRole `player`, category `read`, handledBy `module`) takes:
  - `actorUuid`
  - optional `changes`: an array of at most 32 flat strictObjects with `kind` enum `attribute_boost|key_attribute|skill_rank|feat_slot`, plus optional `source` enum `ancestry|background|class|level`, `level` int 1–20, `slot` ≤100, `attribute` ≤32, `skill` ≤64, `rank` int 0–4, and `itemUuid` ≤256

  No unions; `conservativeProblems` is `[]`. Output: `supported`, plus bounded `boosts`, `keyAttribute`, `skills` and `featSlots` state, each array at most 128 entries, and an optional `message` of at most 2000 characters.
- [ ] With `changes` present, the call is classified `write`, both in `actionCategory` and by `prepare` escalation. A unit test shows policy sees `write` and the approval path runs. Without `changes` it is a read with no snapshot.
- [ ] The core resolves the build hook from module/src/adapters/build.ts. On any system without a hook, including generic, a read returns `supported:false` and a change returns INVALID_ARGS `Operation not supported for <system>`. Both are unit-tested.
- [ ] pf2e validation returns INVALID_ARGS, with no write, for each of these. A unit test covers each.
  - an attribute not in the slot's allowed `value` list
  - a duplicate attribute within one source or level
  - a level boost above the Actor's level, or not in 1/5/10/15/20
  - more than 4 boosts in one level
  - an unknown skill slug
  - a skill rank above the level cap: ≤2 below level 7, ≤3 below level 15
  - a `feat_slot` whose `itemUuid` is not a feat embedded in this Actor
  - an unknown or occupied slot
- [ ] Every Item and the Actor that the batch will update are snapshotted via the execution context before any write. All writes are `document.update(patch, callOptions)`. A unit test asserts snapshots precede updates and every update carries `callOptions.agentGateway.callId`.
- [ ] Any native rule-element side effect the adapter cannot correlate is disclosed in `message` and never claimed as undoable. Reconciling that is task 44's work. A unit test shows the disclosure appears only when the pf2e stub reports such a write.
- [ ] Identity comes only from the server-set user (`trustedUser`). A player-role user can change only an Actor they own (`checkActor`), and a unit test shows a non-owner is refused.
- [ ] In protocol tests, `toolsForRole(false)` includes `character_build`, and tool-count.test.ts still passes (≤24 player, ≤36 GM).
- [ ] `e2e/pf2e-build/build.e2e.test.ts` targets `test-world` (Foundry v14, pf2e 8.6.0).
  - It runs when both `AGENT_GATEWAY_E2E_PF2E=1` and `AGENT_GATEWAY_E2E_PF2E_WRITE=1` are set. Otherwise every test stays registered and skips at run time.
  - On a temporary GM-owned level-7 character it applies ancestry, background, class key and level-1/5 boosts, one skill rank and one feat slot in one call.
  - It asserts the state via `character_build` describe and `actor_summary`.
  - It deletes the actor by exact UUID in `finally`.
  - Native execution needs Andrew's per-run approval.
- [ ] `npm run verify` passes

## Out of scope
- ChoiceSet answers and listing pending choices (task 49)
- Adding Items from compendia (task 45)
- dnd5e build support (follow-up to 32); changing `SystemAdapter` in module/src/adapters/types.ts
- Correlating pf2e native side effects (task 44)

## Attempt 1 — failed
Head `0cd8a6c`. Tester PASS: `npm run verify` 3,689 fast / 2,227 slow; e2e-unit 163; e2e tsc and eslint clean. Reviewer REQUEST CHANGES; scope clean; all other acceptance met; the pf2e 8.6.0 data paths are confirmed.
- `module/src/adapters/pf2e/build.ts:163-164`: any untrained core skill is rejected as "Unknown skill". For example `{kind:'skill_rank', skill:'athletics', rank:1}` fails on a fresh character, so the e2e will fail.
  - Cause: a pf2e 8.6.0 character's stored `_source.system.skills` is sparse (`{}`). `CharacterPF2e.prepareBaseData` iterates `CONFIG.PF2E.skills` (pf2e.mjs:35316-35317).
  - Fix: validate slugs against the prepared `actor.system.skills`, or `CONFIG.PF2E.skills`.
  - The unit fixture hid the bug by pre-seeding stored skills (`module/test/tools/character-build/fixtures.ts:55`). Add a test on a sparse `_source.system.skills`.
- Suggestion, accepted as is: e2e cleanup in `afterAll` by exact UUID is equivalent to "in `finally`".

## Attempt 2 — live e2e failed (test bug)
Head `bbfc99e`, bundle `67403dc9…` deployed to homelab; Foundry 14.369, pf2e 8.6.0, `test-world`, approved by Andrew 2026-10-13. Verify is green: 3,691 fast / 2,227 slow; e2e-unit 163. Result: 1 of 2 live tests passed. "describes the unbuilt character" passed.

The build call returned `INVALID_ARGS: This feat cannot fill that slot`. The cause is in the spec: `e2e/pf2e-build/build.e2e.test.ts` takes the first open `featSlots` entry, which on a fresh character is an ancestry slot, and puts the temporary **class** feat in it. The adapter's refusal was correct. The batch was validated before any write, so nothing was applied. A read-only check afterwards found no leftover actors or items.

Fix the spec: choose an open slot whose group accepts the feat's category (for example `class-*`). If `describe` does not expose enough to choose, expose the slot's group and accepted categories as bounded data. Assert the refusal case too: a class feat put into an ancestry slot must return INVALID_ARGS with no write.
