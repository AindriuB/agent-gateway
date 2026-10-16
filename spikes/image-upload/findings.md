# Task 52 findings: image upload spike

Status: PARTIAL. Part A (static, no Foundry) is done. Part B (live v13.351 and v14.369) is NOT done:
the test-world passwords were not set when the spike reached the live checks. Every item in Part B is
"unverified" and its architect assumption stands until a live run answers it.

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

## Part B. Live checks still to run (all unverified)
Each item in the task's Acceptance list under Upload, Browse and assign, Reading bytes and visibility, and the live client rows. Requires: `FOUNDRY_GM_PASSWORD`, `FOUNDRY_PLAYER_PASSWORD` in the test env file, then a Playwright login to each version. Throwaway documents use the `ag-spike-52-` prefix and are deleted by id. Nothing was created in any world so far.
