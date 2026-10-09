# 24 — Add GM tools token_manage, combat_manage and scene_control

**Repo:** .
**Depends on:** 23
**Owns:**
- protocol/src/tools/token-manage.ts
- protocol/src/tools/combat-manage.ts
- protocol/src/tools/scene-control.ts
- protocol/src/tools/index.ts (insertions only)
- module/src/tools/token-manage.ts
- module/src/tools/combat-manage.ts
- module/src/tools/scene-control.ts
- module/src/tools/index.ts (insertions only)
- module/src/ops/context.ts (add `escalate` only)
- module/test/tools/gm-scene/**
- module/test/stubs/** (insertions only)

## Goal
Let the GM's agent run the table's mechanics: place, hide and remove tokens,
manage the combat tracker and switch or adjust scenes, using v14 Scene Levels
only when the compat layer reports them.

## Context
- docs/plan/specs/2026-10-09-agent-gateway.md:151-153 — GM tools
- docs/plan/specs/2026-10-09-agent-gateway.md:68-71 — v14-only features only when present
- module/src/compat/** `hasSceneLevels()` (04)

## Acceptance
- [ ] `token_manage` (gm, write): action enum place|hide|show|remove; `remove` is escalated to the destructive category through a `ctx.escalate('destructive')` call added to the dispatcher context, so policy re-evaluates before running
- [ ] `combat_manage` (gm, write): action enum start|end|next_turn|previous_turn|next_round|add_combatants|remove_combatants|roll_initiative
- [ ] `scene_control` (gm, write): action enum activate|view|set_darkness|set_level; `set_level` returns `INVALID_ARGS` "requires Foundry v14 Scene Levels" when `hasSceneLevels()` is false (tested on both generations)
- [ ] Guards pass; manual check on foundry.local v14

## Out of scope
- Player token and combat tools (22)
- Tables, playlists, notify (25)
