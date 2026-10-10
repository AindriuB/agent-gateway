# 22 — Add token_move, target_set, combat_status and combat_end_turn

**Repo:** .
**Depends on:** 21, 20d, 20e
**Owns:**
- protocol/src/tools/token-move.ts
- protocol/src/tools/target-set.ts
- protocol/src/tools/combat-status.ts
- protocol/src/tools/combat-end-turn.ts
- protocol/src/tools/index.ts (insertions only)
- module/src/tools/token-move.ts
- module/src/tools/target-set.ts
- module/src/tools/combat-status.ts
- module/src/tools/combat-end-turn.ts
- module/src/tools/index.ts (insertions only)
- module/test/tools/player-tokens-combat/**
- module/test/stubs/** (insertions only)

## Goal
Let a player's agent act on the board within normal Foundry permissions: move
owned tokens, set targets, read combat state and end its own turn.

## Context
- docs/plan/specs/2026-10-09-agent-gateway.md:143-150 — tool list
- module/src/tools/_write.ts (21); module/src/compat/** for any v13/v14 token movement API difference (04)

- These are core tools: add them to `protocol/src/tools/index.ts` `TOOLS` and `module/src/tools/index.ts` `HANDLERS` as before; `module/src/ops/core-tools.ts` (20c) registers them through the same registry path as pack tools, and `checkToolDefinition(…, 'core')` (20b) must pass for each (the 20b test sweeps `TOOLS`)
## Acceptance
- [ ] `token_move` (player, write): args `tokenUuid`, `x`, `y` in grid units or `path` of up to 20 points; user must own the token; uses the compat layer for movement API differences between v13 and v14 (both covered by tests)
- [ ] `target_set` (player, write): args `tokenUuids` (max 10), `mode` replace|add|clear; affects only the calling user's targets
- [ ] `combat_status` (player, read): round, turn, combatants (name, initiative, defeated, hidden ones excluded for non-GM), whose turn it is
- [ ] `combat_end_turn` (player, write): only when the current combatant is owned by the user, else `FORBIDDEN`
- [ ] Guards pass; manual check on foundry.local v14 in a pf2e combat; v13 pending if absent

## Out of scope
- GM combat and token management (24)
- Adapter actions (31)
