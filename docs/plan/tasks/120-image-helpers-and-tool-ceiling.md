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
- [ ] `normalizeDataPath(input: string)` returns a canonical relative path or an error code (Amendment 2). The canonical form is Foundry's percent-encoded form. Input may be raw or percent-encoded. Per segment it percent-decodes exactly once (malformed escapes rejected), normalizes the decoded segment to NFC, rejects a decoded segment that is empty, `.` or `..`, made only of dots and/or spaces, or contains `/`, `\`, NUL or any control character, `%`, or any of `:*?"<>|`, then re-encodes it with `encodeURIComponent`. It also rejects: an empty string, a canonical form longer than 256 characters, a leading `/` or drive letter, any URL scheme (`https:`, `data:`, `file:`), and anything else the 52 findings list. Each rejection has a unit test. Required tests (Amendment 2):
  - raw `Token Art/Goblin 1.png` and encoded `Token%20Art/Goblin%201.png` normalize to the same canonical path;
  - `ag%20enc%20%C3%A9.png` is accepted, and an NFD-decomposed `é` input gives the NFC canonical form (`%C3%A9`);
  - `%2520` and a literal `%` are rejected; a malformed `%E0%A4` is rejected;
  - `..`, `%2e%2e`, `a/.. /b`, ` ` and `...` are rejected;
  - `@types` round-trips as `%40types`.
- [ ] `normalizeDataDir(input: string | undefined)` (Amendment 1) validates a directory for browsing. It returns `''` (the canonical Data root, as Foundry reports it with `target: ''`) for `''` or an omitted value, and for every other input runs exactly the checks of `normalizeDataPath`. `/`, `.` and `./` are rejected, not mapped to the root (the 52 findings, Part B rows "Leading `/`" and "Validator list for 120", say to refuse rather than let the server remap to the root). `normalizeDataPath`, which validates image FILE paths, still rejects `''`. Unit tests: `''` and `undefined` give `''`; `/`, `.` and `./` are rejected; `a/b` gives `a/b`; `../a` is rejected; the parent directory of a root-level image (`foo.png`) is `''` and `browseImages` accepts it.
- [ ] `isImagePath(path)` accepts only `IMAGE_EXTENSIONS`, case-insensitively, after `normalizeDataPath`, checking the extension on the decoded name (Amendment 2); `foo.svg`, `foo.png.svg`, `foo.SVG`, `foo`, `x.svg` and `x%2Esvg` are rejected in tests.
- [ ] module/src/tools/_image.ts exports a FilePicker resolver for v13 and v14 (per the 52 findings) and `browseImages(user, dir, limit)`, which:
  - refuses a non-GM user without `FILES_BROWSE` with `FORBIDDEN`, using Foundry's server-set user only;
  - calls `browse` on the `data` source only, after `normalizeDataDir` (not `normalizeDataPath`; Amendment 1), so `''` browses the Data root, and passes Foundry the canonical (encoded) form (Amendment 2);
  - validates each returned entry with the same functions; entries arrive already encoded, so decoding once must round-trip, and it never encodes an already-encoded string (Amendment 2). Where an entry fails to round-trip byte-for-byte (e.g. `encodeURIComponent` and Foundry differ on `()!*'`), it compares by decoded+NFC form and keeps Foundry's string as the canonical one;
  - returns at most `limit` entries (hard maximum 200) of `dirs` and `isImagePath` files, each as a canonical path plus a decoded display name, plus `truncated: boolean`.
  - (optional, review NOTE ii) maps errors thrown by `browse()` to `WriteError` `NOT_FOUND` or `INVALID_ARGS`, and to `FORBIDDEN` on a permission message, instead of letting a plain `Error` escape.
  - (optional, review NOTE iii) has a doc comment, and this acceptance text records, that callers must pass `trustedUser(ctx)` from module/src/tools/_write.ts as `user`; `browseImages` trusts the user it is given.

  Unit tests use FilePicker stubs and cover a player without `FILES_BROWSE`, a GM, a traversal input that never reaches the stub, a `''` input that reaches the stub as the Data root, a `/` input that never reaches the stub, truncation at the cap, and a browse stub returning encoded entries that lists a file inside a `Token Art` folder (Amendment 2). If NOTE ii is taken, a test covers the error mapping.
- [ ] `npm run verify` passes

## Out of scope
- Any tool definition or handler (53, 121, 123)
- Changes to link messages, the gateway or MCP results (122)
- Fetching file bytes over HTTP (123 owns that, in its own file)
- Raising `TOOL_LIMITS` or `MAX_FRAME_BYTES`

## Amendment 1 (owner, 2026-10-16, from external PR review)

