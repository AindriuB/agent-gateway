# 45 — Embed a compendium entry in an owned Actor

**Repo:** .
**Depends on:** none
**Status:** Complete. Offline gate green; native v14 acceptance passed 2/2 (Foundry 14.369 / pf2e 8.6.0). Merge PR number is added when Andrew merges. Follow-up limits are in Task44 and Task49.
**Owns:**
- protocol/src/tools/compendium-import.ts
- protocol/test/tools/compendium-import.test.ts (new)
- module/src/tools/compendium-import.ts
- module/src/tools/_documents.ts (add exported helpers only; existing exports keep their behaviour)
- module/src/adapters/embed.ts (new: system-agnostic embed-hook registry)
- module/src/adapters/generic/embed.ts (new)
- module/src/adapters/pf2e/embed.ts (new)
- module/test/tools/compendium-embed/** (new)
- module/test/adapters/pf2e/embed.test.ts (new)
- e2e/pf2e-embed/** (new)
- e2e/vitest.e2e.config.ts (insert one `pf2e-embed/**/*.e2e.test.ts` line in the e2e-live include list only)

Overlap:
- `module/src/adapters/pf2e/embed.ts` falls under task 44's `module/src/adapters/pf2e/**` glob, so 45 and 44 must not be in flight at the same time.
- Task 49 later edits this task's files. That is a dependency edge, not a conflict.
- The embed hook lives in its own registry, so this task does not touch `module/src/adapters/types.ts`, `module/src/adapters/index.ts`, `generic/index.ts` or `pf2e/index.ts`. Those files belong to 32 and 44.

## Goal
Let an agent add one compendium entry, by UUID, to an Actor it may modify. The entry becomes an
embedded Item, with no hand-built source JSON. Optional bounded overrides set quantity, equipped
state and a system feat slot. This replaces the `script_run` calls that the 2026-10-13 usability
test needed to equip and give feats to five pf2e PCs. The write goes through the existing
approval, policy and audit path and declares every document it creates.

## Context
- protocol/src/tools/compendium-import.ts:10-16: the input has only `uuid` and `folder`. The tool creates world documents only.
- module/src/tools/compendium-import.ts:12-55: the pack, entry and identity checks to reuse. Native conversion is at :49 (`collection.fromCompendium`); the create is at :55.
- module/src/tools/document-create.ts:11-13: embedding via `parentUuid` exists but needs raw source JSON. compendium_get returns markdown only (protocol/src/tools/compendium-get.ts:15-22), so an agent cannot get that source.
- module/src/tools/_documents.ts:
  - :167-201 `checkCreate` does the native embedded schema and permission check.
  - :292-320 `createDocument` records only `made[0]` (:309, :318), so it misses the extra Items pf2e creates in the same batch.
- module/src/tools/_write.ts:58-84 `defineWriteHandler`; :1-7 describe the intendCreate/created contract.
- module/src/tools/_adapters.ts:76-97 `checkActor` is the pattern for a canonical owned world Actor.
- pf2e 8.6.0, at homelab `/srv/data/foundry/data/Data/systems/pf2e/pf2e.mjs`:
  - `ItemPF2e.createDocuments` (:45697-45770) adds class and GrantItem grants to the same batch (:45736). It runs every rule's `preCreate` (:45755). It sends `itemUpdates` with `{render:false}` and no callOptions (:45768).
  - `ChoiceSetRuleElement#preCreate` (:32011-32050) opens `PickAThingPrompt` (:32030-32036) unless `#getPreselection` (:32155) finds the rule source's `selection`.
  - Ammunition `_preCreate` (:50674-50694) prompts for `baseItem` when `system.craftableAs` is set and `baseItem` is empty.
  - A feat's slot is `system.location` on the feat Item.
- docs/plan/done/31-adapter-interface.md: Task 31 constraints. The public pack API does not change, identity comes only from Foundry's server-set user, and every write goes through approval and audit.

## Acceptance
- [ ] The `compendium_import` input gains `actorUuid` (optional, ≤256) and `overrides` (optional strictObject: `quantity` int 1–9999, `equipped` boolean, `slot` string ≤100).
  - `folder` with `actorUuid` is INVALID_ARGS, and so is `overrides` without `actorUuid`.
  - The output gains `created` (string array, max 50, each ≤500) and keeps `uuid` as the primary created document.
  - protocol/test/tools/compendium-import.test.ts covers each bound.
  - `conservativeProblems` stays `[]` (protocol/test/tools/conservative-schema.test.ts).
- [ ] Without `actorUuid` the tool behaves exactly as before. module/test/tools/gm-documents/** passes unchanged.
- [ ] With `actorUuid`, the handler runs these checks before the native create:
  - the same pack and entry checks as a world import (compendium-import.ts:17-41)
  - the entry is an `Item`
  - the parent is a canonical world Actor that the server-set user may modify (`checkDocument`)

  It then builds the source with `fromCompendium(..., {keepId:false})` and runs `bounded()` and `checkCreate(ctx,'Item',data,actor)`, and awaits `ctx.intendCreate(actor)`.

  Unit tests cover four refused inputs: a non-owned Actor for a player-role user, a compendium Actor entry, a token Actor and an audit-flagged entry. Each returns FORBIDDEN or INVALID_ARGS with no native create call.
- [ ] Every document the native `createEmbeddedDocuments` returns is checked canonical under the Actor and recorded via `ctx.created(uuid, actor)`. That means the requested Item plus any pf2e grants.
  - A unit test with a stub returning three Items asserts three `created` calls and `created.length === 3`.
  - More than 50 returned documents makes the result text say the audit is incomplete (AUDIT_LIMITS.targets 50, module/src/audit/types.ts:78).
- [ ] A system embed hook from module/src/adapters/embed.ts translates `overrides`; the core does not.
  - The generic hook rejects any override with INVALID_ARGS `Override not supported for <system>`. With no overrides, it returns the source unchanged.
  - The pf2e hook maps:
    - `quantity` to `system.quantity` (physical items only)
    - `equipped` to the native carry type (physical items only)
    - `slot` to `system.location` (feats only), validated against the Actor's feat groups. An occupied or unknown slot is rejected.
  - Each rejection is unit-tested.
- [ ] Headless safety (pf2e): the hook refuses with INVALID_ARGS, naming the rule or field, in these cases. A unit test asserts `PickAThingPrompt` is never constructed for any fixture, refused or accepted.
  - The entry carries a `ChoiceSet` rule without `selection`. So does any GrantItem or class `system.items` grant it resolves, up to depth 2 and 32 documents; past that bound it refuses.
  - The entry is ammunition with `craftableAs` and no `baseItem`.

  Task 49 lifts the ChoiceSet refusal.
- [ ] pf2e's writes without callOptions (the `itemUpdates`, pf2e.mjs:45768) are not claimed as audited. The result text says they are uncorrelated and that task 44 owns that. A test asserts the text appears only when such updates happened.
- [ ] No new tool name, and the pack API is unchanged: `git diff origin/main -- protocol/src/tools/pack.ts module/src/packs` is empty.
- [ ] `e2e/pf2e-embed/embed.e2e.test.ts` targets `test-world` (Foundry v14, pf2e 8.6.0).
  - It runs when both `AGENT_GATEWAY_E2E_PF2E=1` and `AGENT_GATEWAY_E2E_PF2E_WRITE=1` are set. Otherwise each test stays registered and skips at run time.
  - It creates its own temporary GM-owned character.
  - It embeds a weapon with `quantity:2, equipped:true` and a feat with `slot`, then asserts both Items' state with `document_get`.
  - It asserts the audit page lists each created Item as `undoable:true`.
  - In `finally` it deletes the Actor by exact UUID.
  - It settles `pending_approval` as e2e/pf2e/pf2e.e2e.test.ts:15-55 does.
  - Native execution needs Andrew's per-run approval.
- [ ] `npm run verify` passes

## Out of scope
- Answering ChoiceSet or other system prompts (task 49)
- Attribute boosts, skill ranks and moving existing feats between slots (task 46)
- Correlating pf2e's uncorrelated native writes (task 44)
- Returning raw source JSON from compendium_get; changing document_create
- Extracting a shared e2e `settle` helper into e2e/lib/

## Attempt 1 — failed
Head `f031ced`. Tester PASS: `npm run verify` 2,227 slow on rerun, after one known-flaky protocol timing failure; e2e-unit 163; tsc and eslint clean. Reviewer REQUEST CHANGES; scope clean; the permission, audit and headless-scan core is confirmed. Three defects are pf2e mapping bugs that the unit fixtures copied, so build the fixtures from real pf2e 8.6.0 shapes (pf2e.mjs via `ssh andrew@homelab.local`).
- `module/src/adapters/pf2e/embed.ts:116`: `FeatGroup.isFeatValid` reads `e.category` from an Item instance (pf2e.mjs:34974-34976), but it is passed a raw source, so every slotted feat is refused. Pass an instance, for example a temp Item, or the equivalent. The stub at `module/test/adapters/pf2e/embed.test.ts:28` hid this.
- `embed.ts:100-104`: real worn usages have no hyphen (`wornarmor`, `worngloves`, `worncloak`…; getUsageDetails pf2e.mjs:34017+, armor :50938), so the `startsWith('worn-')` check never matches. Worn items are refused, and armor is never `inSlot:true`. The fixture at test :85 invents `worn-gloves`.
- `embed.ts:10-19`: `PHYSICAL` leaves out `ammo`, which pf2e.mjs:3173-3182 lists as physical, so a quantity override on arrows fails.
- `embed.ts:157-179`: the Actor monkeypatch leaks under overlapping calls. B wraps A's wrapper, A deletes the own property, B undercounts and then restores A's stale wrapper permanently. Replace it with a scoped `updateItem`/`deleteItem` hook counter that ignores events carrying `agentGateway.callId`, like the watcher at `module/src/audit/stage.ts:58-86`. No monkeypatching.
- Suggestions to apply:
  - Treat a ChoiceSet `selection` as present only when it is a string or number. pf2e still prompts on a non-matching value (pf2e.mjs:31902, :32155); state that a non-matching value is out of scope until task 49.
  - Scan kit `entry.items` nested contents in `grantUuids` (pf2e.mjs:52666-52671).

## Attempt 2 — failed
Head `7d2eb54`. Tester PASS: one `serialise-scaling` timing flake, then two clean `test:slow` reruns at 2,227; fast 3,679; e2e-unit 163. Reviewer REQUEST CHANGES; all four attempt-1 defects confirmed fixed; the feat-slot replica matches `FeatGroup#isFeatValid` (pf2e.mjs:34974, :52443); scope clean.
- `module/src/adapters/pf2e/embed.ts:102`, `:110-112`: shields have no persisted usage (Migration905UnpersistUsage, pf2e.mjs:11338-11346), and pf2e forces `held-in-one-hand` in prepareBaseData (:51334).
  - With `{equipped:true}` the shield is embedded unequipped while the tool reports success.
  - With `{equipped:false}` it is wrongly refused.
  - Fix: force `shield` to `held-in-one-hand`, alongside `armor` → `wornarmor`, and add a no-usage shield fixture.
- Apply in the result text:
  - The uncorrelated-write count may include concurrent writes to the same Actor.
  - pf2e `ItemPF2e._onCreate` (:45816-45822) may make an unawaited Actor update without callOptions, which is not counted (task 44).

## Attempt 3 — live e2e failed
Head `d11bbd9`, bundle `14860134…` deployed to homelab; Foundry 14.369, pf2e 8.6.0, `test-world`, approved by Andrew 2026-10-13. Both write tests failed. A read-only check afterwards found no leftover actors.
- **Real bug:** "embeds a weapon…" returned `INVALID_ARGS: Use the explicit folder argument`. A pf2e compendium source from `toObject()` has the keys `_id, img, name, system, type, _stats, effects, folder, sort, ownership, flags` (probed live; Dagger has `folder: null`). The embed path passes `folder` (and `sort`) through to the create-data check, which rejects it. Strip compendium-only root keys (`folder`, `sort`, plus any other key the existing `checkCreate`/`bounded` rejects for embedded Items) from the source before embedding. Add a unit test that uses a source carrying `folder: null` and `sort`.
- **Spec bug:** "embeds a feat into a free slot" returned `Unknown feat slot "ancestry-1"`. Probed live: a bare character's slotted groups (`ancestry`, `class`, `skill`, `general`) have **no** slots until it has an ancestry or class. Fix the spec: first give the temporary actor an ancestry, for example by embedding the compendium Human ancestry through this same tool if its rules are prompt-free, or by creating a minimal custom ancestry with `document_create` as `e2e/pf2e-build` does. Then pick an open `ancestry-*` slot that actually exists rather than hard-coding one.
