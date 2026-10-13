# 53 — Add an image upload tool for maps, portraits and token art

**Repo:** .
**Status:** Planned — do not start; queued after current workloads (32, 44, and the five gap tasks)
**Depends on:** 52
**Owns:**
- protocol/src/tools/image-upload.ts (new)
- protocol/src/tools/index.ts (insertion only)
- protocol/test/tools/image-upload.test.ts (new)
- protocol/test/tools/rules/validate.test.ts (insert one `image_upload` example only)
- module/src/tools/image-upload.ts (new)
- module/src/tools/index.ts (insertion only)
- module/test/tools/image-upload/** (new)
- e2e/image-upload/** (new)
- e2e/vitest.e2e.config.ts (insert one `image-upload/**/*.e2e.test.ts` line only)

Overlap: none with 45–51. Like 46 and 47, it inserts into the shared registries.

## Goal
Let an agent upload one image per call into a fixed, server-named location. In the same call it
can set an Actor's portrait and/or prototype token art. A GM may also set a scene background.
This replaces manual file handling when building maps and characters. There is no URL fetching
(no SSRF), no SVG, and the module never decodes the image.

## Context
- The task 52 findings file (spikes/image-upload/) supplies the confirmed FilePicker path, permissions, extensions and the usable payload size. Replace the caps below with the spike's numbers if they are lower.
- protocol/src/link/messages.ts:9 sets `MAX_FRAME_BYTES = 1 MiB`.
- protocol/test/tools/tool-count.test.ts:6-7: this player tool brings the counts to 24 player and 36 GM, which is exactly the ceiling. The PR must state that.
- gateway/src/mcp/session.ts:224, :252: results are text content only today.

## Acceptance
- [ ] A new tool `image_upload` (minRole `player`, category `write`) takes:
  - `data`: base64, with a declared `maxLength` for about 700 KiB raw, or the spike's lower number
  - `mime`: enum `image/png|image/jpeg|image/webp`
  - optional `actorUuid` with `setPortrait` and `setToken` booleans
  - optional `sceneUuid` with `setBackground`

  There is no URL argument. `conservativeProblems` is `[]`.
- [ ] Before upload, the decoded bytes must start with the PNG, JPEG or WebP magic bytes that match `mime`, and the raw size must be within the cap. Otherwise INVALID_ARGS. Unit tests cover SVG text, a mismatched magic number, oversize input and bad base64. The module never constructs an Image or canvas from the data (`rg -n "new Image|createImageBitmap|getContext" module/src/tools/image-upload.ts` is empty).
- [ ] Storage goes to a fixed per-user directory (`agent-gateway/uploads/<userId>/`) under a server-generated filename (random id plus an extension derived from `mime`). Caller text never reaches the path. Each user has a total byte cap (spike-defined), and exceeding it returns INVALID_ARGS. Unit-tested.
- [ ] Permissions:
  - A player may upload only when Foundry grants that user `FILES_UPLOAD`.
  - A player may set only `img` and `prototypeToken.texture.src`, and only on an Actor they OWN.
  - A GM may target any Actor and a scene background (`sceneUuid`).

  Identity comes only from the server-set user. Unit tests cover a player with no upload permission, a player on a non-owned Actor, and a player sending `sceneUuid`.
- [ ] One call means one approval and one audit entry. The approval and audit show size, mime, SHA-256 and target fields, never the base64 payload. Actor and Scene updates are snapshotted and carry `callOptions`, and Undo restores the previous `img`/texture/background. The uploaded file itself is not deleted by Undo, and the result says so.
- [ ] Native acceptance on v14 and v13 (`AGENT_GATEWAY_E2E_UPLOAD=1`):
  - A GM uploads a PNG and sets a temporary scene background.
  - A player sets the portrait and token of an Actor they own.
  - A player is refused on another user's Actor.

  Temporary documents are removed by exact UUID. Native execution needs Andrew's per-run approval.
- [ ] `npm run verify` passes

## Out of scope
- MCP image content blocks in gateway results (optional follow-up; gateway/src/mcp/session.ts:224,252)
- URL fetching, SVG, image resizing or decoding
- Deleting uploaded files
