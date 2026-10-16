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
- module/test/tools/image-assign/** (new)
- module/test/stubs/** (insertion only)
- e2e/image-assign/** (new)
- e2e/vitest.e2e.config.ts (insert one `image-assign/**/*.e2e.test.ts` line in the e2e-live include list only)

Overlap: only the insertion-only shared files above, also inserted into by 53 and 123. Uses
protocol/src/images/** and module/src/tools/_image.ts (owned by 120) without editing them.

## Goal
Let an agent find an image that already exists in Foundry's `data` files and set it as an Actor
portrait, prototype token art, a placed token's texture, a scene background or a tile texture.
Finding is a bounded, read-only directory listing. Players act only on documents they own; a GM
may act on any.

## Context
- The task 52 findings file (spikes/image-upload/) gives the `browse` shape, `FILES_BROWSE` enforcement and the v13/v14 field paths for each target. It overrides the field paths below.
- module/src/tools/_image.ts and protocol/src/images/** (task 120): `browseImages`, `normalizeDataPath`, `isImagePath`.
- module/src/tools/conditions.ts:27 and module/src/ops/context.ts:38-50 — a `read` tool that escalates to `write` only when it changes something; follow this so listing needs no approval.
- module/src/tools/_write.ts and the 53 task file — snapshot, `callOptions` and Undo for document updates.
- protocol/test/tools/rules/validate.test.ts:134-176 — the per-tool example map.

## Acceptance
- [ ] A new tool `image_assign` (minRole `player`, category `read`, handledBy `module`) takes `action` enum `list|set`:
  - `list`: optional `dir` (default the data root) and optional `limit` (1-200, default 100). It returns `{ dirs, files, truncated }` from `browseImages`.
  - `set`: `path`, `target` enum `actor_portrait|actor_token|token|scene_background|tile` and `uuid`.

  There is no URL argument and no `source` argument; the source is always `data`.
- [ ] `set` calls `ctx.escalate('write')` before any check that touches a document, so it is approval-gated and audited like a write; `list` never escalates. A unit test asserts both.
- [ ] `set` rejects with `INVALID_ARGS`, before any document update, a `path` that fails `normalizeDataPath` or `isImagePath`, a path not present in a `browse` of its parent directory, and a `uuid` whose document type does not match `target`. Unit tests cover `../x.png`, `x.svg`, a URL, a missing file and an Actor UUID sent with `target: tile`.
- [ ] Permissions, with identity only from the server-set Foundry user:
  - `list`, and `set` for a non-GM, require `FILES_BROWSE`; otherwise `FORBIDDEN`.
  - A player may use `actor_portrait` and `actor_token` only on an Actor they OWN, and `token` only on a token whose document they own.
  - `scene_background` and `tile` are GM only.

  Unit tests cover a player without `FILES_BROWSE`, a player on a non-owned Actor, a player on another user's token, and a player sending `scene_background` and `tile`.
- [ ] One `set` call is one approval and one audit entry, showing `path`, `target` and `uuid`. The update is snapshotted with `callOptions`, and Undo restores the previous value. A unit test covers Undo for each target.
- [ ] Native acceptance on v14 and v13 (`AGENT_GATEWAY_E2E_IMAGE=1`): a GM lists a directory and sets a temporary scene background and tile texture; a player sets the portrait and token art of an Actor they own; a player is refused on another user's Actor. Temporary documents are removed by exact UUID. Native execution needs the repository owner's per-run approval.
- [ ] `npm run verify` passes

## Out of scope
- Uploading files (53) and viewing images (123)
- Any source other than `data` (`public`, `s3`), including system and module icon paths
- Creating, moving or deleting files or directories
- Editing protocol/test/tools/tool-count.test.ts, protocol/src/images/** or module/src/tools/_image.ts (120; stop and report if a helper is missing)
