# 49 — Answer pf2e ChoiceSet build choices headlessly

**Repo:** .
**Depends on:** 45, 46
**Status:** Complete. Offline gate green at `7a77f08`; native v14 `pf2e-choices` 2/2 (Foundry 14.369 / pf2e 8.6.0). PR number is added when Andrew merges. v13 not run. Follow-ups: task 44 (uncorrelated follow-up item updates).
Design gate: CHANGES applied 2026-10-13; spike passed before implementation.
**Owns:**
- module/src/adapters/pf2e/choices.ts (new)
- module/src/adapters/pf2e/embed.ts (from 45)
- module/src/adapters/pf2e/build.ts (from 46)
- module/src/adapters/embed.ts (from 45; optional choice fields, extra native create options and per-call report only)
- module/src/adapters/build.ts (from 46; optional choice fields only)
- module/src/tools/_documents.ts (only if the 45 seam needs it; insertion-only helper, no edits to existing exports)
- protocol/src/tools/compendium-import.ts (add `choices`, `onUnanswered` input and `choiceReport` output only)
- module/src/tools/compendium-import.ts
- protocol/src/tools/character-build.ts (add `list_choices` read support only)
- module/src/tools/character-build.ts
- protocol/test/tools/compendium-import.test.ts, protocol/test/tools/character-build.test.ts
- module/test/adapters/pf2e/choices.test.ts (new)
- module/test/adapters/pf2e/embed.test.ts
- e2e/pf2e-choices/** (new)
- e2e/vitest.e2e.config.ts (insert one `pf2e-choices/**/*.e2e.test.ts` line in the e2e-live include list only)
- module/src/adapters/pf2e/index.ts (only if unavoidable; see "Install point". If used, say why in the PR.)

Overlap:
- Files under `module/src/adapters/pf2e/**` are also in task 44's glob, so 49 must not run while 44 is in flight.
- Some files come from 45 and 46, which forces 49 to follow both.

## Goal
Creating pf2e class, ancestry, heritage, background and feat items fires ChoiceSet rule elements. These open a `PickAThingPrompt` on the executing client. A headless agent cannot answer one, and the call hangs. Agents need three things:
- a way to list the choices an item will ask for, including nested grants
- a way to supply a bounded decision map at create time
- a guarantee that any choice they did not answer never prompts or blocks, and is rejected or reported instead

This lifts task 45's ChoiceSet refusal.

## Context
- pf2e 8.6.0 (homelab `/srv/data/foundry/data/Data/systems/pf2e/pf2e.mjs`, `ssh andrew@homelab.local`):
  - `ChoiceSetRuleElement` starts at :31898; registered as `ChoiceSet` at :45323 (reachable as `game.pf2e.RuleElements.builtin.ChoiceSet`).
  - `preCreate` :32011-32050: sets the default flag (:32028), inflates choices, then `#getPreselection(choices) ?? await new PickAThingPrompt(...).resolveSelection()` (:32029-32036). A selection is written to `ruleSource.selection` and `flags.pf2e.rulesSelections[flag]` (:32038). No selection means `ruleSource.ignored = true` (:32047).
  - `#getPreselection` :32155 reads only `this.selection` from the rule source.
  - `ItemPF2e.createDocuments` :45697 passes `operation` into each rule's `preCreate` (:45755-45762). The actor clone used there keeps the real actor id (:45736-45745).
  - Grants: class `system.items` via `createGrantedItems` (:45736; class at :52197, base at :45882). GrantItem children run their `preCreate` via :44008 and `#runGrantedItemPreCreates` :44079-44089; `preselectChoices` is at :44049-44055.
  - pf2e follow-up `itemUpdates` (:45768) are not correlated to the call (task 44).
- 2026-10-13 manual test: wrapping `ChoiceSet.prototype.preCreate` on the GM client was the only approach that worked.
- module/src/tools/notify-receiver.ts:55 — precedent for a self-registering `Hooks.once('ready', ...)` outside an adapter index.
- module/src/adapters/pf2e/embed.ts (45) — bounded grant resolver (depth 2, ≤32) to reuse for listing.
- docs/plan/tasks/44-native-write-audit-correlation.md "Design gate" — the scope, concurrency, identity and bounds checklist this design mirrors.

## Design (architect gate, 2026-10-13: CHANGES, applied here)

### Mechanism: one permanent, call-keyed wrapper
- At module `ready`, when `game.system.id === 'pf2e'`, install one wrapper on `game.pf2e.RuleElements.builtin.ChoiceSet.prototype.preCreate`. It stays installed for the session; nothing is installed or restored per call.
- Install is idempotent. The class is re-resolved on every install attempt. A symbol marker on the installed function identifies the wrapper; the original is stored once and never re-wrapped. If the current method is neither the wrapper nor the stored original (a swapped method), install re-wraps the new method and stores it as the original.
- If install fails (class missing, method missing, non-function), the module records it and every agent call that would need a choice answered is refused with an error. It never falls back to prompting.
- A per-call registry (`Map<callId, {callId, actorId, decisions, report}>`) holds at most 8 live entries, each with a TTL. The entry is deleted in `finally`, including on throw and on timeout. A 9th concurrent call is refused before any write.
- The 45 embed hook passes `{agentGateway: {callId}}` in the native create options.
- The wrapper answers a rule only when all of these hold:
  - `args.operation?.agentGateway?.callId` is registered
  - the rule's actor id equals the entry's `actorId`
  - the rule's flag is in that entry's decisions (and, if the decision has `itemUuid`, it matches the rule's item source UUID)
  - the decided value is exactly equal to one of the inflated options

  It answers by setting `this.selection` so `#getPreselection` returns it, then calls the original. Otherwise it calls the original unchanged, which is native behaviour (including prompting for other users' and the GM's UI creates).
- Inside a registered call, a flag with no decision is never prompted: the wrapper sets `ruleSource.ignored = true`, skips the original's prompt path and records the flag in the report.

### Install point
Put the `Hooks.once('ready', ...)` in `module/src/adapters/pf2e/choices.ts`, registered on import (as `notify-receiver.ts:55`), and import it from `pf2e/embed.ts`. Touch `module/src/adapters/pf2e/index.ts` only if that import does not run before `ready`, and say so in the PR.

### Spike first (acceptance prerequisite)
Before implementation, prove on the live pf2e `test-world` that the custom option key `operation.agentGateway.callId` reaches `ChoiceSet.preCreate` for:
1. a top-level item
2. class `system.items` grants
3. GrantItem children

The spike's findings, layer by layer, go in the PR description. Any layer that drops the key fails closed: choices at that layer are rejected up front at preflight with `INVALID_ARGS`, never answered by name or by timing. The native spike run needs Andrew's per-run approval.

### Discovery
`character_build` gains read-only `list_choices`. Input is a compendium Item UUID; no actor change. It inflates choices on temporary items with no writes, using the 45 bounded grant resolver, loading at most 32 documents. Output per choice: `{flag, itemUuid, prompt, options: [{value, label}], truncated}`. At most 64 choices, at most 50 options each, labels ≤200 chars. An option set beyond the bound sets `truncated: true`.

### Decisions
- `compendium_import` with `actorUuid` accepts `choices`: at most 64 `{flag ≤64, itemUuid ≤500 optional, value ≤500}`.
- A flag that appears on two items in the batch, given without `itemUuid`, is rejected as ambiguous.
- Refused and reported as unsupported:
  - `query` choices
  - `ownedItems` choices with `allowedDrops` or drop-in values
  - values not exactly equal to an inflated option (never written as raw `selection`)
  - choices whose predicate fails
  - the ammunition `baseItem` picker (as in 45)
- Decisions come only from validated arguments. The execution user is the server-set user.

### Unanswered choices
- Default: preflight rejects with `INVALID_ARGS` naming the missing flags, before any `intendCreate` or write.
- Opt-in `onUnanswered: "reject" | "ignore"`, default `"reject"`. `"ignore"` creates the rules with `ignored = true`, lists them in `choiceReport` and marks the build incomplete in the output.
- `choiceReport` has at most 64 entries, each `answered | unanswered | rejected | unsupported` with the flag and item UUID.
- The runtime path stays fail-closed even when preflight and the actual create diverge: an unexpected flag at runtime is ignored and reported, never prompted.
- The output discloses that pf2e follow-up `itemUpdates` are not correlated to this call (task 44).

### Residual risk (recorded, accepted)
A GM macro or another module on the same client that reads or forges a live registered callId during the call could have its ChoiceSet rules answered. This is the same trust boundary as `script_run` (GM code on the GM client).

## Acceptance
- [ ] PR description contains the spike results for each of the three layers, and states which layers (if any) fail closed.
- [ ] `module/src/adapters/pf2e/choices.ts` installs exactly one wrapper on `ChoiceSet.prototype.preCreate` at `ready`, with a symbol marker and stored original. No code path installs or restores the method per call.
- [ ] The 45 embed seam accepts extra native create options and returns a per-call report; the pf2e embed passes `{agentGateway: {callId}}`.
- [ ] `character_build` `list_choices` returns `{flag, itemUuid, prompt, options, truncated}` within the bounds in "Discovery", loads ≤32 documents, and performs no writes (asserted in a unit test).
- [ ] `compendium_import` accepts `choices` and `onUnanswered` with the bounds above, and returns `choiceReport` (≤64 entries). Protocol tests cover the bounds, the ambiguous-flag rejection and the `onUnanswered` default.
- [ ] Missing decisions with the default `onUnanswered` return `INVALID_ARGS` naming the flags, and a unit test asserts no `intendCreate` and no create call happened.
- [ ] Unit tests with a pf2e stub, each asserting `PickAThingPrompt` is never constructed during an agent call: top-level answered; nested class-feature answered; nested GrantItem answered; unknown flag ignored and reported; invalid value rejected; each unsupported kind refused.
- [ ] Unit test: a rule `preCreate` with no callId behaves natively (original called with unchanged args).
- [ ] Unit test: a forged/unregistered callId, and a callId registered for a different actor, are not answered.
- [ ] Unit test: two overlapping calls on the same actor with different decisions each answer only their own rules.
- [ ] Unit test: a throw mid-create, and a timeout, leave the registry empty; a 9th concurrent call is refused before any write.
- [ ] Unit test: install twice leaves one wrapper; the stored original is the pre-install method; a swapped method is detected and wrapped.
- [ ] Unit test: if install failed, a call needing a choice is refused and no prompt is constructed.
- [ ] Every created document is still recorded via `ctx.created`, as in 45.
- [ ] `e2e/pf2e-choices/choices.e2e.test.ts` targets `test-world` (v14, pf2e 8.6.0):
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
- Answering `query` or drop-in `ownedItems` choices
- Any edit to tasks 45 or 46 beyond the options-and-report seam named in Owns

## Attempt 1 — three review rounds, defects fixed
Review found and the branch fixed: unbounded filter-choice inflation, a blank-actor preflight, timeout falling through to pf2e's native prompt, wrong flag naming, wrapper detection by function identity (now by marker), an invalid `itemType` bypassing the bounds, and a permission leak through decided UUIDs.

## Attempt 2 — live e2e failed 1 of 2 (fixed)
Head `5ae9f8b`, `pf2e-choices` failed 1/2: a `flags.system.` GrantItem placeholder (Tactical Expansion) was not resolved. Fixed at `7a77f08` by accepting the alias.

## Attempt 3 — passed
Head `7a77f08`: `npm run verify` green (3,815 fast / 2,227 slow); live `pf2e-choices` 2/2 on v14.369 / pf2e 8.6.0. Known limits: the GM sees pf2e's progress notification during filter queries; `list_choices` shows no options for feat/heritage filters (dynamic, enforced at create); follow-up item updates are not correlated (task 44).
