# 33 — Add the pf2e system adapter

**Repo:** .
**Depends on:** 31
**Status:** Next system adapter by Andrew's priority change, after accepted Task31 bounded native validation is published/merged. Implementation has not started; no Task33 native fixtures or writes are authorized.
**Owns:**
- module/src/adapters/pf2e/**
- module/test/adapters/pf2e/**
- module/src/adapters/index.ts (registry insertion only)
- e2e/pf2e/**

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
