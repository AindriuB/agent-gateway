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
- protocol/src/tools/define.ts (Amendment 1, insertion only: one optional `mcpOutputSchema?: false` field on `ToolDefinition`)
- gateway/src/mcp/session.ts (Amendment 1: the `listed` tools/list mapping at :262-270 only)
- gateway/test/routing/dynamic-tools/definitions.test.ts (Amendment 1: the module-tool sweep at :96-108 only, so a tool with `mcpOutputSchema: false` is expected without `outputSchema`)
- gateway/test/mcp/image-view.test.ts (new, Amendment 1)
- module/src/ops/types.ts (Amendment 1: `OpResult.structured` becomes optional; no other change)
- module/src/link/bridge.ts (Amendment 1: the `res.structured.status` read at :190 becomes `res.structured?.status`; no other change)

Overlap: only the insertion-only shared files above, also inserted into by 53 and 121. Uses
protocol/src/images/**, module/src/tools/_image.ts (120) and the `OpResult.images` field (122)
without editing them. Amendment 1 files: gateway/src/mcp/session.ts, module/src/ops/types.ts and
module/src/link/bridge.ts are also edited by 122, which this task depends on, so they land in
order. session.ts is also listed by 112 (blocked; the `approval_status` branch) and 35b
(deferred; insertions at return points), neither of which touches `listed`. No open task owns
protocol/src/tools/define.ts or gateway/test/routing/dynamic-tools/definitions.test.ts.

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
- (Amendment 1) Every tool must have an `outputSchema` today, in these places:
  protocol/src/tools/define.ts:19 (`output` is required on `ToolDefinition`) and
  protocol/src/tools/json-schema.ts:20 (`toJsonSchema` always emits `outputSchema`);
  protocol/src/link/messages.ts:135-137 (a toolset announcement whose tool lacks an object
  `outputSchema` is rejected); gateway/src/mcp/session.ts:267 (tools/list projects an
  `outputSchema` for every listed tool); and gateway/test/routing/dynamic-tools/definitions.test.ts:96-108
  (asserts the projected `outputSchema` for every module-handled protocol tool).
  module/src/ops/types.ts:38 makes `OpResult.structured` required, and module/src/link/bridge.ts:190
  reads `res.structured.status`.

## Acceptance
- [ ] A new tool `image_view` (minRole `player`, category `read`, handledBy `module`) takes `source` enum `actor_portrait|actor_token|token|scene_background|file`, with `uuid` for the first four and `path` for `file`. (Amendment 1) Its handler returns `text` and `images` and no `structured` key. The text states the source, the mime type, the pixel dimensions and the byte size, and says whether the image was downscaled; the image travels only in `images`.
- [ ] (Amendment 1) `image_view` declares no MCP `outputSchema`: its definition sets `mcpOutputSchema: false`, and keeps an empty strict `output` object only because the protocol and the link announcement require one. In gateway/src/mcp/session.ts `listed`, a core tool with `mcpOutputSchema === false` is listed without an `outputSchema` key; every other tool is listed exactly as today. The link announcement, `toJsonSchema` and the version-skew check are unchanged. protocol/test/tools/image-view.test.ts asserts the flag; definitions.test.ts expects `image_view` without `outputSchema` and every other tool unchanged.
- [ ] (Amendment 1) `OpResult.structured` is optional and bridge.ts:190 reads it with `?.`; no other module source changes for this. Existing module tests pass unchanged.
- [ ] (Amendment 1) An MCP-level test in gateway/test/mcp/image-view.test.ts, through the SDK client after `listTools`, shows that `image_view` is listed without `outputSchema` and that its `tools/call` result has `content` of exactly one text block and one `image` block, and no `structuredContent` key. The text block names the dimensions, mime type, byte size and source. Another tool's result in the same session still carries `structuredContent`.
- [ ] Visibility, with identity only from the server-set Foundry user (a GM sees all):
  - `actor_portrait`, `actor_token`: the user has at least the ownership level the 52 findings name on the Actor.
  - `token`: (Amendment 2) the token is on a scene the user can view, and `!token.hidden || token.isOwner` (a hidden token is visible to its owner).
  - `scene_background`: the user can view the scene, per the 52 findings.
  - `file`: a non-GM needs `FILES_BROWSE`; `path` must pass `normalizeDataPath` and `isImagePath`.

  Otherwise `FORBIDDEN`, and nothing is fetched. Unit tests cover each refusal.
- [ ] The resolved image path must pass `isImagePath` before any request, so an `.svg` source is refused with `INVALID_ARGS` and never fetched; a remote `http(s)` source is refused the same way. Unit tests cover an Actor whose `img` is an `.svg` and one whose `img` is an external URL.
- [ ] The file is read same-origin with a stream reader that stops at the raw cap plus one byte; the module never holds more than that. The bytes must pass `sniffImage`, whatever the response `Content-Type` says; otherwise `INVALID_ARGS`. Unit tests cover SVG content in a `.png` file and a server that sends more bytes than the cap.
- [ ] (Amendment 1, from spikes/image-upload/findings.md:49-50,142) An image whose long edge exceeds 1568 px, or whose bytes exceed the 512 KiB raw cap, is downscaled in the browser to at most 1568 px on the long edge and re-encoded as JPEG (the text says so). A source over the 4 MB fetch cap, or one still over 512 KiB after re-encoding, is refused with `INVALID_ARGS` stating the byte size and the cap. 123 owns the downscale and the cap; 122 only carries prepared bytes. Unit tests cover the downscale, the refusal, and the returned frame fitting `MAX_FRAME_BYTES` with the largest allowed image.
- [ ] Native acceptance on v14 and v13 (`AGENT_GATEWAY_E2E_IMAGE=1`): a GM views a scene background and a data file; a player views the portrait of an Actor they own; a player is refused on a hidden token they do not own and on an Actor with no permission. The MCP result contains one `image` content block. Native execution needs the repository owner's per-run approval.
- [ ] `npm run verify` passes

## Out of scope
- Changing the link result format, the result path or any other part of the gateway (122), apart from the tools/list `outputSchema` omission in Amendment 1
- Omitting `outputSchema` or `structuredContent` for any tool other than `image_view`
- Uploading or assigning images (53, 121)
- Image sources outside `data`, URL fetching, tile textures, compendium art
- Editing protocol/test/tools/tool-count.test.ts, protocol/src/images/** or module/src/tools/_image.ts (120; stop and report if a helper is missing)

## Amendment 1 (owner, 2026-10-16)

Reason: Claude Code reportedly drops image blocks when `structuredContent` is also present
(spikes/image-upload/findings.md:39, client rows). 122 Amendment 2 keeps `structuredContent` for
every tool that sends `structured`, because the SDK client rejects a result without it for a tool
listed with an `outputSchema`.

Decision: `image_view` declares no MCP `outputSchema`, and its module handler returns no
`structured`. Under 122's rule the gateway then returns only the text and image blocks for it.
Other tools are unchanged.

Every tool is required to have an `outputSchema` today (see Context). The least invasive exemption
leaves the protocol definition, the link announcement and its validation alone: `image_view` keeps
an empty strict `output`, a new optional `mcpOutputSchema: false` flag on `ToolDefinition` marks
it, and only the gateway's tools/list mapping drops `outputSchema` for a flagged core tool.
`OpResult.structured` becomes optional so the handler can omit it. Owns, Context, Acceptance and
Out of scope are updated. The 1568 px long-edge downscale and the 512 KiB raw cap stay with this
task, because 122 only carries prepared bytes.

## Amendment 2 (owner, 2026-10-16, from review round 1)

Reason: the `token` visibility rule in Acceptance ("the token is not hidden") disagreed with
spikes/image-upload/findings.md:116 (`!token.hidden || token.isOwner`). Foundry itself shows a
hidden token to its owner.

Decision: the owner of a hidden token MAY view its image. The rule is the scene is viewable by the
user AND `!token.hidden || token.isOwner`. A hidden token the user does not own is still
`FORBIDDEN`. The Acceptance `token` bullet and the native-acceptance refusal case are corrected to
match.

## Review round 1 — findings

- [P3] The hidden-token rule disagreed between Acceptance and spikes/image-upload/findings.md:116.
  route: orchestrator → settled by Amendment 2.
- [P3] module/src/tools/image-view.ts:27 — `load` returns `INVALID_ARGS` "<uuid> is not a <type>
  you can view" for a missing uuid, but `FORBIDDEN` for an existing document the user cannot see.
  That lets a caller probe whether a uuid exists; module/src/tools/document-get.ts:206 makes the two
  look the same on purpose. The message also echoes the raw uuid without `inlineText`
  (document-get.ts:242).
  route: implementer — answer both cases the same way, with the same code and message, as
  `document_get` does, and pass the uuid through `inlineText`.
  input: player, `Actor.<id with ownership NONE>` → `FORBIDDEN`, versus `Actor.doesNotExist` →
  `INVALID_ARGS`.
- [P3] e2e/image-view/image-view.e2e.test.ts:7-8 — the header calls `_OWNED_ACTOR`,
  `_NO_PERM_ACTOR` and `_HIDDEN_TOKEN` optional, but the tests at :48 and :61 fail when they are
  unset.
  route: implementer — skip with a reason when unset, and fix the comment.
- [NOTE] `createImageBitmap` decodes the image before the size check (the user's own tab only), and
  compendium uuids are not refused (allowed by Out of scope). Recorded only; no action.

## Review round 3 — findings (external PR review on #172)

Reviewed HEAD: e9e2f6f6ab67f5d39c4eec9a921ef2343f2d1b01

- [P1] module/src/tools/image-view.ts:16 — `canSee` admits Actors and Scenes on native ownership (and everything for GM agents) without the GM's agent folder allowlist, so an agent that knows an excluded Actor uuid can read its portrait or prototype-token art, which document_get refuses. Scene backgrounds and placed-token images have the same bypass. Read handlers enforce folders via `folderAllowed` (module/src/policy/folders.ts); the setting is "Folders agents may read" (lang/en.json:78).
  route: implementer — apply the class-specific allowlist to the source's root world document before fetching (the parent Scene for tokens); refuse identically to a missing uuid. Fixed in 0fe8f18.

## Review round 4 — findings

Reviewed HEAD: 2fbeac5a097d1384683a206bff60fb2e6261cfff

- [P2] module/src/tools/image-view.ts:47-52 — the actor_portrait/actor_token allowlist check reads the loaded Actor's own folder, not its ROOT world document, so a synthetic token-Actor uuid (`Scene.S.Token.K.Actor.A`) escapes the Scene's allowlist, and for non-GMs skips the Scene permission and `token.hidden` checks (only the Actor's own testUserPermission is consulted). document-get.ts:171-178 walks `parent` to the root first.
  route: implementer — walk `doc.parent` to the root before `folderAllowed` (as `readable()` in document-get.ts does); for an embedded synthetic Actor, apply the root Scene's permission test and the owning token's hidden/owner rule as well. Add a test with an embedded Actor uuid on an excluded Scene, and one on a hidden token the player does not own.
  input: `gmAgents = ['ok']`; base Actor A in folder `ok`; Scene S in folder `secret` with unlinked token K of A; `image_view {source:'actor_portrait', uuid:'Scene.S.Token.K.Actor.A'}` → image returned (incl. any token-delta `img`), while document_get on the same uuid reads as missing.