Reason: browsing the Data root had no valid input. `normalizeDataPath` rejects `''`, `/` and `.`
segments, `browseImages` validated every directory through it, and 121's `list` defaults `dir` to
the Data root, which Foundry represents as `''` (52 findings, Part B, `..` row: "the Data root
listing with `target: ''`"). So the default `list` call could never succeed.

Change: a separate directory validator, `normalizeDataDir`, accepts `''` (and an omitted value)
as the canonical root and otherwise applies every `normalizeDataPath` check; `/`, `.` and `./`
stay rejected, as the 52 findings require. `browseImages` uses `normalizeDataDir`.
`normalizeDataPath` is unchanged for file paths and still rejects `''`. The Acceptance list above
is updated to match. Owns is unchanged (the new function lives in protocol/src/images/**, its
tests in protocol/test/images/**).

## Review round 1 — findings

- **[P2]** (route: orchestrator → settled by Amendment 2) `browseImages` runs Foundry's browse
  output through `isImagePath`, which rejects any `%`. Foundry percent-encodes paths, so any file
  or folder with a space would be dropped or could not be browsed.
- NOTE (i) (optional): `SEGMENT` allows dot/space-only names. Now covered by the new segment rule
  in Amendment 2.
- NOTE (ii) (optional): errors from `browse()` escape as a plain `Error`. Map them to `WriteError`
  `NOT_FOUND` or `INVALID_ARGS`, and `FORBIDDEN` on a permission message; add a test.
- NOTE (iii) (optional): `browseImages` trusts its user. Add a doc line and acceptance text saying
  callers must pass `trustedUser(ctx)` from module/src/tools/_write.ts.

## Amendment 2 (owner, 2026-10-16, from review round 1 + live check)

Reason: the [P2] finding above. A live check settled it, with identical results on v13.351 and
v14.369:

- `browse()` returns `dirs`, `files` and `target` percent-encoded with UTF-8, e.g.
  `agent-gateway/uploads/ag-enc%20120%20%C3%A9/ag%20enc%20%C3%A9.png`. `@` comes back as `%40`.
- `upload()` returns the `path` encoded, while its message text is raw.
- `browse()` accepts its `dir` either raw (`ag-enc 120 é`) or encoded, but a raw NFD-decomposed
  `é` throws "does not exist".
- `fetch` and `<img>` work with the encoded form and with the raw form, but a double-encoded path
  (`%2520`, `%25C3%25A9`) gives 404.
- Foundry's own FilePicker hands its callback, and so the document field, the ENCODED path.

Change: this replaces the old "reject any `%`" rule and the `[A-Za-z0-9._ -]` segment rule.

- Canonical form = Foundry's encoded form, which is what Foundry stores and returns.
- `normalizeDataPath` and `normalizeDataDir` accept input either raw or percent-encoded. Per
  segment:
  - percent-decode exactly once, and reject malformed escapes;
  - normalize the decoded segment to NFC;
  - reject a decoded segment that is empty, `.` or `..`, made only of dots and/or spaces, or
    containing `/`, `\`, NUL or any control character, `%` (so double-encoding and a literal `%`
    are refused), or any of `:*?"<>|`;
  - re-encode the segment with `encodeURIComponent` to produce the canonical form.
- The other existing checks stay: length ≤ 256 (applied to the canonical form), no leading `/` or
  drive letter, no URL scheme, and `normalizeDataDir`'s `''` meaning the root.
- `isImagePath` checks the extension on the decoded name, case-insensitive, still PNG/JPEG/WebP
  only.
- `browseImages` validates the requested dir with `normalizeDataDir` and passes Foundry the
  canonical form; validates each returned entry with the same functions (entries arrive already
  encoded, so decoding once must round-trip); returns canonical paths plus a decoded display name
  for each entry; and must NEVER encode an already-encoded string.
- Equality compares canonical forms. `encodeURIComponent` and Foundry may differ on characters
  like `()!*'`; if an entry from browse fails to round-trip byte-for-byte, compare by decoded+NFC
  form and keep Foundry's string as the canonical one.
- Required tests: raw `Token Art/Goblin 1.png` and encoded `Token%20Art/Goblin%201.png` normalize
  to the same canonical path; `ag%20enc%20%C3%A9.png` works, and an NFD `é` input gives the NFC
  canonical form; `%2520` and a literal `%` are rejected; a malformed `%E0%A4` is rejected; `..`,
  `%2e%2e`, `a/.. /b`, ` ` and `...` are rejected; `@types` round-trips as `%40types`; a browse
  stub returning encoded entries lists a file in a `Token Art` folder; `isImagePath` rejects
  `x.svg` and `x%2Esvg`.

The Acceptance list above is updated to match. Owns is unchanged.
