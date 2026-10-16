# 52 — Spike: Foundry file, image and MCP image-content rules for the image tools

**Repo:** .
**Status:** Ready — may start now (owner decision, 2026-10-16). Gate for 53, 120, 121, 122 and 123.
**Depends on:** none
**Owns:**
- spikes/image-upload/** (new; throwaway probe scripts and the findings file for the PR)

## Goal
Before the three image tools are built (53 `image_upload`, 121 `image_assign`, 123 `image_view`,
plus the shared helpers in 120 and the MCP image transport in 122), confirm on live v13 and v14
how a module uploads, browses and reads files as the calling user, and how MCP clients handle
image content in tool results. The architect's assumptions are unverified. This task writes no
product code; its findings file sets the caps and argument shapes the later tasks use.

## Context
- protocol/src/link/messages.ts:9 sets `MAX_FRAME_BYTES = 1 MiB`; gateway/src/link/server.ts:215 passes it as the WebSocket `maxPayload`, so an oversize frame closes the link rather than failing one call.
- protocol/src/link/messages.ts:74-80 `ResultMessage` carries `text` and `structured` only.
- gateway/src/mcp/session.ts:503-515 builds every module tool result as one `text` content block plus `structuredContent`.
- gateway/src/relay/constants.ts:8 `MAX_RELAY_LINE_BYTES = 4 MiB` (secondary-to-primary relay).
- protocol/src/tools/limits.ts sets the existing schema and result byte caps (64 KiB text and structured).
- module/src/audit/types.ts:66 limits audit args to 8000 characters; module/src/audit/stage.ts:254 keeps only the first text line of a result.
- gateway/src/offline-queue/repository.ts:113 and service.ts:163 cap a queued call at `MAX_FRAME_BYTES`.
- gateway/package.json pins `@modelcontextprotocol/sdk` ^1.32.1.
- docs/testing.md covers the v14 and v13 test beds; docs/compatibility.md lists the MCP clients.

## Acceptance (each answered with live evidence on v13.351 and v14.369 unless marked otherwise)
Upload (for 53):
- [ ] The FilePicker class path on each version (`foundry.applications.apps.FilePicker.implementation` versus the global `FilePicker`), and the `upload` signature and return shape.
- [ ] Which user permission gates upload (`FILES_UPLOAD`), whether the server enforces it for a player socket, and the default role grants.
- [ ] The server's allowed upload extensions and MIME checks, whether SVG is accepted, and the per-file size limits.
- [ ] Whether a module can create and target a fixed directory (e.g. `agent-gateway/uploads/<userId>/`) in the `data` source, and what happens on a name collision.
- [ ] Whether a ~700 KiB-raw base64 argument survives the gateway → link → module path under `MAX_FRAME_BYTES`, the exact usable maximum, and whether the offline queue accepts or refuses it.
- [ ] How approvals (module/src/approvals/) and audit store a large argument, and whether the payload must be replaced by a hash and size before it is queued.

Browse and assign (for 120 and 121):
- [ ] The `browse` signature and return shape on each version (source, target, options such as `extensions`), how `dirs` and `files` are returned, and whether results are paginated or unbounded for a large directory.
- [ ] Whether `FILES_BROWSE` is enforced server-side for a player socket, its default role grants, and what a GM bypasses.
- [ ] What the server does with `..`, a leading `/`, a backslash, a percent-encoded `%2e%2e`, a URL, and a NUL byte in the browse target; the findings list the inputs the client-side validator in 120 must reject before calling Foundry.
- [ ] The image fields and their v13/v14 paths for Actor `img`, `prototypeToken.texture.src`, TokenDocument `texture.src`, Scene background (`background.src` or the v14 equivalent) and Tile `texture.src`, and whether a player-owner's update of each goes through the normal permission check.

Reading bytes and visibility (for 123):
- [ ] How the module reads a `data` file's bytes in the browser: the URL form (including a configured route prefix), whether same-origin `fetch` works for each version, the response headers, and how to stop reading after N bytes with a stream reader. State whether Foundry serves data files to any client without a session, which means visibility must be enforced by the tool, not the server.
- [ ] The permission test that matches "the user can see this image" for an Actor portrait and prototype token (minimum ownership level), a placed token (hidden tokens, scene visibility), and a scene background (navigation/visibility versus ownership).
- [ ] Whether browser-side downscaling (`createImageBitmap` plus `OffscreenCanvas` re-encode to JPEG or WebP) works on both versions and in the headless runner's Chromium, with a recommendation: downscale large images, or refuse them.

MCP image content (for 122 and 123):
- [ ] The SDK's `CallToolResult` image content type (`{ type: 'image', data, mimeType }`) in the pinned version, and whether `structuredContent` plus an `outputSchema` may accompany image content.
- [ ] For each client in docs/compatibility.md (Claude Code, Claude Desktop, claude.ai connector, ChatGPT connector, Gemini CLI): whether a tool-result image reaches the model, and its byte and dimension limits. Live runs are recorded where possible; otherwise the row is marked "docs only" with the source cited.
- [ ] The largest raw image that fits a result frame under `MAX_FRAME_BYTES` after base64 and the envelope, and whether stdio, HTTP and the relay pass it unchanged. The findings recommend one raw byte cap for `image_view` that also fits the smallest client limit.

Output:
- [ ] A findings file under spikes/image-upload/ with commands, versions and answers. It contains no personal paths, hostnames or usernames. The PR proposes the final arguments and caps for 53, 121 and 123, and the result-frame shape for 122.

## Out of scope
- Any change under module/src, gateway/src or protocol/src
- Editing tasks 53 and 120-123; the findings are their input

## Review round 1 — findings

Reviewed HEAD: 784034acb42632d275161728cab68e827f5c97d9

- [P2] spikes/image-upload/findings.md:66-80, 85-94 — The v14.369 evidence won't show up when GitHub renders these two tables. Each row is written `| Question | v13 || v14 |`, which makes four cells under a three-column header (`| Question | v13.351 | v14.369 |`). GFM drops cells past the header count, so the v14.369 column shows the empty third cell and the actual v14 text is discarded. This affects all 25 rows of the Upload and Browse tables.
  route: implementer — the fix is a markdown repair inside Owns and changes no content (replace `||` with `|`).
  input: render findings.md on GitHub or in the PR view  →  the v14.369 column is blank in every row of both tables, so the PR's v14 evidence for the Class path, Permission, Server enforcement, Extensions, SVG, MIME, Collision, `..` and browse-validator rows can't be seen.
- [STYLE] spikes/image-upload/p6.mjs:1 — The `ctx` parameter is unused, which breaks `@typescript-eslint/no-unused-vars`. `npm run lint` runs `eslint .`, which does not ignore `spikes/`, so the branch fails the lint gate.
  route: implementer — drop the parameter.
  rule: eslint.config.js (`tseslint.configs.recommended`); docs/conventions.md:3 ("ESLint (`eslint.config.js`)")
  proof: running repo eslint on a `git archive HEAD` copy of `spikes/` gives `p6.mjs 1:29 error 'ctx' is defined but never used`. It is the only error.
- [P3, optional] spikes/image-upload/findings.md-E — An out-of-date backup copy of the findings (looks like a leftover from BSD `sed -i -e`) was committed. It contradicts the real findings: it says "Status: PARTIAL", "Nothing was created in any world so far", every client row is "unverified", and it uses the old task numbers 104/105.
  route: implementer — delete the file. It is inside Owns and is not a deliverable.
  input: a reader of the PR opens both findings files  →  two opposite statuses for the same spike.
- [P3, optional] spikes/image-upload/findings.md:33 vs :56 — The base64 size of the 512 KiB cap is given two ways. Line 33 says "700 KB base64" and line 56 says "about 683 KB base64". The true figure is 699,052 chars, which is about 699 KB or 683 KiB, so line 56 uses the wrong unit.
  route: implementer — make the figures consistent.
  input: n/a (documentation arithmetic)  →  task 53/123 caps could be derived from the wrong figure.
