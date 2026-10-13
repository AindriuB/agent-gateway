# 48 — Add batch combat creation to combat_manage

**Repo:** .
**Depends on:** 44 (it owns module/src/audit/**; this task inserts into one file there)
**Status:** Planned — do not start; queued after current workloads (32, 44)
**Owns:**
- protocol/src/tools/combat-manage.ts
- protocol/test/tools/combat-manage.test.ts (new)
- module/src/tools/combat-manage.ts
- module/test/tools/combat-create/** (new)
- e2e/combat-create/** (new)
- e2e/vitest.e2e.config.ts (insert one `combat-create/**/*.e2e.test.ts` line in the e2e-live include list only)
- module/src/audit/undo-classes.ts (insert `Combat` as an undo root and `Combatant` as embedded, only; Andrew decided 2026-10-13)
- module/test/audit/undo-combat.test.ts (new)

Overlap: none with 45–47. `module/src/audit/undo-classes.ts` is under task 44's `module/src/audit/**` and task 51 also inserts into it, so run this after 44 merges and before 51. This task uses `module/src/tools/_scene.ts` read-only. If a new helper
is needed, stop and report, because 47 owns that file.

## Goal
Let a GM create encounters, each optionally seeded with tokens, in one approved and audited
call. Today `combat_manage` requires an existing `combatUuid` and nothing creates one, so
the 2026-10-13 test needed `script_run` to start an encounter. This is part of phase A of the
GM scene builder.

## Context
- protocol/src/tools/combat-manage.ts:11-36: `combatUuid` is required, and the action enum has no `create`.
- module/src/tools/combat-manage.ts:
  - :23 `actionFields` requires `combatUuid`.
  - :81-113 is the `add_combatants` create path to reuse for initial tokens: intendCreate on the combat, then createEmbeddedDocuments with callOptions, then `created` per Combatant.
- module/src/ops/context.ts:16-21 has the destructive classification, which `create` must not change.
- module/src/audit/undo-classes.ts:5-33 lists neither Combat nor Combatant as undoable. module/src/audit/stage.ts:182-188 marks such targets `this document class is not undone`.
- AUDIT_LIMITS.targets is 50 (module/src/audit/types.ts:78).
- PF2e initiative is refused by design (combat-manage.ts:136-139). Creation must not roll initiative.

## Acceptance
- [ ] The action enum gains `create`. `combatUuid` becomes optional, and every other action still requires it (`actionFields`, unit-tested per action).
  - `create` takes `encounters`, an array of at most 10 strictObjects. Each has `sceneUuid` and optional `tokenUuids`, at most 20 unique UUIDs.
  - The total of encounters plus tokens is at most 48, a named constant below `AUDIT_LIMITS.targets`.
  - The output adds `created`, an array of at most 48 UUIDs. `conservativeProblems` is `[]`.
- [ ] The existing actions' behaviour and tests are unchanged. module/test/tools/player-tokens-combat/** and gm-scene/** pass without edits.
- [ ] `create` is one `defineWriteHandler` call: one approval and one audit entry. The handler does these steps in order:
  1. Checks each scene with `check(ctx, scene, 'Scene')`, `gm(ctx)` and native `Combat.canUserCreate(user)`.
  2. Checks that each token is canonical, belongs to that scene, and appears at most once across all encounters.
  3. Awaits `ctx.intendCreate()`.
  4. Calls `Combat.createDocuments([{scene: id}], callOptions)`.
  5. Adds combatants with the add_combatants path.

  Every Combat and Combatant is recorded via `ctx.created`. Any partial native result throws and reports what was created.
- [ ] Other combats that native creation deactivates or updates are snapshotted before the write, or their updates carry callOptions. A unit test asserts which, from a stub that marks a prior active combat.
- [ ] Combat (root) and Combatant (embedded) are added to `module/src/audit/undo-classes.ts` (Andrew, 2026-10-13). The audit entry lists every created Combat and Combatant as undoable created targets. Undoing the entry deletes the created combats, with their combatants going alongside, and leaves pre-existing combats untouched.
  - A unit test proves this.
  - A unit test also proves an `add_combatants` entry on an existing combat undoes only the added combatants.
  - Native acceptance runs one audit-UI Undo of a created encounter on v14, and on v13 when configured.
- [ ] A player-role session gets FORBIDDEN, and `toolsForRole(false)` excludes `combat_manage`. Unit-tested.
- [ ] `e2e/combat-create/combat-create.e2e.test.ts` runs when `AGENT_GATEWAY_E2E_GM_BUILD=1` is set. Otherwise every test is registered and skips.
  - It runs on `test-world` v14, and on v13 when `AGENT_GATEWAY_E2E_V13_URL` is set.
  - On the active scene it places two temporary tokens via `token_manage` and creates one encounter with both.
  - It asserts the result through `combat_status`.
  - In `finally`, it ends the encounter (`combat_manage end`) and removes both tokens by exact UUID.
  - Native execution needs Andrew's per-run approval.
- [ ] `npm run verify` passes

## Out of scope
- Other changes under module/src/audit/** (task 44)
- Rolling initiative on create; pf2e initiative automation
- Creating tokens (token_manage) or scenes (task 47)
