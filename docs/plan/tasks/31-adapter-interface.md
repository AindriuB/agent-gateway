# 31 — Add the system adapter interface and adapter tools

**Repo:** .
**Depends on:** 21
**Owns:**
- module/src/adapters/index.ts
- module/src/adapters/types.ts
- module/src/adapters/generic/**
- module/test/adapters/generic/**
- module/test/adapters/contract.ts
- protocol/src/tools/actor-summary.ts
- protocol/src/tools/actions-list.ts
- protocol/src/tools/action-perform.ts
- protocol/src/tools/inventory.ts
- protocol/src/tools/conditions.ts
- protocol/src/tools/index.ts (insertions only)
- module/src/tools/actor-summary.ts
- module/src/tools/actions-list.ts
- module/src/tools/action-perform.ts
- module/src/tools/inventory.ts
- module/src/tools/conditions.ts
- module/src/tools/index.ts (insertions only)

## Goal
Define the system adapter interface and the five adapter tools that call it,
with a generic fallback adapter for unsupported systems and a shared contract
test suite every concrete adapter must pass.

## Context
- docs/plan/specs/2026-10-09-agent-gateway.md:159-161 — adapter interface: actorSummary, listActions, performAction, inventorySemantics, conditions
- docs/plan/specs/2026-10-09-agent-gateway.md:143-150 — adapter tools are available to all roles
- module/src/tools/_write.ts (21)

## Acceptance
- [ ] `types.ts` declares `SystemAdapter {systemId, actorSummary(actor), listActions(actor), performAction(actor, actionId, options), inventorySemantics(actor), conditions(actor, change?)}` with result types that stay within conservative schema rules
- [ ] `index.ts` selects the adapter by `game.system.id` from a registry; unknown systems get the generic adapter (summary from name/img/type, empty actions, `action_perform` returns `INVALID_ARGS` "not supported for <system>")
- [ ] Tools: `actor_summary` (read), `actions_list` (read), `action_perform` (write), `inventory` (read), `conditions` (read when no change requested; change escalates to write via `ctx.escalate`); all player role; actor must be owned (or GM)
- [ ] `contract.ts` exports a test suite taking an adapter and fixtures; the generic adapter passes it
- [ ] Guards pass, including tool-count
- [ ] `npm run verify` passes

## Out of scope
- dnd5e (32) and pf2e (33) implementations
