# 31 — Add the system adapter interface and adapter tools

**Repo:** .
**Depends on:** 21, 20d, 20e
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
- These are core tools: add them to `protocol/src/tools/index.ts` `TOOLS` and `module/src/tools/index.ts` `HANDLERS` as before; `module/src/ops/core-tools.ts` (20c) registers them through the same registry path as pack tools, and `checkToolDefinition(…, 'core')` (20b) must pass for each (the 20b test sweeps `TOOLS`)
- Adapters are **not** tool packs (decided 2026-10-10): an adapter implements a fixed interface behind fixed core tool names, so the AI sees the same five tools on every system. Making each adapter a pack would namespace them per system (`dnd5e-actor_summary`), hide the abstraction the two v1 adapters exist to test, and add an install step to the five-minute setup. Adapters stay internal in v1 and are not reachable through `game.modules.get('agent-gateway').api`

## Acceptance
- [ ] `types.ts` declares `SystemAdapter {systemId, actorSummary(actor), listActions(actor), performAction(actor, actionId, options), inventorySemantics(actor), conditions(actor, change?)}` with result types that stay within conservative schema rules
- [ ] `index.ts` selects the adapter by `game.system.id` from a registry; unknown systems get the generic adapter (summary from name/img/type, empty actions, `action_perform` returns `INVALID_ARGS` "not supported for <system>")
- [ ] Tools: `actor_summary` (read), `actions_list` (read), `action_perform` (write), `inventory` (read), `conditions` (read when no change requested; change escalates to write via `ctx.escalate`); all player role; actor must be owned (or GM)
- [ ] `contract.ts` exports a test suite taking an adapter and fixtures; the generic adapter passes it
- [ ] Guards pass, including tool-count
- [ ] `Object.keys(game.modules.get('agent-gateway').api)` is unchanged by this task (test), so no adapter surface leaks into the pack API
- [ ] `npm run verify` passes

## Out of scope
- dnd5e (32) and pf2e (33) implementations
- A public `registerAdapter` for third-party systems (open question for Andrew; v1.x "more system adapters")
