# 47 — Add batch Scene, Wall and AmbientLight creation

**Repo:** .
**Depends on:** none
**Status:** Planned — do not start; queued after current workloads (32, 44)
**Owns:**
- protocol/src/tools/scene-build.ts (new)
- protocol/src/tools/index.ts (insertion only)
- protocol/test/tools/scene-build.test.ts (new)
- protocol/test/tools/rules/validate.test.ts (insert one `scene_build` example only; exhaustiveness guard)
- module/src/tools/scene-build.ts (new)
- module/src/tools/index.ts (insertion only)
- module/src/tools/_scene.ts (add exported helpers only; existing exports keep their behaviour)
- module/src/compat/index.ts (insertion only: v13/v14 scene-data mapping)
- module/test/tools/scene-build/** (new)
- e2e/scene-build/** (new)
- e2e/vitest.e2e.config.ts (insert one `scene-build/**/*.e2e.test.ts` line in the e2e-live include list only)

Overlap:
- Task 48 uses `_scene.ts` read-only. If it needs a new helper, it stops and reports instead of editing.
- Task 51 depends on this task and extends `scene-build.ts`.

## Goal
Give a GM one approved, audited call per batch to create scenes, walls or ambient lights. Each
call is bounded by config and count. Today `document_create` supports only Actor, Item,
JournalEntry, ActiveEffect and JournalEntryPage, and `scene_control` only activates, views or
changes darkness or level. In the 2026-10-13 test, scene setup needed `script_run`. These batch
primitives are phase A of the GM scene builder (tasks 50–56) and must be usable by a later pack
via task 50's helper.

## Context
- protocol/src/tools/document-create.ts:12 is the type enum with no Scene, Wall or AmbientLight.
- protocol/src/tools/scene-control.ts:13 has the actions.
- module/src/tools/_scene.ts:12-58 has `gm`, `canonical`, `check`, `resolve`, `collection` and `actionFields`.
- module/src/tools/_documents.ts:40-77 has `bounded`/`parseData`. Run `bounded` on every native create payload.
- module/src/tools/_write.ts:58-84 `defineWriteHandler`; :1-7 the intendCreate/created contract.
- module/src/audit/undo-classes.ts:5-33: Scene is an undoable root, and Wall and AmbientLight are undoable embedded classes.
- Audit target cap: AUDIT_LIMITS.targets = 50 (module/src/audit/types.ts:78). Beyond it, targets are silently dropped (module/src/audit/stage.ts:176-181). Batches must therefore stay under 50 targets. The architect's "about 200" cannot be one undo group without changing module/src/audit, which task 44 owns.
- protocol/test/tools/conservative-schema.test.ts: no unions, nesting ≤3 and strict objects.
- protocol/test/tools/tool-count.test.ts:6-7: MAX_GM_TOOLS is 36. There are 33 today, task 46 adds one and this task adds one.

## Acceptance
- [ ] A new tool `scene_build` (minRole `gm`, category `write`) takes `action` enum `create_scenes|create_walls|create_lights`.
  - `create_scenes`: `scenes`, max 10. Each has `name` ≤256, `width`/`height` int 100–16384, `gridSize` int 50–500, `gridType` enum `square|gridless|hex_odd_r|hex_even_r|hex_odd_q|hex_even_q`, `gridDistance` 0.1–1000, `gridUnits` ≤16, `backgroundColor` `#rrggbb`, `backgroundImage` ≤256, `darkness` 0–1, `tokenVision` boolean, `folder` id ≤256.
  - `create_walls`: `sceneUuid`, `walls`, max 48. Each has int `x1,y1,x2,y2` inside the scene rectangle and not zero-length, `kind` enum `wall|door|secret_door|window|invisible|ethereal|terrain`, and `door` enum `closed|open|locked`.
  - `create_lights`: `sceneUuid`, `lights`, max 48. Each has `x`,`y` inside the scene, `bright`/`dim` 0–1000 with `bright ≤ dim`, `color` `#rrggbb`, `alpha` 0–1, `angle` 0–360, `rotation` 0–360, `walls` boolean, `negative` boolean.

  Fields that do not belong to the action are INVALID_ARGS (`actionFields`). `conservativeProblems` is `[]`.
- [ ] The batch cap (48) is a named constant derived from `AUDIT_LIMITS.targets`. A unit test fails if the cap is ever ≥ `AUDIT_LIMITS.targets`.
- [ ] Each call is one `defineWriteHandler` invocation, which gives one approval and one audit entry. Native writes:
  - `Scene.createDocuments(datas, callOptions)` for scenes
  - `scene.createEmbeddedDocuments('Wall'|'AmbientLight', datas, callOptions)` for walls and lights

  Each payload passes `bounded()` first. `ctx.intendCreate(parent)` precedes the write, and every returned document is checked canonical and recorded via `ctx.created(uuid, parent)`. A result shorter than the request throws, and the result reports what was created.
- [ ] GM is checked natively: `gm(ctx)` plus `Scene.canUserCreate(user)` or `scene.canUserModify(user,'update')`. A player-role session is refused with FORBIDDEN and no native call. A unit test covers this, and so does an assertion that `toolsForRole(false)` excludes `scene_build`. That second assertion guards that player sessions never see `scene_build` in tools/list.
- [ ] `backgroundImage` is accepted only as a relative Foundry data path. That means no scheme, no leading `/`, no `..`, no `\`, and an extension in `png|jpg|jpeg|webp|webm|mp4`. The path is mapped through a compat helper to the v13 `background.src` or the v14 level background. Unit fixtures cover both generations.
- [ ] Undo restores a whole batch. In module/test/tools/scene-build/, unit tests run the audit stage and `undoEntry` (module/src/audit/undo.ts:184) on one `create_walls` batch of 48 and one `create_lights` batch. Undo deletes every created Wall and Light, and none is left. A `create_scenes` batch of 3 is undone to zero scenes.
- [ ] Untrusted text (`name`) is stored as data and shown escaped in the approval dialog; a unit test uses `<img onerror>`.
- [ ] `e2e/scene-build/scene-build.e2e.test.ts` runs when `AGENT_GATEWAY_E2E_GM_BUILD=1` is set. Otherwise every test is registered and skips.
  - It runs on `test-world` v14 and also on v13 when `AGENT_GATEWAY_E2E_V13_URL` is set.
  - It creates one scene, 10 walls including one door, and 3 lights.
  - It asserts each count by `document_get`.
  - It undoes the walls batch through the audit UI path from docs/testing.md and asserts zero walls.
  - It deletes the scene by exact UUID in `finally`.
  - Native execution needs Andrew's per-run approval.
- [ ] `npm run verify` passes

## Out of scope
- Region creation (task 51)
- Tokens (token_manage exists); combats (task 48)
- Uploading images (tasks 52–53)
- Raising AUDIT_LIMITS or editing module/src/audit/** (task 44 owns it)
- Wall editing or deletion; updating existing scenes beyond `scene_control`
