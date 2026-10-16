# Task 52 findings: image upload spike

Status: PARTIAL. Part A (static) is done. Part B is live on v13.351 and v14.369. Not done: the live
gateway/link/module run of the large upload, the upload size limit, and the MCP client rows ("unverified").

Versions: `@modelcontextprotocol/sdk` 1.32.1 (as installed), repo at main f68d9e0.

## Part A. Answered without Foundry

### MCP image content (for 122, 123)
- The SDK defines `ImageContentSchema` in `dist/esm/types.d.ts`: `{ type: 'image', data: string, mimeType: string, annotations?, _meta? }`. `data` is base64.
- `CallToolResult.content` accepts a mix of text and image blocks. `structuredContent` may accompany them.
- `McpServer.validateToolOutput` (server/mcp.js) checks only `structuredContent` against `outputSchema`, and skips the check when `isError` is true. If the tool has an `outputSchema`, `structuredContent` is mandatory for non-error results; image blocks are not validated against it. So image content plus `structuredContent` plus `outputSchema` is legal; `structuredContent` must match the schema and must not repeat the base64.
- Today `gateway/src/mcp/session.ts:503-515` emits one text block and optional `structuredContent`. 122 must add an image block there. `failure()` deliberately omits `structuredContent`; keep that.

### Frame arithmetic (for 53, 122, 123)
Measured by serialising the real envelope shape (36-char ids) and searching for the largest base64 string with `Buffer.byteLength <= MAX_FRAME_BYTES (1,048,576)`:
- `call` frame with `{ name, data }` args: at most 1,048,410 base64 chars, which is 786,306 raw bytes (about 768 KiB). Extra args shrink this; budget 2 KiB of envelope.
- `result` frame carrying one image inside `structured`: 1,048,217 base64 chars, 786,162 raw bytes.
- A 700 KiB raw file is 955,736 base64 chars, which fits a call frame with about 92 KB spare. The "~700 KiB" assumption holds, with about 68 KiB of raw headroom.
- `ResultMessage` (protocol/src/link/messages.ts:74-80) has only `text` and `structured`. There is no image field, so 122 must either add one (protocol change, bump the link version) or tunnel the base64 in `structured`. `TOOL_LIMITS.resultStructuredBytes` (64 KiB) would reject it today and must be raised for the image tools only.
- An over-limit frame is not a per-call failure: `maxPayload` on the WebSocketServer closes the link (server.ts:215), and `parseLinkMessage` returns `oversize`. Tools must refuse before sending.
- Relay: `MAX_RELAY_LINE_BYTES` is 4 MiB, and one JSON-RPC line holds the whole result. A 1 MiB frame passes with room to spare (base64 expands by 4/3 only once on the way). Stdio and HTTP have no frame cap in this repo. Not exercised live.

### Offline queue
- `repository.ts:~100-113` refuses a queued call with `INVALID_ARGS "Queued call exceeds frame limit"` when the wrapped `queuedCalls` frame (including the full tool `definition`) is over `MAX_FRAME_BYTES`. So a call that fits a live `call` frame can still be refused offline. Budget: definition size (up to 16 KiB schema) plus about 200 bytes.
- `service.ts:~163` stops adding queued calls to a frame once the next one would overflow, so a large call is delivered in its own frame. A single call that already passed the repository check always fits alone.
- Recommendation: 53 caps raw at 512 KiB (700 KB base64) so the queued and live forms both fit.

### Approvals and audit
- Approvals: `module/src/approvals/manager.ts:~418` stores `args` unmodified in the `ApprovalRecord` and `callHash` hashes canonical JSON of the whole args. The request is emitted over the Foundry module socket (`approval.request`, live.ts:42) to approvers. A 700 KiB payload therefore travels through Foundry's socket.io; whether the server's socket buffer limit allows it is a live check (Part B). Recommendation: for `image_upload`, the approval request should carry a replacement args object with `{ name, bytes, sha256 }` and not the base64, and the approval hash should cover the sha256.
- Audit: `AUDIT_LIMITS.argsChars = 8000`, `argsString = 500`; `boundedJson(ctx.args)` truncates and sets `argsTruncated`. Large base64 is cut safely to 500 characters, so audit needs no change; but the stored form cannot reproduce the upload, so the tool should log name, size and hash as distinct small args.
- Audit result summary keeps only the first text line (stage.ts:254): put the destination path on the first line.

