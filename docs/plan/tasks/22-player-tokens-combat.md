# 22 — Add token_move, target_set, combat_status and combat_end_turn

**Repo:** .
**Depends on:** 21, 20d, 20e
**Owns:**
- protocol/src/tools/token-move.ts
- protocol/src/tools/target-set.ts
- protocol/src/tools/combat-status.ts
- protocol/src/tools/combat-end-turn.ts
- protocol/src/tools/index.ts (insertions only)
- protocol/test/tools/rules/validate.test.ts (insertions for the four task22 canonical example arguments only)
- module/src/tools/token-move.ts
- module/src/tools/target-set.ts
- module/src/tools/combat-status.ts
- module/src/tools/combat-end-turn.ts
- module/src/tools/index.ts (insertions only)
- module/src/compat/index.ts (narrow token movement and audited native combat advancement helpers only)
- module/test/compat/token-movement.test.ts (new)
- module/test/compat/combat-turn.test.ts (new)
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
- [ ] `combat_end_turn` (player, write): required args `combatUuid`, `currentCombatantUuid`, `round`, `turn` bind the requested turn directly from the visible combat_status fields. Only when this tuple still matches trusted current combat state and the current combatant is owned by the user, else `FORBIDDEN`
- [ ] Guards pass; manual check on foundry.local v14 in a pf2e combat; v13 pending if absent

## Native compatibility and security details
- Movement uses the canonical rendered Scene and TokenDocument, not an arbitrary document from a client payload. Coordinates are finite fractional multiples of `scene.grid.size` in the token x/y coordinate space, not hex row/column indices. Require a positive finite grid size and destination/actual native TokenDocument.getSize() footprint within the scene dimensions.sceneRect, including padding/shift and hex geometry. Accept either both x/y or a nonempty path of at most 20 bounded x/y points, never both; do not forward additional waypoint or movement-bypass options.
- Native v13/v14 TokenDocument.move accepts waypoints plus update options. The compat helper must preserve `ctx.callOptions`, normal movement constraints and the native completed/blocked result. Cover both native API shapes; a blocked or incomplete movement must not be reported as completed. Do not bypass walls, cost or system movement rules.
- Every write uses the existing fail-closed audited write helper. Resolve the current authenticated Foundry user, canonical document and OWNER permission after awaited snapshots/resolution and immediately before mutation. A token/actor permission change or changed current combatant while approval is pending must refuse the stale action. Use current Foundry permissions, never supplied owner IDs, requester role hints or local `isOwner` cached for a different user.
- Targeting uses the shared native canvas.tokens.setTargets API and only current game.user after verifying that identity matches the calling user. Resolve and validate all at-most-ten canonical rendered-scene targets before changing any targets; non-GMs may target only genuinely visible/renderable tokens. Map replace/add/clear to native replace/acquire/empty-replace. Target selection is transient state: retain its audit entry, but declare no fabricated document undo target or snapshot.
- Combat status selects current game.combat. Bound enumeration/output; exclude hidden combatants for every non-GM even if native `visible` would allow their owner. Do not leak their names, initiative, UUIDs or hidden current-combatant identity through summary fields; whose-turn identity is null/omitted when hidden. Native round/turn values may remain as combat metadata.
- Native v13/v14 Combat.nextTurn/nextRound do not accept update options, so simply passing callOptions loses audit correlation. Implement a narrow compatible advancement helper using the verified native algorithm and one normal Combat.update with callOptions: honor skipDefeated, next-turn scanning, wrap to the next round, native all-defeated behavior, getTimeDelta and combatTurn/combatRound hooks. Bound the scan and validate finite turn/round/time values; preserve native/system update lifecycle and permission checks. Do not monkeypatch methods, request GM impersonation or create a separate turn service. Recheck authenticated ownership and the required request tuple synchronously after hooks and immediately before update. Require a canonical successful update result and matching final round/turn; cancelled or non-persisted updates cannot report successful advancement. Combat is outside the existing audit undo/witness allowlist: retain its audit as a view-only unsupported-class target, without widening audit authority.
- The required combat_end_turn tuple is an expectation, never an authority source. Match it against canonical current documents and actual Foundry user ownership before snapshot and after all awaits/hooks. A real pending-approval regression must change to another still-owned combatant and prove refusal, including an identical combatant in a different round. Non-GMs cannot obtain or act on hidden current identities through these tools.
- Tests must exercise actual shared compat helpers on native-shaped v13/v14 cases, including options/audit forwarding, movement blocked/completed, skip-defeated, wrap/all-defeated, native hook/time behavior and stale permissions/turns. Add real dispatcher/audit tests for target isolation and non-GM hidden-current privacy. No new native world writes are authorized by this contract amendment; manual acceptance needs the existing explicit test-world approval workflow.

## Out of scope
- GM combat and token management (24)
- Adapter actions (31)
