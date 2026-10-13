# 55 — gm-builder pack: grid-snapped wall planning with mandatory preview

**Repo:** .
**Status:** Planned — do not start; queued after current workloads (32, 44, and the five gap tasks)
**Depends on:** 54
**Owns:**
- packs/gm-builder/src/planning/** (new)
- packs/gm-builder/ registration file named by 54 (insert the planning tools only)
- module/test/packs/gm-builder/planning/** (new)
- e2e/packs/gm-builder/planning.e2e.test.ts (new)

## Goal
For a plain map image with no UVTT data, let an agent propose walls in grid units. The
pack snaps the proposal to the scene grid and shows a preview the GM must see before
anything is written. It then commits one bounded batch per approval. The agent does the
looking; the pack only validates, snaps, previews and writes.

## Context
- Task 54's pack scaffold, and its batch commit through task 50's `writeHandler`.
- Task 47's wall field bounds and scene-rectangle checks.
- module/src/apps/approval/ is the existing approval dialog. The preview must be visible before approval, not after the write.

## Spike (verify before code; record in PR)
- [ ] Whether the approval dialog can show a pack-supplied preview (an overlay drawn on the canvas, or a static summary), or whether the preview needs a separate pack UI. No core approval change without a new task.
- [ ] Snap accuracy on square and hex grids on v13 and v14, and whether snapped walls give sound vision on a sample map.

## Acceptance
- [ ] `<prefix>_plan_walls` (GM, read) takes `sceneUuid` and at most 500 segments in grid units. It returns snapped pixel segments, dropped duplicates, zero-length removals and a `planId`. A plan is held for at most 30 minutes, at most 5 per user, in memory only.
- [ ] `<prefix>_commit_walls` (GM, write) takes `planId` and a batch index. It refuses with INVALID_ARGS if that plan's preview was never shown to the GM. Each batch is at most the task 50 `maxTargets`, with one approval and one undo group. A unit test covers a commit without preview, an expired plan, another user's plan, and a batch undo.
- [ ] Snapping is pure and deterministic, with golden tests for square and hex grids. Segments outside the scene rectangle are rejected.
- [ ] Player-role sessions never see either tool in tools/list (unit test and e2e roles check).
- [ ] Native acceptance on v14 and v13 (`AGENT_GATEWAY_E2E_GM_BUILDER=1`): plan, preview, commit two batches, undo one, then delete the scene by exact UUID. Native execution needs Andrew's per-run approval.
- [ ] `npm run verify` passes

## Out of scope
- Computer-vision wall detection inside the module
- Core approval dialog changes
- UVTT import (54)