### MCP clients (docs only; none run live)
No client was run. The values below are what I recall from vendor documentation and are UNVERIFIED; they have not been cited from live sources because no web access was used. They must be confirmed before 123 fixes its cap.

| Client | Image in tool result reaches model | Limits |
| --- | --- | --- |
| Claude Code | unverified | unverified |
| Claude Desktop | unverified | unverified |
| claude.ai connector | unverified | unverified |
| ChatGPT connector | unverified | unverified |
| Gemini CLI | unverified | unverified |

Provisional recommendation for `image_view`: raw cap 512 KiB (about 683 KB base64, well under the 786 KB frame maximum), downscaled in the browser; revisit after the live checks.

## Part B. Live results, v13.351 (pf2e 7.12.2), headless Chrome via Playwright, empty-password join

Harness: `run.mjs <v13|v14> <user> <probe.mjs>`; probes `p0`-`p12v14`. The v14 pass (14.369, pf2e 8.6.0) was run afterwards as dev-gm and player1 with the same probes, the `p3v14`/`p7v14`/`p8v14` variants being reduced (fewer uploads, no traversal upload).

### Upload (for 53)
| Question | v13.351 | v14.369 |
| --- | --- | --- |
| Class path | `foundry.applications.apps.FilePicker.implementation` (same object as `FilePicker.implementation`; global `FilePicker` is the deprecated alias of the namespaced class) || Same as v13: `foundry.applications.apps.FilePicker.implementation`; `upload` has the same source and return shape; `createDirectory` returns the server path and throws `EEXIST` for an existing directory |
| `upload` | `static async upload(source, path, file: File, body = {}, options = {notify: true})`; POSTs FormData (`source`, `target`, `upload`, plus `body`) to `/upload`. Returns `{status:'success', message, path}` on success (`path` is the stored data-relative path), `false` on a server `error` (the error text goes to `ui.notifications.error`, not the return value), `undefined` on 413 or a missing path, `{}` on a network failure. `options.notify:false` silences success and some warnings but a server `error` is still notified. 53 must treat `false`, `undefined` and `{}` as failure. || Identical source to v13 (same return shape and failure values) |
| `createDirectory(source, target, options)` | returns the absolute server path string; one level per call (parents must exist); an existing directory throws `EEXIST` || Same as v13 |
| Permission | `FILES_UPLOAD`, default role Assistant (3); `FILES_BROWSE` default Trusted (2). Roles: Player 1, Trusted 2, Assistant 3, GM 4. The test world's setting equals the defaults. Player role (player1, role 1): `FILES_UPLOAD` false. || Same defaults (`FILES_BROWSE` Trusted 2, `FILES_UPLOAD` Assistant 3). v14's permission definitions also carry a `requiredRoles` field (`[3,4]` for browse, `[4]` for upload) that v13 lacks; I did not test what it restricts (probably the lowest role the settings UI lets an admin grant), so confirm before relying on a Player ever being granted either. player1 (role 1): both false |
| Server enforcement | Yes. Player1 `FP.upload` returned `false` with notification "User [id] does not have permission to upload files." (server `/upload` response). Browse and `createDirectory` over the raw `manageFiles` socket event as player1 returned `{error:"You do not have permission to browse the host file system!"}`, so it is not client-only. createDirectory is gated by the browse permission message. Not tested: a role-2 or role-3 user (that needs a world permission change, which I did not make). || Same: player1 `upload` returned `false` with "does not have permission to upload files"; raw `manageFiles` browse and createDirectory returned the "You do not have permission to browse the host file system!" error |
| Allowed extensions | Server and `CONST.UPLOADABLE_FILE_EXTENSIONS`: images apng avif bmp gif jpeg jpg png svg tiff webp; audio, video, text (csv json md pdf tsv txt xml yml yaml), fonts, 3D. Upload of `.html`, `.exe`, `.png.exe` and an extension-less name returned `false` (rejected). Upper-case `.PNG` accepted and the case kept. || Same: `.html` and `.png.exe` rejected (`false`); `.png`, `.svg` accepted. Full list not re-dumped on v14 |
| SVG | Accepted. Served as `image/svg+xml` with `Content-Security-Policy: default-src 'none'; script-src 'none'`. || Accepted; served `image/svg+xml` with `default-src 'none'; script-src 'none'` CSP |
| MIME check | None on content: a text file named `.png` with `type: image/png` was accepted. Only the extension is checked, so 53 must validate magic bytes itself. || Same: a text file named `.png` was accepted (extension-only) |
| Size limit | Not reached. A 70-byte file works; the server-side client path reports 413 as "too large" only (limit is the reverse proxy/server config, not probed because uploaded files cannot be deleted through the API). 53 stays below the 786 KB frame ceiling anyway. || Not tested on v14 (same reason) |
| Fixed directory | Yes. `agent-gateway`, `agent-gateway/uploads`, `agent-gateway/uploads/ag-spike-52` were created one level at a time as GM. || Yes, same three levels created one at a time |
| Name collision | Silent overwrite: the second upload of `ag-spike-52-a.png` returned the same `path`. 53 must make names unique itself (e.g. hash prefix). || Same: silent overwrite, same `path` returned |
| Name with `/` | `../ag-spike-52-x.png` was stored as `ag-spike-52-x.png` in the target (server strips the directory part). || Same: `../ag-spike-52-x.png` stored as `ag-spike-52-x.png` in the target |
| `..` in the upload target | `agent-gateway/uploads/../..` was normalised to the Data root: the file `ag-spike-52-tt.png` landed in the Data root. Traversal above Data was not observed, but 53 must reject `..` itself and build the target from the user id. || Not repeated by instruction. Checked with `createDirectory('data', '<target>/../../..')`: it threw `EEXIST` on the Data root, so the path is clamped to Data exactly as on v13 |
| 700 KiB through gateway->link->module, offline queue | Not run live (needs a paired gateway; pairing is excluded). Static answer in Part A: fits, max 786,306 raw bytes in a call frame. || Not run live (see v13 column) |
| Approvals/audit of large args | Part A. | n/a |

