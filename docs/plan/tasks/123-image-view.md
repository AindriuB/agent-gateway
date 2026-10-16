# 123 — Add an image view tool so the agent can see images

**Repo:** .
**Status:** Ready to start once 52, 120 and 122 are merged (owner decision, 2026-10-16)
**Depends on:** 52, 120, 122
**Owns:**
- protocol/src/tools/image-view.ts (new)
- protocol/src/tools/index.ts (insertion only)
- protocol/test/tools/image-view.test.ts (new)
- protocol/test/tools/rules/validate.test.ts (insert one `image_view` example only; exhaustiveness guard)
- module/src/tools/image-view.ts (new)
- module/src/tools/index.ts (insertion only)
- module/test/tools/image-view/** (new)
- module/test/stubs/** (insertion only)
- e2e/image-view/** (new)
- e2e/vitest.e2e.config.ts (insert one `image-view/**/*.e2e.test.ts` line in the e2e-live include list only)

Overlap: only the insertion-only shared files above, also inserted into by 53 and 121. Uses
protocol/src/images/**, module/src/tools/_image.ts (120) and the `OpResult.images` field (122)
without editing them.

## Goal
Let the agent look at an Actor portrait, an Actor's prototype token art, a placed token's
texture, a scene background or a `data` file, as an MCP image content block. The image is
bounded in size, is PNG, JPEG or WebP only (never SVG), and is returned only if the calling user
could see it in Foundry.

## Context
- The task 52 findings file (spikes/image-upload/) gives the URL form for data files, the byte-capped stream read, the visibility test for each source, the raw byte cap, and the downscale-or-refuse decision.
- module/src/ops/types.ts `OpResult.images` and the result path (task 122).
- protocol/src/images/** and module/src/tools/_image.ts (task 120): `sniffImage`, `normalizeDataPath`, `isImagePath`.
- protocol/src/link/messages.ts:9 `MAX_FRAME_BYTES`.

## Acceptance
- [ ] A new tool `image_view` (minRole `player`, category `read`, handledBy `module`) takes `source` enum `actor_portrait|actor_token|token|scene_background|file`, with `uuid` for the first four and `path` for `file`. The result's `structured` holds `{ source, mimeType, bytes }` and the text says what was shown; the image travels only in `images`.
- [ ] Visibility, with identity only from the server-set Foundry user (a GM sees all):
  - `actor_portrait`, `actor_token`: the user has at least the ownership level the 52 findings name on the Actor.
  - `token`: the token is not hidden and is on a scene the user can view.
  - `scene_background`: the user can view the scene, per the 52 findings.
  - `file`: a non-GM needs `FILES_BROWSE`; `path` must pass `normalizeDataPath` and `isImagePath`.

  Otherwise `FORBIDDEN`, and nothing is fetched. Unit tests cover each refusal.
- [ ] The resolved image path must pass `isImagePath` before any request, so an `.svg` source is refused with `INVALID_ARGS` and never fetched; a remote `http(s)` source is refused the same way. Unit tests cover an Actor whose `img` is an `.svg` and one whose `img` is an external URL.
- [ ] The file is read same-origin with a stream reader that stops at the raw cap plus one byte; the module never holds more than that. The bytes must pass `sniffImage`, whatever the response `Content-Type` says; otherwise `INVALID_ARGS`. Unit tests cover SVG content in a `.png` file and a server that sends more bytes than the cap.
- [ ] Oversize images follow the 52 decision: either they are downscaled in the browser to fit the cap and re-encoded as JPEG or WebP (the result says so), or they are refused with `INVALID_ARGS` stating the byte size and the cap. A unit test covers the chosen path. The returned frame fits `MAX_FRAME_BYTES` in a test using the largest allowed image.
- [ ] Native acceptance on v14 and v13 (`AGENT_GATEWAY_E2E_IMAGE=1`): a GM views a scene background and a data file; a player views the portrait of an Actor they own; a player is refused on a hidden token and on an Actor with no permission. The MCP result contains one `image` content block. Native execution needs the repository owner's per-run approval.
- [ ] `npm run verify` passes

## Out of scope
- Changing the link result format or the gateway (122)
- Uploading or assigning images (53, 121)
- Image sources outside `data`, URL fetching, tile textures, compendium art
- Editing protocol/test/tools/tool-count.test.ts, protocol/src/images/** or module/src/tools/_image.ts (120; stop and report if a helper is missing)
