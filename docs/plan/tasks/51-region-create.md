# 51 — Add batch Region creation without code-executing behaviours

**Repo:** .
**Status:** Planned — do not start; queued after current workloads (32, 44, and the five gap tasks)
**Depends on:** 47, 48, 50, 44
**Owns:**
- protocol/src/tools/scene-build.ts (add the `create_regions` action and fields only)
- protocol/test/tools/scene-build.test.ts
- module/src/tools/scene-build.ts
- module/test/tools/scene-build/regions/** (new)
- module/src/audit/undo-classes.ts (insert `Region` and `RegionBehavior` into `UNDO_EMBEDDED` only, after the spike)
- module/test/audit/undo-regions.test.ts (new)
- e2e/scene-build/regions.e2e.test.ts (new)

Overlap:
- `module/src/audit/undo-classes.ts` is under task 44's `module/src/audit/**`. 51 is queued after 44 (dependency edge).
- The scene-build files come from 47, which is a dependency edge.

## Goal
Let a GM create scene Regions with their behaviours in one bounded, approved and audited batch
that undoes as one group. Region behaviours that run code are refused here. They stay behind the
full-source approval of `script_run` and `macro_run`.

This is an action on `scene_build`, not a new tool, because the GM tool ceiling
(protocol/test/tools/tool-count.test.ts:7, MAX_GM_TOOLS 36) leaves no room.

## Context
- module/src/audit/undo-classes.ts:18-33: Region and RegionBehavior are absent today.
- module/src/audit/undo-restoration.ts handles recreating deleted subtrees. Undo of a created batch deletes it.
- docs/plan/done/26-code-tools.md covers the `code` category and full-source approval for script_run and macro_run.
- task 47's batch cap constant and `create_walls` pattern.

## Spike (assumptions to verify live before code; record results in the PR)
- [ ] The Region and RegionBehavior type lists on v13.351 and v14.369 (`CONFIG.RegionBehavior.dataModels` keys). Do not take any list from memory.
- [ ] Which behaviour types execute code or reference macros on each version (expected `executeScript` and `executeMacro`), and whether any other type takes a Macro UUID or a script field.
- [ ] Whether undo can delete a created Region with its behaviours, and recreate a deleted one, on v13 and v14. If recreation needs code beyond the insertion in undo-classes.ts, stop and report.
- [ ] Region shape data per version (v14 levels; v13 `shapes`) and the bounds that apply.

## Acceptance
- [ ] `scene_build` gains `create_regions`, which takes `sceneUuid` and `regions`. The batch is at most the task 47 cap, counting regions plus behaviours.
  - Each region has a `name` ≤256, a `color` `#rrggbb`, and 1–8 `shapes`. Each shape is a rectangle, ellipse or polygon with at most 64 integer points inside the scene.
  - Each region has 0–8 `behaviors`, each `{type, system}`. `type` is from the spike's allowlist; `system` is a JSON string of at most 8 KiB that passes `parseData`.
  - `conservativeProblems` is `[]`.
- [ ] These behaviours are refused with FORBIDDEN, with no native call:
  - `executeScript`, `executeMacro`, and any type the spike found to run code
  - any behaviour whose system data contains a string matching a Macro UUID (`Macro.` or `Compendium.*.Macro.`) at any depth

  A unit test covers each refusal.
- [ ] One call means one approval and one audit entry. Each Region is created with `callOptions`, and each Region and RegionBehavior is recorded via `ctx.created`. A unit test undoes a batch of 3 regions with 2 behaviours each to zero regions.
- [ ] `Region` and `RegionBehavior` are added to `UNDO_EMBEDDED` only if the spike shows both v13 and v14 restore them. module/test/audit/undo-regions.test.ts covers create-undo and delete-undo.
- [ ] A player-role session gets FORBIDDEN, and `toolsForRole(false)` still excludes `scene_build`.
- [ ] `e2e/scene-build/regions.e2e.test.ts` (`AGENT_GATEWAY_E2E_GM_BUILD=1`) runs on v14 and on v13. It creates a region with a non-code behaviour and undoes it to zero. It also checks that an `executeScript` request is refused. Native execution needs Andrew's per-run approval.
- [ ] `npm run verify` passes

## Out of scope
- Code-executing behaviours; editing or deleting existing regions
- Pack-side region tools (54–56)