### Browse and assign (for 120 and 121)
| Question | v13.351 | v14.369 |
| --- | --- | --- |
| `browse(source, target, options)` | `FP.browse('data', target, {extensions: ['.json']})` goes over the `manageFiles` socket event (`{action:'browseFiles', storage, target}`), not HTTP. Returns `{target, private, gridSize, dirs: string[], privateDirs: string[], files: string[], extensions: string[]}`. `dirs` and `files` are full data-relative paths (not names). Sources seen: `data`, `public`; `s3` and unknown names throw "storage ... does not exist!". || Identical: same socket action, same return keys (`target, private, gridSize, dirs, privateDirs, files, extensions`), same sources (`data`, `public`; `s3`/unknown throw) |
| Pagination | None: one response with the whole list, no cursor or limit fields. 120 must slice and cap results itself. || None, as v13 |
| `FILES_BROWSE` enforcement | Server-side (see above); player1 (role 1) is refused for `data`, `public` and the root; default grant is Trusted and up; the GM has every permission (`disableGM` false only means it can be removed from GM in the settings, here it is granted). || Server-side, as v13 (player1 refused on data, public, root) |
| `..` | Server clamps to the root: `..`, `worlds/../..` return the Data root listing with `target: ''`. || Same: `..` and `worlds/../..` return the Data root |
| Leading `/` | `/` returns the root; `/etc` throws "Directory /etc does not exist or is not accessible". || Same: `/` root listing; `/etc` throws |
| Backslash | `worlds\test-world` throws "does not exist" (not treated as a separator on this server). || Same: throws "does not exist" |
| `%2e%2e` | Not decoded as traversal, but it also resolved to the root listing (`target: ''`), so the server decodes then normalises. || Same: resolves to the root listing |
| URL | `https://example.com/` throws "does not exist". || Same: throws |
| NUL | `worlds\u0000` and `wor\u0000lds` throw "does not exist". || Same: throws "does not exist" |
| Validator list for 120 | Reject before calling Foundry: any `..` segment, a leading `/`, any `\`, any `%` (so `%2e`), any scheme (`:`), any control char including NUL, empty segments; allow only `[A-Za-z0-9._ -]` segments. The server tolerates most of these, but since it silently remaps them to the Data root the tool should refuse rather than return a surprising listing. || Same list applies |

Image fields (verified by creating temporary documents with them set on both versions):
Actor `img`; Actor `prototypeToken.texture.src`; TokenDocument `texture.src`; Tile `texture.src` are identical on v13 and v14. Scene background differs:
- v13: `Scene#background.src` (writable).
- v14: scenes have Levels. `scene.background.src` is only a read alias of the initial level: a `Scene.create({background:{src}})` left it `null`, and `scene.update({'background.src': ...})` is a no-op that returns `undefined` (the player's attempt even threw a client TypeError). The writable path is the Level document: `scene.updateEmbeddedDocuments('Level', [{ _id: <levelId>, 'background.src': path }])` (default level id `defaultLevel0000`; read levels from `scene.levels`). 121 must branch on version: `game.release.generation >= 14` uses the Level path, and read the current value back from `scene.background.src` on both.

Player-owner updates through the normal permission check (player1 OWNER of the actor):
| Field | player1 result |
| --- | --- |
| Actor `img` (v13 and v14) | allowed |
| `prototypeToken.texture.src` | allowed |
| TokenDocument `texture.src` (token whose actor player1 owns) | allowed |
| Tile `texture.src` (v13 and v14) | refused: "lacks permission to update Tile" |
| Scene `background.src` (v13; both a navigation scene and a non-navigation one) | refused: "lacks permission to update Scene" |
| v14 Level `background.src` via `updateEmbeddedDocuments('Level')` | refused: "lacks permission to update Level" |
| Actor `img` where player1 has only LIMITED | refused |

So 121 can rely on Foundry's own check: it needs no extra permission test of its own for these five fields, but should map the refusals to `FORBIDDEN`.

### Reading bytes and visibility (for 123)
- URL: the data-relative path, root-relative, e.g. `/agent-gateway/uploads/<dir>/<file>`; `foundry.utils.getRoute(path)` adds any configured `routePrefix` (null on the test bed). Use `getRoute`, never a hard-coded `/`.
- Same-origin `fetch(url)` works for the player and the GM. Response headers: `content-type` (from the extension), `content-length`, `accept-ranges: bytes`, `cache-control: no-cache`, a weak `etag`, `last-modified`. SVG also carries a restrictive CSP.
- No session needed: an unauthenticated `curl` of an uploaded file returned 200. Foundry serves data files to anyone who can reach the URL, so visibility must be enforced by the tool, not the server.
- Stream cutoff: `response.body.getReader()`, accumulate `value.length`, call `reader.cancel()` past N bytes. Granularity is one network chunk: v13 returned about 20 KB of a 64 KB file on the first read, v14 returned the whole 64 KB in the first read, so the cap check must also use `content-length` first and then enforce N+chunk.
- Downscale: `createImageBitmap(blob)` plus `OffscreenCanvas.convertToBlob` for `image/jpeg` and `image/webp` both worked in the headless Chrome runner on v13 (a 950x420 64,681-byte PNG became a 256-wide JPEG of 3,445 bytes or WebP of 6,280 bytes). Recommendation: downscale to at most 1024 px on the long edge and re-encode to JPEG (use WebP only if the client supports it; JPEG is the safest); refuse only non-decodable data and files over the fetch cap (e.g. 4 MB source). SVG: rasterise through `createImageBitmap` is not reliable for SVG blobs (untested), so refuse SVG in `image_view` or mark it "unsupported".
- The client-side collections contain documents the user cannot see: player1 holds `Actor` objects with ownership NONE (level 0), a hidden Token (`hidden: true`) and a non-visible Scene in `game.actors`, `scene.tokens` and `game.scenes`. So "exists in the collection" is NOT a visibility test. Use:
  - Actor portrait and prototype token: `actor.testUserPermission(user, 'LIMITED')` (level >= 1). Observed: level 0 -> false; a LIMITED actor reports level 1; OWNER 3.
  - Placed token: scene visible (below) AND (`!token.hidden || token.isOwner`) AND the token's actor LIMITED if the image shown is the actor's. The hidden token was returned in `scene.tokens` to the player, so `hidden` must be checked explicitly.
  - Scene background: `scene.visible`, which Foundry defines as `testUserPermission(game.user, 'LIMITED')`. A scene with `navigation: true` but default ownership NONE was NOT visible to player1 (level 0, `visible` false), so navigation alone is not enough; it is ownership (LIMITED or higher, the default for typical scenes) plus the active/navigation state shown in the UI.
- v14 gave the same results: an ownership-NONE actor and the hidden token are present in the player's collections (levels 0, `hidden: true`, `isOwner: false`), and neither a navigation scene nor a plain scene was `visible` to player1. The rules above hold on v14; for a scene's background on v14 read `scene.background.src` after the `visible` check.

### MCP image content (for 122 and 123): live clients
Not run. Every row stays "unverified" (see Part A).

## What I created, and cleanup
Documents, all named `ag-spike-52-...`, each deleted by exact id (a name-prefix check afterwards found none left):
- v13: Scene `mxwzM2QXJ3Mc9Np6` (embedded tokens `uEYsQfriIavAMI2A`, `aglGqcXjSGYEM55M`, tile `u8Kt27pBQKPqY7Bt`), Scene `gfKzNALbOKc824RP`, Actors `q8fhbBQkytJDY7J6`, `yU5yHjv3IOkr9AGF`, `M6HDSJJNm28hN2od`.
- v14: Scene `xTOZpksqwyoQm4wg` (embedded tokens `x7NmHEbiTapFp9SJ`, `QDcgIE8Al61wG0xD`, tile `Lzbj8Y3l3CWbejRK`), Scene `vsq4XEXKSEyhUDL9`, Actors `MiMMNP5f007tZyb3`, `JWNquuln87TFBf3R`, `5GdV8xhE769KYm9b`.
Files cannot be deleted through Foundry's API; these remain and need manual removal:
- v13: `agent-gateway/uploads/ag-spike-52/` with `ag-spike-52-a.png`, `-B.PNG`, `-s.svg`, `-w.webp`, `-t.txt`, `-m.png`, `-x.png`; the new parents `agent-gateway/` and `agent-gateway/uploads/`; and the stray `ag-spike-52-tt.png` in the Data root.
- v14: `agent-gateway/uploads/ag-spike-52/` with `ag-spike-52-a.png`, `-s.svg`, `-m.png`, `-x.png`; the new parents `agent-gateway/` and `agent-gateway/uploads/`.
No existing document or setting was changed on either version.

## Proposed arguments and caps (provisional until v14 and the client rows are filled)
- 53 `image_upload`: args `{ name, mimeType, data (base64) }`; raw cap 512 KiB; extension allow-list png jpg jpeg webp gif avif (svg refused); magic-byte check; server-side unique name `<sha256-prefix>-<name>`; target `agent-gateway/uploads/<userId>/`; create each directory level; treat `false`/`undefined`/`{}` as failure; approval and audit carry `{name, bytes, sha256}`.
- 121 `image_assign`: args `{ document, id, field, path }`, with `field` one of the five verified paths (v14 Scene background is a Level update, see above); path must be under `agent-gateway/uploads/` or a browsed path; rely on Foundry's update permission check.
- 120 helpers: path validator above; `browse` cap results (no server paging); the upload and browse paths require `FILES_UPLOAD` / `FILES_BROWSE` and should report a clear `FORBIDDEN` for Players.
- 122 result frame: image block `{type:'image', data, mimeType}` beside the text block, `structuredContent` free of base64; the link `ResultMessage` needs an image field; frame ceiling 786,162 raw bytes.
- 123 `image_view`: raw cap 512 KiB after downscale to 1024 px JPEG; source cap 4 MB; visibility tests above.
