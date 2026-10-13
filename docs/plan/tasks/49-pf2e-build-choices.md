# 49 — Answer pf2e ChoiceSet build choices headlessly

**Repo:** .
**Depends on:** 45, 46
**Status:** Planned — do not start; queued after current workloads (32, 44)
**Design gate:** an architect pass is required before any implementation. See "Design gate".
**Owns:**
- module/src/adapters/pf2e/choices.ts (new)
- module/src/adapters/pf2e/embed.ts (from 45)
- module/src/adapters/pf2e/build.ts (from 46)
- module/src/adapters/embed.ts (from 45; optional choice fields only)
- module/src/adapters/build.ts (from 46; optional choice fields only)
- protocol/src/tools/compendium-import.ts (add `choices` input and `choiceReport` output only)
- module/src/tools/compendium-import.ts
- protocol/src/tools/character-build.ts (add `list_choices` read support only)
- module/src/tools/character-build.ts
- protocol/test/tools/compendium-import.test.ts, protocol/test/tools/character-build.test.ts
- module/test/adapters/pf2e/choices.test.ts (new)
- e2e/pf2e-choices/** (new)
- e2e/vitest.e2e.config.ts (insert one `pf2e-choices/**/*.e2e.test.ts` line in the e2e-live include list only)

Overlap:
- Files under `module/src/adapters/pf2e/**` are also in task 44's glob, so 49 must not run while 44 is in flight.
- Some files come from 45 and 46, which forces 49 to follow both.

## Goal
Creating pf2e class, ancestry, heritage, background and feat items fires ChoiceSet rule elements. These open a `PickAThingPrompt` on the executing client. A headless agent cannot answer one, and the call hangs. Agents need three things:
- a way to list the choices an item will ask for, including nested grants
- a way to supply a bounded decision map at create time
- a guarantee that any choice they did not answer never prompts or blocks, and is reported instead

This lifts task 45's ChoiceSet refusal.

## Context
- pf2e 8.6.0 (homelab `/srv/data/foundry/data/Data/systems/pf2e/pf2e.mjs`, `ssh andrew@homelab.local`):
  - The `ChoiceSetRuleElement` class starts at :31898. Its `preCreate` is :32011-32050. It sets the default flag (:32028), inflates the choices, then calls `#getPreselection(choices) ?? await new PickAThingPrompt(...).resolveSelection()` (:32029-32036). A selection is written to `ruleSource.selection` and `flags.pf2e.rulesSelections[flag]` (:32038). With no selection the rule is ignored (:32047).
  - `#getPreselection` (:32155) reads only `this.selection`, which comes from the rule source. `flags.pf2e.rulesSelections` is not consulted for preselection.
  - `ItemPF2e.createDocuments` (:45697) adds nested grants via `createGrantedItems` (:45736; class at :52197, base at :45882). It runs each grant's rule `preCreate` (:45755). GrantItem children run through `#runGrantedItemPreCreates` (:44080-44089). Grants are fetched by UUID inside pf2e, so the caller cannot preselect them through source.
  - `ChoiceSet` is registered at :45323.
- In the 2026-10-13 test, the only approach that worked was temporarily wrapping `ChoiceSet.prototype.preCreate` on the GM client. The wrapper answered from a decision map and skipped unknown flags.
- module/src/adapters/pf2e/embed.ts (45) has the bounded grant resolver (depth 2, ≤32) to reuse for listing.
- docs/plan/tasks/44-native-write-audit-correlation.md "Design gate" is the scope, concurrency, identity and bounds checklist to mirror.

## Design gate
Before code, run `architect` and record its conclusion in the PR description. It must decide and justify these points:
- **Mechanism.** Compare these options and pick one:
  - (a) inject `selection` into the top-level rule sources, and reject nested choices
  - (b) a scoped wrap of `ChoiceSetRuleElement.prototype.preCreate`
  - (c) a scoped wrap of `PickAThingPrompt.prototype.resolveSelection`
  - (d) a mixed approach

  Any prototype change must be installed only for the duration of the native create, only on the calling client, and restored in `finally`, including on throw. It must not break a pf2e update that replaces the prototype method.
- **Concurrency.** The design must cover other users' creates, and the GM's own UI creates on the same client while the wrap is active. Those must still prompt normally. Only rules belonging to this call's item batch may be answered. Two overlapping agent calls must never answer each other's rules. When ownership is ambiguous, the rule is reported unanswered, never answered wrongly.
- **Unknown choices.** Decide whether the call refuses before creating, or creates with the rule ignored (the native `ruleSource.ignored = true` path, :32047) and reports it. Either way, no prompt is ever constructed.
- **Identity and bounds.** Decisions come only from validated arguments, and the execution user is the server-set user. The decision map has at most 64 entries. Choice listing is bounded and never loads more than 32 documents.

## Acceptance
- [ ] The PR description contains the architect's conclusion on the four design points.
- [ ] `character_build` gains read-only listing of an entry's choices:
  - The input is a compendium Item UUID; no actor change.
  - For the entry and its bounded grants, it lists `{flag, itemUuid, prompt, options:[{value,label}]}`, with at most 64 choices and 50 options each, labels ≤200.
  - An option set beyond the bound is marked truncated.
- [ ] `compendium_import` with `actorUuid` accepts `choices`, an array of at most 64 `{flag ≤64, itemUuid ≤500 optional, value ≤500}`. The output adds `choiceReport`, which says which choices were answered, unanswered or rejected.
  - A value not among the inflated options is rejected, and is never written as raw `selection`.
- [ ] Unit tests with a pf2e stub, each asserting `PickAThingPrompt` is never constructed during an agent call:
  - top-level answered
  - nested class-feature answered
  - nested GrantItem answered
  - unknown flag reported
  - invalid value rejected
- [ ] Unit test: a ChoiceSet `preCreate` that runs for a non-call item while the scope is open (another user's create, or the GM's UI) behaves natively. It is not answered from the map.
- [ ] Unit test: two overlapping calls with different maps each answer only their own items' rules.
- [ ] Unit test: the prototype method is identical (`===`) to the original after a call that succeeded and after one that threw.
- [ ] Every created document is still recorded via `ctx.created`, as in 45.
- [ ] `e2e/pf2e-choices/choices.e2e.test.ts` targets `test-world` (v14, pf2e 8.6.0).
  - It runs when `AGENT_GATEWAY_E2E_PF2E=1` and `AGENT_GATEWAY_E2E_PF2E_WRITE=1` are set. Otherwise every test is registered and skips.
  - On a temporary character it lists the choices for a class entry and embeds that class with a full decision map.
  - It asserts that no `PickAThingPrompt` rendered, using a `renderPickAThingPrompt` hook counter installed in the page.
  - It asserts that the selected flags are present.
  - It deletes the actor by exact UUID in `finally`.
  - Native execution needs Andrew's per-run approval.
- [ ] `npm run verify` passes

## Out of scope
- Non-ChoiceSet prompts: the ammunition `baseItem` picker stays refused, as in 45.
- Correlating pf2e `itemUpdates` (task 44)
- dnd5e advancement choices
- Changing `SystemAdapter` or the pack API
