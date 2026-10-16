# 120 — Add shared image helpers and raise the tool-count ceiling

**Repo:** .
**Status:** Ready to start once 52 is merged (owner decision, 2026-10-16)
**Depends on:** 52
**Owns:**
- protocol/src/images/** (new)
- protocol/src/index.ts (insertion only: one `export * from './images/index.js'` line)
- protocol/test/images/** (new)
- protocol/test/tools/tool-count.test.ts (the two ceiling constants and their comment only)
- module/src/tools/_image.ts (new)
- module/test/tools/image-helpers/** (new)
- module/test/stubs/** (insertion only)

Overlap: this is the only task that edits protocol/test/tools/tool-count.test.ts. 53, 121, 122
and 123 import these helpers and must not edit them.

## Goal
The three image tools (53 `image_upload`, 121 `image_assign`, 123 `image_view`) and the
gateway's image transport (122) need the same safety checks. This task adds them once, as pure
functions in the protocol package (usable by both module and gateway) and one module-side
Foundry wrapper, and raises the tool-count ceiling so all three tools fit.

## Context
- The task 52 findings file (spikes/image-upload/) gives the FilePicker class path, `browse` shape, `FILES_BROWSE` enforcement and the path inputs the server mishandles. Use its numbers where they are stricter than the ones below.
- protocol/test/tools/tool-count.test.ts:4-7: ceilings 24 player and 36 GM. Today `toolsForRole` returns 22 player and 34 GM (protocol/src/tools/index.ts TOOLS). 53, 121 and 123 add three player tools (25 / 37) and open task 47 adds one GM tool (38).
- protocol/src/tools/limits.ts — the existing pattern for frozen limit constants.
- module/src/tools/_scene.ts, module/src/tools/_documents.ts — the existing pattern for underscore-prefixed shared tool helpers.
- module/test/stubs/** — Foundry API stubs (shared, insertion only).

## Acceptance
- [ ] protocol/test/tools/tool-count.test.ts sets `MAX_PLAYER_TOOLS = 26` and `MAX_GM_TOOLS = 38`, and the comment above them states the owner's 2026-10-16 decision to raise them for the image tools. No other line in that file changes (`git diff` shows only those lines).
- [ ] protocol/src/images/ exports `IMAGE_MIME_TYPES` (`image/png`, `image/jpeg`, `image/webp` only) and `IMAGE_EXTENSIONS` (`.png`, `.jpg`, `.jpeg`, `.webp` only). Neither contains `svg`; a unit test asserts it.
- [ ] `sniffImage(bytes: Uint8Array)` returns the MIME type for PNG, JPEG and WebP (RIFF....WEBP) magic bytes and `null` otherwise. Unit tests cover each format, SVG text (`<svg`, `<?xml`), GIF, an empty buffer, and a buffer shorter than the signature.
- [ ] `normalizeDataPath(input: string)` returns a canonical relative path or an error code. It rejects: an empty string, more than 256 characters, a leading `/` or drive letter, any URL scheme (`https:`, `data:`, `file:`), a backslash, a NUL or other control character, a `..` or `.` segment before or after one percent-decoding, an empty segment (`a//b`), and anything else the 52 findings list. Each rejection has a unit test.
- [ ] `isImagePath(path)` accepts only `IMAGE_EXTENSIONS`, case-insensitively, after `normalizeDataPath`; `foo.svg`, `foo.png.svg`, `foo.SVG` and `foo` are rejected in tests.
- [ ] module/src/tools/_image.ts exports a FilePicker resolver for v13 and v14 (per the 52 findings) and `browseImages(user, dir, limit)`, which:
  - refuses a non-GM user without `FILES_BROWSE` with `FORBIDDEN`, using Foundry's server-set user only;
  - calls `browse` on the `data` source only, after `normalizeDataPath`;
  - returns at most `limit` entries (hard maximum 200) of `dirs` and `isImagePath` files, plus `truncated: boolean`.

  Unit tests use FilePicker stubs and cover a player without `FILES_BROWSE`, a GM, a traversal input that never reaches the stub, and truncation at the cap.
- [ ] `npm run verify` passes

## Out of scope
- Any tool definition or handler (53, 121, 123)
- Changes to link messages, the gateway or MCP results (122)
- Fetching file bytes over HTTP (123 owns that, in its own file)
- Raising `TOOL_LIMITS` or `MAX_FRAME_BYTES`
