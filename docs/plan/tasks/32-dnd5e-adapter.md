# 32 — Add the dnd5e system adapter

**Repo:** .
**Depends on:** 31
**Status:** Planned; deferred by Andrew's priority change. Validate Task31 first, then implement Task33 before this task. Not complete.
**Owns:**
- module/src/adapters/dnd5e/**
- module/test/adapters/dnd5e/**
- module/src/adapters/index.ts (registry insertion only)
- e2e/dnd5e/**

## Goal
Implement the adapter for dnd5e: summaries, actions from items and activities,
performing them through the system's own API, inventory semantics and
conditions. Record any abstraction leak found as a note in the PR so 31's
interface can be adjusted.

## Context
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
