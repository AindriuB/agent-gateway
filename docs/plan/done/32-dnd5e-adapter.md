# 32 — Add the dnd5e system adapter

**Repo:** .
**Depends on:** 31, 45, 46
**Status:** Complete. Offline gate green at `421724c` (3,851 fast / 2,227 slow); native v14 `dnd5e` 7/7 on `dnd5e-test` (Foundry 14.369 / dnd5e 6.0.6). PR number is added on merge. v13 not run. Follow-ups: dnd5e headless advancements (planned like 49, with a spike), gateway EADDRINUSE message.
**Owns:**
- module/src/adapters/dnd5e/**
- module/test/adapters/dnd5e/**
- module/src/adapters/index.ts (registry insertion only)
- e2e/dnd5e/**
- module/src/adapters/embed.ts and module/src/adapters/build.ts (registry insertion only, one line each) (Andrew, 2026-10-13)
- e2e/vitest.e2e.config.ts (three include lines: `dnd5e/**/*.e2e.test.ts` for the live suite, plus `run.test.ts` and `dnd5e/**/*.test.ts` for unit tests) (Andrew, 2026-10-13)
- the compendium-import note seam (new `EmbedHook.note`; Andrew, 2026-10-13)
- five 'dnd5e'→'starfinder' renames in existing tests that used dnd5e as the unsupported-system example (Andrew, 2026-10-13)
- e2e/run.ts and e2e/run.test.ts (fixture-preflight skip flag; Andrew, 2026-10-13)
- e2e/run.ts and e2e/run.test.ts (opt-in AGENT_GATEWAY_E2E_SKIP_FIXTURES; docs/testing.md needs a line, scribe) (Andrew, 2026-10-13)
- module/test/adapters/pf2e/{build,choices,embed}.test.ts, module/test/tools/character-build/dispatch.test.ts, module/test/tools/compendium-embed/embed.test.ts ('dnd5e' to 'starfinder' as the unregistered-system example only) (Andrew, 2026-10-13)
- module/src/adapters/embed.ts (EmbedHook `note` seam) and module/src/tools/compendium-import.ts (append the note to the result text) (Andrew, 2026-10-13)

## Goal
Implement the adapter for dnd5e: summaries, actions from items and activities,
performing them through the system's own API, inventory semantics and
conditions. Record any abstraction leak found as a note in the PR so 31's
interface can be adjusted.

## Context
- Depends on 45 and 46 (Andrew, 2026-10-13): dnd5e extends 45's embed hook (`module/src/adapters/embed.ts`) and 46's build interface (`module/src/adapters/build.ts`) for dnd5e, so those must be merged first. Dnd5e hook files fall under this task's existing `module/src/adapters/dnd5e/**` Owns.
- docs/plan/specs/2026-10-09-agent-gateway.md:159-161 — two adapters deliberately, to expose abstraction leaks
- module/src/adapters/types.ts, module/test/adapters/contract.ts (31)
- This adapter is internal to the core, not a tool pack (see 31); it adds no tool names and nothing to the pack API

## Acceptance
- [ ] Passes `contract.ts` with dnd5e fixtures
- [ ] `actorSummary` includes HP, AC, level/CR, ability mods, speed; `listActions` covers weapon attacks, spells by level with slots, features with uses; `performAction` uses the system's item/activity use API (no hand-rolled dice)
- [ ] `conditions` reads and toggles status effects via `actor.toggleStatusEffect`
- [ ] Supported dnd5e version range declared in `module.json` `relationships.systems` is noted in the PR (module.json edit belongs to 41) 
- [ ] An e2e spec under `e2e/dnd5e/` runs against a dnd5e test world when `AGENT_GATEWAY_E2E_DND5E_WORLD` is set, otherwise skips with a message
- [ ] `npm run verify` passes

## Out of scope
- pf2e (33); interface changes beyond what the leak note proposes (follow-up task)

## Attempt 1 — review requested changes (fixed)
First review found four defects, all fixed: summon and transform prompts, roll cross-capture between concurrent rolls, and an undisclosed concentration end. Re-review approved.

## Attempt 2 — live harness issues (fixed)
The live run exposed three harness problems, fixed on the branch: the fixture preflight could not be skipped for a suite that creates its own data (`AGENT_GATEWAY_E2E_SKIP_FIXTURES`), the GM session was not closed before the player opened, and RATE_LIMITED cleanup left `Actor.LqbpoP4w1FhY6aSh` behind. The actor was later deleted through the gateway and verified gone. Writes are now paced to 9 per minute with RATE_LIMITED retried, including the cleanup delete.

## Attempt 3 — passed
Head `421724c`: `npm run verify` green (3,851 fast / 2,227 slow); live `dnd5e` 7/7 on `dnd5e-test` (the run at `9a915d1` passed 7/7 but failed cleanup on the rate limit). v13 not run.

Behaviour and limits:
- Actions are `use:`, `attack:` and `damage:<itemId>:<activityId>` via Activity#use (subsequentActions:false, measuredTemplate:false, summons:false) and rollAttack/rollDamage with configure:false. Messages are captured by a one-shot preRollV2 listener, with rolls serialised per Actor. Conditions use toggleStatusEffect; leveled conditions apply by level delta.
- Refused activity types: cast, order, unknown types, transform outside form modes, nested forward. An activity that would end concentration on a different spell is refused by name; a same-spell recast is snapshotted and disclosed.
- Embed hook: dnd5e item creation opens no dialog. Advancements are not applied; `compendium_import` appends a fixed bounded note saying so.
- Build hook: `skill_rank` only (0/1/2). `attribute_boost`, `key_attribute` and `feat_slot` are refused with a reason. `listChoices` reports the count of unapplied advancements.
- Supported range for module.json (task 41): dnd5e minimum 6.0, verified 6.0.6; Foundry 14.367+.
- Abstraction leaks for task 31's interface: the build interface is pf2e-shaped (no ability or HP setters, no 0.5 rank); conditions are level deltas; `invested` maps attunement; one activity yields several action ids; the spell level option is a loose key; the Activity#use and toggleStatusEffect writes take no callOptions, so their targets are snapshotted and disclosed.
- External review: upcast damage lost its scaling (Fireball at level 4 rolled 8d6). Fixed in 43ab41f and 68fd34a: `damage:` accepts a validated `options.level` and rolls through dnd5e's own scaling; tested with stand-ins only, not live. `npm run verify` green at 68fd34a (3,857 fast / 2,227 slow).
- Second external review: concentration race (the check ran before the awaited audit declarations, so a concentration change in between let Activity#use end a newly active effect undisclosed). Fixed in c2d3916: rechecked after every await with no await before `use`, native `concentration.end` bound to the validated effect id or `false`, call refused if the decision changed; item and activity freshness, refusal rules and canUse also rechecked. Reviewed: approve. `npm run verify` green at c2d3916 (3,860 fast / 2,227 slow).
