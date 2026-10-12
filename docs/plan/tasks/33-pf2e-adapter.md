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
