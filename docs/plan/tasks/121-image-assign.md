# 121 — Add an image assign tool that browses and assigns existing images

**Repo:** .
**Status:** Ready to start once 52 and 120 are merged (owner decision, 2026-10-16)
**Depends on:** 52, 120
**Owns:**
- protocol/src/tools/image-assign.ts (new)
- protocol/src/tools/index.ts (insertion only)
- protocol/test/tools/image-assign.test.ts (new)
- protocol/test/tools/rules/validate.test.ts (insert one `image_assign` example only; exhaustiveness guard)
- module/src/tools/image-assign.ts (new)
- module/src/tools/index.ts (insertion only)
- module/test/tools/image-assign/** (new; includes the dispatcher-level test)
- module/src/ops/context.ts (insertion only: one core rule in `actionCategory` classifying `image_assign` with `action: 'set'` as `write`; added by Amendment 1)
- module/test/ops/context.test.ts (insertion only: the `image_assign` `actionCategory`/`prepareContext` cases; added by Amendment 1)
- module/test/stubs/** (insertion only)
- e2e/image-assign/** (new)
- e2e/vitest.e2e.config.ts (insert one `image-assign/**/*.e2e.test.ts` line in the e2e-live include list only)
- module/src/audit/undo-classes.ts (insertion only: one `'Level'` entry in `UNDO_EMBEDDED`, nothing in `UNDO_CLASSES`; added by Amendment 2)
- module/test/audit/undo-levels.test.ts (new; added by Amendment 2. No test file covers undo-classes.ts directly today; this follows the `undo-combat.test.ts` (48) and `undo-regions.test.ts` (51) naming)

Overlap: only the insertion-only shared files above, also inserted into by 53 and 123. No other
open task owns module/src/ops/context.ts or module/test/ops/context.test.ts; task 48 cites
context.ts:16-21 (the destructive classification) read-only, and that cite moves if this
task's insertion lands above it, so insert after the `character_build` rule (after line 21). Uses
protocol/src/images/** and module/src/tools/_image.ts (owned by 120) without editing them.

Overlap on module/src/audit/undo-classes.ts (Amendment 2): no task in 102-114 owns it or
module/test/audit/** (112 lists audit/undo as out of scope). Open, queued tasks that do:
44 owns all of module/src/audit/** and module/test/audit/**; 48 inserts `Combat` and
`Combatant`; 51 inserts `Region` and `RegionBehavior` into `UNDO_EMBEDDED`; 47 cites
undo-classes.ts:5-33 read-only. All four are queued ("do not start"), so none is in flight
today. If any starts before this task merges, this task is the one that waits or rebases. Append
`'Level'` as the last `UNDO_EMBEDDED` entry (after `'Card'`); 48 and 51 then rebase onto a
one-line insertion, and 47's cite becomes 5-34.

## Goal
Let an agent find an image that already exists in Foundry's `data` files and set it as an Actor
portrait, prototype token art, a placed token's texture, a scene background or a tile texture.
Finding is a bounded, read-only directory listing. Players act only on documents they own; a GM
may act on any.

## Context
- The task 52 findings file (spikes/image-upload/) gives the `browse` shape, `FILES_BROWSE` enforcement and the v13/v14 field paths for each target. It overrides the field paths below.
- module/src/tools/_image.ts and protocol/src/images/** (task 120): `browseImages`, `normalizeDataPath`, `isImagePath`.
- module/src/ops/context.ts:7-21 `actionCategory` — the canonical, trusted classification. Read-to-write escalation exists only for core `conditions` (with `change`) and `character_build` (with `changes`); `image_assign` must be added here (Amendment 1).
- module/src/ops/context.ts:38-67 `prepareContext` — calls `handler.prepare` (core only, lines 56-59), then at lines 61-62 throws unless the prepared category equals `actionCategory(...)`. A `prepare` without a matching `actionCategory` rule fails as INTERNAL.
- module/src/tools/conditions.ts:26-28 — the `handler.prepare` pattern for a read-base tool escalating to `write`. Do not use `withPreparation` (module/src/ops/context.ts:69-74): it only escalates write-base tools to `destructive`.
- module/src/ops/dispatch.ts:107 (`prepareContext` before any stage) and :132-136 (admission cannot change the prepared category).
- module/test/ops/context.test.ts:19-41 and module/test/tools/character-build/dispatch.test.ts:79-96 — the existing unit and dispatcher-level tests to mirror.
- module/src/tools/_write.ts and the 53 task file — snapshot, `callOptions` and Undo for document updates.
- protocol/test/tools/rules/validate.test.ts:134-176 — the per-tool example map.

## Acceptance
- [ ] A new tool `image_assign` (minRole `player`, category `read`, handledBy `module`) takes `action` enum `list|set`:
  - `list`: optional `dir` (omitted or `''` is the Data root, validated by `normalizeDataDir` from 120; `/` and `.` are rejected with `INVALID_ARGS`) and optional `limit` (1-200, default 100). It returns `{ dirs, files, truncated }` from `browseImages`.
  - `set`: `path`, `target` enum `actor_portrait|actor_token|token|scene_background|tile` and `uuid`.

  There is no URL argument and no `source` argument; the source is always `data`.
- [ ] (Amendment 1) `actionCategory` in module/src/ops/context.ts gains one core rule: `core && base === 'read' && tool === 'image_assign' && action === 'set'` returns `'write'`. module/test/ops/context.test.ts asserts `actionCategory('image_assign', {action:'set',...}, 'read')` is `'write'`, `{action:'list'}` is `'read'`, and with `core = false` `set` stays `'read'`; and that `prepareContext(ctx, 'read', false, imageAssignHandler)` throws for a pack.
- [ ] (Amendment 1, replaces the former `ctx.escalate('write')` line) The handler sets `imageAssignHandler.prepare` as in module/src/tools/conditions.ts:26-28, calling `ctx.escalate!('write')` only when `action === 'set'`. It does not use `withPreparation` (module/src/ops/context.ts:69-74). The escalation happens inside `prepareContext` (module/src/ops/dispatch.ts:107), before any stage or document access, and passes the check at module/src/ops/context.ts:61-62.
- [ ] (Amendment 1) A dispatcher-level test in module/test/tools/image-assign/ (pattern: module/test/tools/character-build/dispatch.test.ts:79-96) shows `set` reaching the policy, rate and approval stages as `write` and producing one audit record, and `list` reaching them as `read` only with no audit record and no approval request.
- [ ] `set` rejects with `INVALID_ARGS`, before any document update, a `path` that fails `normalizeDataPath` or `isImagePath`, a path not present in a `browse` of its parent directory (the parent is validated with `normalizeDataDir`, so a root-level file's parent is `''`, the Data root; Amendment 1), and a `uuid` whose document type does not match `target`. Unit tests cover `../x.png`, `x.svg`, a URL, a missing file, an Actor UUID sent with `target: tile`, and a successful `set` of a root-level image (`x.png`, parent `''`).
- [ ] Permissions, with identity only from the server-set Foundry user:
  - `list`, and `set` for a non-GM, require `FILES_BROWSE`; otherwise `FORBIDDEN`.
  - A player may use `actor_portrait` and `actor_token` only on an Actor they OWN, and `token` only on a token whose document they own.
  - `scene_background` and `tile` are GM only.

  Unit tests cover a player without `FILES_BROWSE`, a player on a non-owned Actor, a player on another user's token, and a player sending `scene_background` and `tile`.
- [ ] One `set` call is one approval and one audit entry, showing `path`, `target` and `uuid`. The update is snapshotted with `callOptions`, and Undo restores the previous value. A unit test covers Undo for each target.
- [ ] Native acceptance on v14 and v13 (`AGENT_GATEWAY_E2E_IMAGE=1`): a GM lists a directory and sets a temporary scene background and tile texture; a player sets the portrait and token art of an Actor they own; a player is refused on another user's Actor. Temporary documents are removed by exact UUID. Native execution needs the repository owner's per-run approval.
- [ ] (Amendment 2) `UNDO_EMBEDDED` in module/src/audit/undo-classes.ts contains `'Level'`; the diff to that file is that one inserted line and nothing else. `undoClasses('Scene.S.Level.L')` returns `{ root: 'Scene', own: 'Level' }`.
- [ ] (Amendment 2) module/test/audit/undo-levels.test.ts: a `scene_background` `set` on v14 (the background lives on `Scene.<id>.Level.<id>`, updated through `updateEmbeddedDocuments('Level', ...)`) produces an audit target for the Level that is undoable, with the prior value snapshotted; running Undo on that entry restores the Level's `background.src` to the value it had before the `set`.
- [ ] (Amendment 2) Every other class's undo behaviour is unchanged: the existing module/test/audit/** tests pass unmodified, and no file under module/test/audit/ other than the new undo-levels.test.ts appears in the diff.
- [ ] (Amendment 2) The native e2e in e2e/image-assign/** asserts, on v14, that Undo of the GM's `scene_background` `set` restores the Level's previous `background.src`. It is written in this task but still not run without the repository owner's per-run approval.
- [ ] `npm run verify` passes

## Out of scope
- Uploading files (53) and viewing images (123)
- Any source other than `data` (`public`, `s3`), including system and module icon paths
- Creating, moving or deleting files or directories
- Any other change to module/src/ops/context.ts (no edits to existing rules, `prepareContext`, `withPreparation` or `effectiveCategory`), or to module/src/ops/dispatch.ts
- Editing protocol/test/tools/tool-count.test.ts, protocol/src/images/** or module/src/tools/_image.ts (120; stop and report if a helper is missing)
- (Amendment 2) Any other change under module/src/audit/** or module/test/audit/** (44 owns them): no other class added to `UNDO_CLASSES` or `UNDO_EMBEDDED` (`Combat`/`Combatant` are 48's, `Region`/`RegionBehavior` are 51's), and no edits to undo.ts, undo-restoration.ts, stage.ts or witness.ts. If restoring a Level needs more than the one-line insertion, stop and report.

## Amendment 1 (owner, 2026-10-16, from external PR review)

Reason, finding 1: `set` could not escalate as written. The dispatcher allows read-to-write
escalation only in `handler.prepare`, and module/src/ops/context.ts:61-62 throws unless the
prepared category equals `actionCategory()`. `actionCategory` (module/src/ops/context.ts:7-21)
only knows `conditions` and `character_build`, so following the conditions pattern alone made
every `set` fail with INTERNAL. Change: Owns gains module/src/ops/context.ts and
module/test/ops/context.test.ts (insertion only), Acceptance gains the `actionCategory` rule, a
pack-cannot-escalate check and a dispatcher-level test, and the `ctx.escalate('write')` line is
rewritten to the real `handler.prepare` mechanism.

Reason, finding 2: browsing the Data root had no valid input (`normalizeDataPath` rejects `''`,
and Foundry names the root `''`). Task 120 Amendment 1 adds `normalizeDataDir`; `list`'s default
`dir` and `set`'s parent-directory check now use it.

## Amendment 2 (owner, 2026-10-16)

Decision: Undo must restore a v14 scene background. On v14 the background lives on the embedded
Level document (`Scene.<id>.Level.<id>`), updated through `updateEmbeddedDocuments('Level', ...)`.
module/src/audit/undo-classes.ts lists no `Level` in `UNDO_CLASSES` or `UNDO_EMBEDDED`, so
`undoClasses()` returns null for that uuid and Undo of the change most likely does nothing.
Change: Owns gains an insertion-only edit to undo-classes.ts (`'Level'` in `UNDO_EMBEDDED`; the
root `Scene` is already in `UNDO_CLASSES`) and the new module/test/audit/undo-levels.test.ts.
Acceptance gains the Level undo unit test, the unchanged-behaviour check for every other class,
and the v14 Undo assertion in the native e2e (still not run without owner approval). Overlap with
44, 47, 48 and 51 is recorded under Owns.

### Accepted residuals (owner, 2026-10-16; review should not flag these)

- (a) A parent directory with more than 200 entries cannot be confirmed. `browseImages` caps at
  200 (task 120), so `set` of a file in such a directory returns `INVALID_ARGS` with
  "directory too large to confirm".
- (b) The e2e suite creates the temporary Scene and Tile through the GM page, because
  `document_create` does not support those types.
- (c) `set` reads the value back after the update and fails if Foundry did not store the path.
  This is the deliberate guard against the v14 `scene.update` no-op, not redundant code.
