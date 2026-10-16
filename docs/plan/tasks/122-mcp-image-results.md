# 122 — Carry image content from module tool results to MCP clients

**Repo:** .
**Status:** Ready to start once 52 and 120 are merged (owner decision, 2026-10-16)
**Depends on:** 52, 120
**Owns:**
- protocol/src/link/messages.ts (insertion only: an optional `images` field on `ResultMessage`)
- protocol/src/link/version.ts
- protocol/test/link/result-images.test.ts (new)
- module/src/ops/types.ts (insertion only: an optional `images` field on `OpResult`)
- module/src/link/client.ts (insertion only: an optional `images` field, of the protocol's `ResultMessage` image type, on the `CallResult` success branch; and the `dispatch` result reply, including its `ResultMessage` validation and version gate; added by Amendments 1 and 3. Amendment 3 also allows one private field holding the gateway's `welcome.protocolVersion`, set in the `case 'welcome'` handler beside `this.gatewayVersion = msg.gatewayVersion` and cleared in `setState` beside `this.gatewayVersion = null`; no other edit to either)
- module/src/link/bridge.ts (the `installBridge` call handler's success return only)
- module/test/link/result-images.test.ts (new)
- gateway/src/link/registry.ts (`CallResult` only)
- gateway/src/link/server.ts (the `case 'result'` settle only)
- gateway/src/mcp/session.ts (the module-tool success return only)
- gateway/test/mcp/image-results.test.ts (new)
- gateway/test/link/result-images.test.ts (new)
- protocol/test/link/link.test.ts:142 and :260 (Amendment 2: change the hard-coded protocol version assertion `toBe('7.0.0')` to `7.1.0`; no other edit)
- protocol/test/link/vouch.test.ts:8 (Amendment 2: change the hard-coded protocol version assertion `toBe('7.0.0')` to `7.1.0`; no other edit)
- module/test/link/client.test.ts:259 (Amendment 2: change the hard-coded `protocolVersion: '7.0.0'` assertion to `7.1.0`; no other edit)

Overlap: tasks 18, 35b and 36 also list some of these files but are not active; if one becomes
active, it lands after or rebases onto this one. Of the open tasks, only 36 also lists
module/src/link/client.ts, and only for its pairing-confirmation messages, not `CallResult`
(checked for Amendment 1). No open task owns protocol/test/link/link.test.ts,
protocol/test/link/vouch.test.ts or module/test/link/client.test.ts (checked for Amendment 2).
For Amendment 3, the only new edit is the welcome-version field in client.ts; of the open tasks,
109 lists client.ts only as context and out of scope, 106 rules it out of scope, and 36 (deferred)
owns it for pairing-confirmation messages only, so nothing overlaps.
109 requires the existing module/test/link suites to pass unmodified by its own diff; once this
task has merged, client.test.ts:259 reads `7.1.0` on main and 109 rebases onto it unchanged.

## Goal
Today every tool result reaches the MCP client as one text block. This task lets a module tool
return up to one image alongside its text, and the gateway turn it into an MCP `image` content
block. It adds no tool; 123 is the first user.

## Context
- The task 52 findings file (spikes/image-upload/) gives the SDK's image content type, client support and the raw-byte cap that fits a frame.
- protocol/src/link/messages.ts:9 `MAX_FRAME_BYTES`; :74-80 `ResultMessage`.
- protocol/src/link/version.ts:4 `PROTOCOL_VERSION = '7.0.0'`; `checkCompat` accepts any minor within a major.
- gateway/src/link/server.ts:215 — `maxPayload: MAX_FRAME_BYTES`: an oversize frame closes the whole link.
- gateway/src/link/server.ts:456-462, gateway/src/link/registry.ts:15-18, gateway/src/mcp/session.ts:503-515 — the result path.
- gateway/src/link/server.ts, the `!parsed.ok` branch with `conn` set — the gateway closes the whole link (`ws.close(1008)`) on any result frame it cannot parse (Amendment 3).
- module/src/link/client.ts `case 'welcome'` and `setState` — where `gatewayVersion` is stored and cleared; the welcome frame also carries `protocolVersion` (Amendment 3).
- module/src/link/client.ts:11-13 `CallResult` (the module's own union; its success branch is `{ ok: true; text: string; structured?: unknown }`); :901-937 `dispatch`; module/src/link/bridge.ts:84-103; module/src/ops/types.ts:36-39 `OpResult`.
- module/src/audit/stage.ts:254 — audit keeps only the first text line of a result.
- protocol/src/images/** (task 120) — `IMAGE_MIME_TYPES` and `sniffImage`.

## Acceptance
- [ ] `ResultMessage` gains optional `images`: an array of at most 1 `{ mimeType, data }`, where `mimeType` is one of `IMAGE_MIME_TYPES` and `data` is base64 with a `maxLength` derived from the 52 cap. `PROTOCOL_VERSION` becomes `7.1.0` with a one-line comment. Protocol tests cover an accepted frame, `image/svg+xml`, two images and non-base64 data.
- [ ] The module copies `OpResult.images` into the result frame. Before sending, it measures the UTF-8 byte length of the serialized frame; above `MAX_FRAME_BYTES` it sends an error frame (`INVALID_ARGS`, message giving the byte size) instead, so the link never closes. A module test covers both cases.
- [ ] (Amendment 1) The `CallResult` success branch in module/src/link/client.ts gains optional `images`, typed as the protocol's `ResultMessage` image type (no other change to the union). A type-level or unit test in module/test/link/result-images.test.ts proves `dispatch` forwards `images` from a handler's `CallResult` into the result frame, and that a `CallResult` with no `images` produces a result frame byte-identical to today's (no `images` key, not `images: undefined` or `[]`).
- [ ] The gateway re-checks every image: it decodes `data` and requires `sniffImage` to equal `mimeType`; otherwise the call fails with `INTERNAL` and no image is returned. A gateway test covers a mismatched magic number and SVG bytes labelled `image/png`.
- [ ] A successful MCP `tools/call` with an image returns `content: [{ type: 'text', ... }, { type: 'image', data, mimeType }]`, plus `structuredContent` equal to the module's `structured` whenever the module sent one (Amendment 2). Results without images are byte-identical to today; the existing gateway/test/mcp/** tests pass unchanged.
- [ ] (Amendment 2) Whether a result carries `structuredContent` depends only on whether the module sent `structured`, never on whether images are present. A gateway test in gateway/test/mcp/image-results.test.ts covers a module result with an image and no `structured`: the response has the text and image blocks and no `structuredContent` key (not `{}` or `null`). Assert it on the raw `tools/call` response, or without a prior `listTools`, because the SDK client rejects such a result for a tool listed with an `outputSchema`.
- [ ] (Amendment 2) No image `data` ever appears in `structuredContent`: the image test asserts that `JSON.stringify(res.structuredContent)` does not contain the base64 string.
- [ ] Image bytes never appear in logs, the audit (module or gateway), the offline queue or events: `rg -n "images" gateway/src/offline-queue gateway/src/events module/src/audit` shows no new matches, and a test asserts the audit entry for an image result has no base64.
- [ ] (Amendment 3a) Before sending, `dispatch` validates the complete result frame with the protocol's `ResultMessage` schema (`safeParse`) as well as checking its byte size. On a validation failure it sends an ordinary error result for that call only (`INVALID_ARGS`, with a message naming the problem and never containing the image data) and the link stays open. module/test/link/result-images.test.ts covers each of: `images[0].data` of 700,000 base64 characters (over `MAX_RESULT_IMAGE_BASE64_CHARS` 699,052, under `MAX_FRAME_BYTES`), two images, and `mimeType: 'image/gif'` from an untyped handler; each yields an `INVALID_ARGS` error result whose message does not contain the data, and the link is still open afterwards.
- [ ] (Amendment 3b) The module sends `images` only when the gateway's `welcome.protocolVersion` is 7.1.0 or later. Against an older gateway it sends the text (and `structured`, if any) without an `images` key, plus one extra text line saying an image was omitted because the gateway is too old (wording up to the implementer; no image data). Tests: after a `7.0.0` welcome the frame has no `images` key, has the extra line, and parses under a 7.0-style strict `ResultMessage` schema defined in the test (today's schema without `images`); after a `7.1.0` welcome the frame carries `images`.
- [ ] `npm run verify` passes
- [ ] (Amendment 2) `npm run verify` passes with protocol/test/link/link.test.ts:142 and :260, protocol/test/link/vouch.test.ts:8 and module/test/link/client.test.ts:259 (all 12 parametrised cases) asserting `7.1.0`. `git diff` for those three files shows only those four lines changed.

## Out of scope
- The `image_view` tool and reading files (123)
- Image content for gateway-handled tools (`events_poll`, `events_history`, `gateway_status`)
- Raising `MAX_FRAME_BYTES`, `MAX_RELAY_LINE_BYTES` or `TOOL_LIMITS`
- Pack API support for returning images (module/src/packs/**)

## Amendment 1 (owner, 2026-10-16, from external PR review)

Reason: module/src/link/client.ts:11-13 defines its own `CallResult` union, whose success branch
is `{ ok: true; text: string; structured?: unknown }`. Adding `OpResult.images` and changing the
bridge return does not make `res.images` reachable in `LinkClient.dispatch`, so forwarding it is a
TypeScript error. The former Owns line ("the `dispatch` result reply only") left out the type
change this task needs.

Change: the client.ts Owns line now covers an insertion-only optional `images` field on the
`CallResult` success branch as well as the `dispatch` result reply. A new Acceptance item requires
a test that `dispatch` forwards `images` and that a result without images stays byte-identical.
The Context and Overlap notes are updated; no other open task owns `CallResult` (36 lists
client.ts for pairing-confirmation messages only).

## Amendment 2 (owner, 2026-10-16)

Reason, part 1: bumping `PROTOCOL_VERSION` to `7.1.0` breaks four hard-coded version assertions
in files this task did not own: protocol/test/link/link.test.ts:142 and :260 and
protocol/test/link/vouch.test.ts:8 (`toBe('7.0.0')`), and module/test/link/client.test.ts:259
(`protocolVersion: '7.0.0'`, run by 12 parametrised cases).

Change: Owns covers those exact lines, and the only permitted edit is changing the hard-coded
protocol version assertion to `7.1.0`. A new Acceptance item requires `npm run verify` to pass with
them updated. No other open task owns these files (see the Overlap note).

Reason, part 2: the implementer's finding overrides the task 52 recommendation
(spikes/image-upload/findings.md:48) to return image results without `structuredContent`. Every
announced tool has an `outputSchema` (gateway/src/mcp/session.ts:267 projects one for every
listed tool), and the MCP SDK client rejects a non-error result without `structuredContent` for
such a tool: "MCP error -32600: Tool fixture_tool has an output schema but did not return
structured content" (confirmed in a test).

Change: the gateway returns `content: [text, image...]` plus `structuredContent` whenever the
module sent `structured`, and never puts base64 in `structuredContent`. A module result with no
`structured` gets no `structuredContent`, with or without images. That is how 123's `image_view`
(which declares no MCP `outputSchema`; see 123 Amendment 1) returns only text and image. The
Acceptance items marked "Amendment 2" record this.

## Review round 1 — findings

- [P2] module/src/link/client.ts:939. `dispatch` checks only the serialized byte size before
  sending, never the `ResultImage` schema. The gateway closes the whole link (`ws.close(1008)`,
  gateway/src/link/server.ts, the `!parsed.ok` branch with `conn` set) on any result frame it
  cannot parse. Inputs that trigger it: `images[0].data` of 700,000 base64 characters (over
  `MAX_RESULT_IMAGE_BASE64_CHARS` 699,052 but under `MAX_FRAME_BYTES`), two images, or
  `mimeType: 'image/gif'` from an untyped handler. The link closes for every in-flight call.
  Route: orchestrator. Settled by Amendment 3(a).
- [P3] protocol/src/link/version.ts:4. `checkCompat` accepts a minor bump, but a 7.0 gateway's
  `ResultMessage` is a strict object, so a 7.1 module that sends `images` to a 7.0 gateway gets
  its link closed. `dispatch` ignores `welcome.protocolVersion`. Route: orchestrator. Settled by
  Amendment 3(b).
- [NOTE, optional] protocol/src/link/version.ts:3-4. The new JSDoc block sits directly under the
  v7 one, which detaches the v7 comment. Merge them or move one.

## Amendment 3 (owner, 2026-10-16, from review round 1)

Reason: the two review findings above. A malformed or oversize image in a result frame, or any
`images` sent to a 7.0 gateway, closes the whole link and fails every in-flight call.

Change (a): before sending, `dispatch` validates the complete result frame with the protocol's
`ResultMessage` schema (`safeParse`), in addition to the byte-size check. If validation fails it
sends a normal error result for that one call (`INVALID_ARGS`, with a message naming the problem
and never including the data) and keeps the link open. Tests cover each listed input; each one
gives an error result with the link still open. Task 123 still enforces the caps at the source;
this is defence in depth.

Change (b): the module sends `images` only when the gateway's `welcome.protocolVersion` is 7.1.0
or later. Against an older gateway it sends the text (and structured) part only, plus one extra
text line saying an image was omitted because the gateway is too old (exact wording up to the
implementer, no data included). Tests: a 7.0.0 welcome strips the images and the frame parses
under a 7.0-style strict schema; a 7.1.0 welcome sends them. A version-comparison helper, if one
is wanted, goes in protocol/src/link/version.ts, which this task already owns.

Owns: (b) needs the gateway's protocol version at `dispatch` time, and client.ts stores only
`gatewayVersion` today. The client.ts Owns line now also allows one private field for
`welcome.protocolVersion`, set in the `case 'welcome'` handler and cleared in `setState`, next to
the existing `gatewayVersion` lines. Everything else (the validation, the gate, the tests, the
optional JSDoc fix) falls within files already owned. Overlap re-checked: no open task owns those
parts of client.ts (see the Overlap note). Acceptance items marked "Amendment 3a" and "Amendment
3b" record this.
