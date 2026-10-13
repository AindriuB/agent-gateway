# 58 — Apply dnd5e advancements headlessly on embed and level-up

**Repo:** .
**Depends on:** 32
**Status:** Planned. The spike comes first. Andrew approves each native run.
**Owns:**
- module/src/adapters/dnd5e/** (new `advancement.ts` and edits to `embed.ts`, `build.ts`, `index.ts`)
- module/test/adapters/dnd5e/**
- e2e/dnd5e/** (new `advancements.e2e.test.ts`; `e2e/vitest.e2e.config.ts` already includes `dnd5e/**/*.e2e.test.ts`, so it is not owned)
- module/src/adapters/embed.ts: insertions only. Add one optional `EmbedHook` member that lets a hook perform the create itself (see "Embed seam"), plus its input and output types. No existing member changes.
- module/src/tools/compendium-import.ts: insertions only.
  - Add a branch that calls that member when the hook has one and claims the call. The existing `createEmbeddedBatch` path stays unchanged for every other hook.
  - One exception to insertion-only: the pf2e-only disclosure at :117-120 may be gated on `game.system.id === 'pf2e'`, so dnd5e calls do not print it.
- module/src/adapters/build.ts: insertions only. Add an optional `levelUp?(actor, input, context)` member on `BuildHook`.
- module/src/tools/character-build.ts: insertions only.
  - Route a `levelUp` input to `hook().levelUp` through the existing write handler. `prepare` escalates to write for `levelUp` as it does for `changes`.
  - When the hook has no `levelUp`, return "not supported on this system".
- protocol/src/tools/character-build.ts: insertions only, all optional.
  - Input `levelUp: {itemUuid ≤256, levels 1-19, choices ≤64}`. `choices` uses the same element shape as `compendium_import` `choices`. Refinements: `levelUp` requires `actorUuid`, and cannot be combined with `listChoices` or `changes`.
  - `choiceListing` gains `level` (int 0-20), `count` (int 1-20) and `advancementType` (≤32).
  - The output gains `choiceReport` (≤64, same entry shape as `compendium_import`) and `incomplete`.
  - The tool description's "Supported on pf2e only" sentence may be reworded to name dnd5e.
- protocol/src/tools/compendium-import.ts: description strings only, to say that `choices` also answers dnd5e advancements. No schema change.
- protocol/test/tools/character-build.test.ts, protocol/test/tools/compendium-import.test.ts: new cases only.
- module/test/tools/character-build/dispatch.test.ts, module/test/tools/compendium-embed/embed.test.ts: new cases only, covering the two seams.

Overlap: task 44 (write-audit correlation) does not own `module/src/adapters/dnd5e/**`, but PLAN.md assigns dnd5e's uncorrelated writes to it. If 44's design gate extends 44 into dnd5e files, 44 and 58 must not be in flight together.

## Goal
Embedding a dnd5e class, subclass, background, species (`race`) or feat currently leaves all of its advancements unapplied: no hit points, granted items, proficiencies or ASIs (task 32's note). Raising a class level has no path at all.

This task applies those advancements headlessly, with no dialog and no render, from a caller-supplied decision map, in two places:
- `compendium_import` with `actorUuid`
- a new `character_build` `levelUp`

Every write is audited and undoable, or disclosed.

This is the dnd5e counterpart of task 49 (docs/plan/done/49-pf2e-build-choices.md). Like 49 it has a spike first, decision maps, `listChoices` discovery, fails closed and is bounded.

## Context
- docs/plan/done/32-dnd5e-adapter.md: what exists, the leak notes, and the per-Actor action lock history.
- module/src/adapters/dnd5e/embed.ts:7-22: the header saying advancements are not applied.
- module/src/adapters/dnd5e/embed.ts:117-121: the `note` seam.
- module/src/adapters/dnd5e/embed.ts:144-217: `advancementReport`, which reads applied state per type. It is the oracle the acceptance tests reuse.
- module/src/adapters/dnd5e/build.ts:101-147: the build `running` set and the snapshot, recheck and single-update pattern.
- module/src/adapters/dnd5e/build.ts:150-158: the `listChoices` stub that this task replaces.
- module/src/adapters/dnd5e/index.ts:270-323: the bounded per-Actor `exclusive` queue (4 waiters, 25 s).
- module/src/adapters/embed.ts:38-71 and module/src/tools/compendium-import.ts:63-128: the embed seam. The `run` hook only wraps `create()` and gets no audit context.
- module/src/adapters/types.ts:11-17: `AdapterExecutionContext` (`callOptions`, `snapshot`, `intendCreate`, `created`).
- module/src/adapters/pf2e/build.ts:184-200: pf2e treats any unknown change `kind` as `feat_slot`. That is why level-up is a separate `levelUp` input and not a new `kind`.
- e2e/dnd5e/pacing.ts: writes are paced to 9 per minute and RATE_LIMITED is retried. Reuse it.

### dnd5e 6.0.6 source
Read-only: `ssh andrew@homelab.local`, `/srv/data/foundry/data/Data/systems/dnd5e/dnd5e.mjs`.

**Manager construction**
- `AdvancementManager` (:25085) is an `Application5e`.
- The constructor clones the Actor (`actor.clone({}, {keepId:true})`). Nothing renders until `render()` is called.
- `forNewItem` (:25309) puts the source on the clone. A class gets `levels = 0` and `createLevelChangeSteps`. Other types get flows for levels 0..`currentLevel`.
- `forLevelChange` (:25454) and `createLevelChangeSteps` (:25469) build steps for species, class, subclass and class-linked items for each new level.
- `forModifyChoices` (:25354) reverses and replays, so it is out of scope.
- `flowsForLevel` (:25528) constructs flow objects but does not render them.

**The step loop**
- `render()` (:25600-25633):
  - sets `system.levels` on the class step
  - calls `Hooks.call('dnd5e.preAdvancementManagerRender', this)`; returning `false` aborts the render
  - with `options.automaticApplication`, asks `step.flow.getAutomaticApplicationValue()`
  - for automatic data, runs the private `#forward` without awaiting it, and never reaches `super.render`
  - otherwise it renders the UI
- `#forward` (:25733-25788):
  - calls `flow.advancement.apply(level, automaticData, {automatic:true})`
  - runs the private `#synthesizeSteps` (:25793), which adds steps for items added mid-flow, for example a Subclass item or a granted feat with advancements
  - on `Advancement.ERROR` (:24603), shows `ui.notifications.error` and re-renders with the UI
- `#complete` (:25960-26005):
  - diffs the clone against the Actor into `updates`, `toCreate`, `toUpdate` and `toDelete`
  - calls `Hooks.call('dnd5e.preAdvancementManagerComplete', this, updates, toCreate, toUpdate, toDelete)`; returning `false` skips the commit
  - otherwise commits with `actor.performBulkUpdate(..., {isAdvancement:true, updateOptions:{diff:false, recursive:false}})`, with hard-coded options and no callId

**The commit**
- `Actor5e#performBulkUpdate` (:46212-46239) spreads its remaining `options` into every operation (Actor or ActorDelta update, Item create with `keepId`, delete, update), then calls `foundry.documents.modifyBatch`.
- So our own call with `{...callOptions, isAdvancement:true, updateOptions:{diff:false, recursive:false}}` carries `agentGateway.callId` on every operation.

**Per-type `apply(level, data, options)`**

All of them mutate only the clone through `updateSource`.

| Type | Line | What the call needs |
|---|---|---|
| HitPoints | :47326 | Data `{[level]: 'avg'\|'max'\|number}`; automatic only at level 1 of the original class (`max`) or when the previous level was `avg` (:47343). `valueForLevel` (:47266) returns a raw number unvalidated. When the level is missing it returns `null`, not `undefined`. `apply` then still writes `value` and adds `max(mod, 1)` HP. The driver must never call it with incomplete data. A roll is `Actor5e#rollClassHitPoints(item, {chatMessage})` (:44586), a core `Roll` that posts a chat message unless `chatMessage:false`. |
| ItemGrant | :48527 | Data `{selected, ability}`. Automatic unless `optional` or more than one spell ability (:48586). Loads each UUID with `createItemData` → `fromUuid` (:24969). |
| ItemChoice | :48749 | Data `{selected, ability, replace}`. Never automatic (:48781). `apply` checks neither the pool nor the count. `_evaluatePrerequisites(level, {showMessage:true})` (:48863) may raise UI notifications and silently reverse invalid picks. Configuration: `pool`, `restriction`, `type`, `allowDrops` and `choices[level].{count, replacement}`. |
| Trait | :27457 | Data `{chosen}`. Automatic only when every unfulfilled slot has exactly one option (:27493, `unfulfilledChoices` :27671). |
| AbilityScoreImprovement | :46938 | Data `{type:'asi', assignments}` or `{type:'feat', uuid}`. `apply` does not check the points budget. It clamps each ability to its max, skips abilities that `canImprove` rejects, and loads the feat UUID by `fromUuid`. No automatic value. |
| Subclass | :50109 | Data `{uuid}`. It sets `system.classIdentifier`. No automatic value. |
| Size | :49862 | Data `{size}`. `automaticApplicationValue` compares a Set to a number and returns a bare string (:49870), so the driver passes `{size}` itself. |
| ModifyItem | :49218 | Automatic (`{}`). It adds effects to other items already on the Actor, so those items appear in `toUpdate`. |
| ScaleValue | | Derived; no `apply`. |

**Settings, lifecycle and sites**
- `game.settings.get('dnd5e', 'disableAdvancements')` (:57514) switches all of this off natively.
- `close()` without `skipConfirmation` opens a confirm dialog (:25657).
- Native sites:
  - the sheet drop at :66402
  - the sheet level change at :65729
  - the class-drop level change at :67886
  - the deletion at :35974, which uses a dialog and stays out of scope

## Design (the spike may change it; record any change in the PR)

### Mechanism candidates (the spike chooses)
- **M1, native loop with guards.**
  - Build the manager with `forNewItem` or `forLevelChange` and `{automaticApplication:true}`.
  - On that instance only, replace each step's `flow.getAutomaticApplicationValue` with a function that returns the validated decision data. A step that is truly automatic keeps the native value.
  - Register two hooks, keyed to this manager instance and removed in `finally`:
    - `dnd5e.preAdvancementManagerRender` returns `false`, and records a failure, whenever the current step has no decision or has `step.error`, so no UI is ever rendered.
    - `dnd5e.preAdvancementManagerComplete` returns `false` and captures the diff.
  - Await completion through those hooks, with a timeout. Then close with `{skipConfirmation:true}`.
  - This keeps `#synthesizeSteps` native.
- **M2, own driver.** Walk `manager.steps` ourselves, calling `flow.advancement.apply(level, data, {automatic:true})` on the clone. Reproduce the class-level `updateSource`, `clone.reset()` and the synthesis of added items. Then diff as `#complete` does. Use this only if M1 cannot be kept headless. It copies private logic, so pin it to 6.0.6 with a version check that refuses on any other version.

Either way the commit is ours: one `actor.performBulkUpdate(diff, {...callOptions, isAdvancement:true, updateOptions:{diff:false, recursive:false}})`, run with no await between the final recheck and the call.

### Spike (an acceptance prerequisite; record in the PR, layer by layer)
On `dnd5e-test` (Foundry 14.369, dnd5e 6.0.6), with a temporary character and Andrew's per-run approval, answer:
- **(a)** Can steps be applied without rendering, through M1, M2 or both? Hook counters prove it (see Acceptance). Include whether `Advancement.ERROR` or `ui.notifications` fire on the headless path.
- **(b)** Does `agentGateway.callId` reach `preCreateItem`, `preUpdateItem` and `preUpdateActor` options for every operation of our `performBulkUpdate`? Is `modifyBatch` all-or-nothing when one operation fails? Do `ClassData#_onCreate` (:29191) or other follow-up writes land outside the batch? The existing `observe` counter shows this.
- **(c)** HP. Confirm that `roll` through `rollClassHitPoints(item, {chatMessage:false})` uses the core `Roll` (`CONFIG.Dice.randomUniform`), and that `avg` gives `hitDie/2+1`. Decision: `avg` and `roll` are the only caller values. `max` is applied only where dnd5e applies it automatically. Raw numbers are refused.
- **(d)** Which types must fail closed. The expected list is in "Fail closed". The spike confirms or extends it.

Any layer where (a) or (b) fails is refused up front with `INVALID_ARGS`. In that case embedding falls back to today's behaviour (no advancements applied, plus the note).

### Embed seam
`EmbedHook` gains one optional member, for example `commit?(input, context)`, with this contract:
- It performs the native create itself and returns `{uuids, uncorrelated, report}`.
- compendium-import uses it in place of `createEmbeddedBatch` only when it is present and claims the call.
- The hook must:
  - call `context.intendCreate(actor)` before writing
  - snapshot the Actor and every pre-existing Item in `toUpdate` before writing
  - call `context.created(uuid, actor)` for every created document, primary first
  - refuse a non-empty `toDelete` before any write
- The output `uuid` is the primary item, and `created` lists the grants.

### Decisions (one encoding for both tools)
`choices` entries are `{flag, itemUuid?, value}`:
- `flag` is `<advancementId>:<level>`. The spell-ability sub-choice of ItemGrant and ItemChoice is `<advancementId>:<level>:ability`.
- `itemUuid` names the item that carries the advancement. The compendium UUID matches the embedded copy through `_stats.compendiumSource`.

`value` by type:

| Type | `value` |
|---|---|
| HitPoints | `avg` or `roll` |
| ItemChoice | comma-separated pool UUIDs, exactly `count` of them, no duplicates, each in `configuration.pool` |
| ItemGrant (optional items) | comma-separated UUIDs from `configuration.items` |
| Trait | comma-separated keys, exactly the unfulfilled count, each in the slot's pool |
| AbilityScoreImprovement | `asi:<abl>+<n>,...` (each ability `canImprove`, sum equals `configuration.points`, result ≤ max), or `feat:<Compendium Item UUID>` (a type `feat` the user can observe, and only when `allowFeat`) |
| Subclass | a Compendium `subclass` UUID the user can observe, whose `classIdentifier` matches the class |
| Size | one of `configuration.sizes` |

Every UUID is validated as a canonical Compendium Item in a pack the executing (server-set) user can observe, before anything loads it through `fromUuid`.

### Discovery
dnd5e `listChoices(source, uuid, user)` returns one `choiceListing` per decision the item needs, for levels 0-20:
- each listing carries `flag`, `itemUuid`, `level`, `count`, `advancementType`, `prompt` (the advancement title, ≤200, plain text) and `options` (`{value, label}`, ≤50, `truncated`)
- HP options are `avg` and `roll`; ASI lists the abilities plus `feat:` when allowed

It also:
- recurses into ItemGrant items, depth ≤2, loading ≤32 documents in total
- does not recurse into ItemChoice picks, which are listed separately by their own UUID
- returns ≤64 choices
- performs no writes, constructs no `AdvancementManager` render, and calls no `Application#render`

An ItemChoice with `allowDrops` and no pool, or with only a `restriction`, is listed with `unsupported` set.

### Fail closed
These are refused with `INVALID_ARGS` before any write:
- any decision missing, extra, malformed or not in the options
- ItemChoice `replacement`, and ItemChoice drop-ins outside the pool
- ASI over budget
- HP numbers or `max`
- `toDelete` non-empty
- an unknown advancement type
- a non-`character` Actor, or an unlinked token Actor
- more than one class `levelUp` per call

The rules for the setting and the unanswered option:
- When `disableAdvancements` is on, nothing is applied: the item is embedded as today and that is disclosed.
- `onUnanswered: 'ignore'` on dnd5e means none of this item's advancements are applied (today's behaviour plus the note). Every needed decision is then reported `unanswered` and `incomplete` is true. There is no partial application.

### Bounds and locking
- Steps per call: ≤128 (including synthesised steps).
- Documents loaded: ≤40. Created items: ≤`AUDIT_LIMITS.targets`.
- One `performBulkUpdate` per call. Wall time: ≤20 s (under the 30 s gateway limit). Output `choiceReport`: ≤64.
- Embed and `levelUp` run inside the dnd5e per-Actor `exclusive` queue (index.ts:288), recomputing the plan inside it.
- A source hash of the Actor and its Items is taken before the snapshots and rechecked after them. If it changed, the call is refused.

## Acceptance
- [ ] The PR description records the spike answers (a)-(d), names the chosen mechanism (M1 or M2) and lists every layer that fails closed.
- [ ] Unit tests with a dnd5e stub apply each supported type headlessly from a decision map, and afterwards `advancementReport` (embed.ts:180) shows it applied. The types are HitPoints (`avg`, `roll`, automatic `max`), ItemGrant (automatic and optional), ItemChoice, Trait, ASI (`asi` and `feat`), Subclass, Size and ModifyItem.
- [ ] With the dnd5e stub, `listChoices` on a class source returns, for each level, the real pools, counts and levels with `flag` = `<advId>:<level>`. A unit test asserts:
  - ≤64 choices, ≤50 options each, and ≤32 loaded documents
  - no create, update or delete call and no `render` call
- [ ] Each case in "Fail closed" has a unit test asserting `INVALID_ARGS` naming the flag, with no `intendCreate`, no `snapshot`, no `performBulkUpdate` and no `fromUuid` for an unvalidated UUID.
- [ ] In every unit test, the stub's `Application#render`, `AdvancementManager#render` super path, `renderAdvancementManager` hook, `ui.notifications` and `close` without `skipConfirmation` are counted, and every count is 0 for agent calls.
- [ ] The commit is exactly one `performBulkUpdate` whose options contain `agentGateway.callId`. A unit test asserts:
  - `intendCreate` happens before it
  - snapshots cover the Actor and every pre-existing updated Item
  - `ctx.created` is called once per created Item, primary first
  - any uncorrelated follow-up write counted by `observe` appears in the result text
- [ ] `character_build` `levelUp` raises an embedded class by `levels`, applies its, its subclass's and class-linked items' advancements from `choices`, and returns `choiceReport`. Protocol tests cover:
  - the `levelUp` bounds
  - `levelUp` with `listChoices` refused, and `levelUp` with `changes` refused
  - `levelUp` without `actorUuid` refused
- [ ] Unit test: a pf2e or generic `character_build` call with `levelUp` returns "not supported", and pf2e's `apply` is not called.
- [ ] Unit tests for concurrency:
  - a 5th concurrent call on the same Actor is refused before any write
  - an Actor changed between plan and snapshot is refused
  - the queue is empty after a throw
- [ ] The compendium-import result no longer prints the pf2e follow-up disclosure on dnd5e. The dnd5e `note` reports applied advancements accurately, through `advancementReport` on the committed Item.
- [ ] `e2e/dnd5e/advancements.e2e.test.ts` builds a level-3 character on `dnd5e-test` (Foundry 14.369, dnd5e 6.0.6).
  - Gate: it runs with `AGENT_GATEWAY_E2E_DND5E_WORLD=dnd5e-test`, `FOUNDRY_WORLD=dnd5e-test`, `AGENT_GATEWAY_E2E_SKIP_FIXTURES=1` and `FOUNDRY_PLAYER_USER=Player1`. Otherwise every test is registered and skips with a message.
  - It creates a temporary character.
  - For each of a background, a species and a level-1 class (pack entries chosen from the installed SRD packs and pinned as constants), it calls `listChoices` and then `compendium_import` with a full decision map.
  - It then calls `character_build` `levelUp` by 2, including the subclass decision at level 3, with HP `avg`.
  - It asserts:
    - `details.level === 3`
    - the class has `levels === 3`
    - a subclass Item is present
    - `hp.max` equals the `avg` formula
    - `character_build` reports no unapplied or partial advancements
    - a page-installed counter of `renderApplication`, `renderApplicationV2` and `renderAdvancementManager` hooks stays 0 throughout
    - undoing the `levelUp` call restores level 1 and its HP
  - It deletes the Actor by exact UUID in `finally`, and writes are paced through `e2e/dnd5e/pacing.ts`.
  - Each native run needs Andrew's approval.
- [ ] `npm run verify` passes.

## Out of scope
- Level-down, `forModifyChoices`, `forDeletedItem` and `forDeletedAdvancement` (reversal and replacement flows).
- ItemChoice `replacement` and drop-in picks outside the pool, and `restriction`-only pools (listed as unsupported).
- Multiclassing beyond raising an existing class (`levelUp` targets one embedded class).
- Correlating `Activity#use`, `toggleStatusEffect` or `ClassData#_onCreate` follow-up writes (task 44).
- Any change to pf2e files, `SystemAdapter`, `module/src/adapters/types.ts`, `e2e/vitest.e2e.config.ts` or the pack API.
- Ability-score generation (point buy or rolled), which stays a `document_update`.
- PLAN.md, HISTORY and docs (scribe).
