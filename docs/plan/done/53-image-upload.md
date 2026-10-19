# 53 — Add an image upload tool for maps, portraits and token art

**Repo:** .
**Status:** Ready to start once 52 and 120 are merged (owner decision, 2026-10-16)
**Depends on:** 52, 120, 121 (Amendment 2 only: `Level` in the undo classes; see Amendment 1)
**Owns:**
- protocol/src/tools/image-upload.ts (new)
- protocol/src/tools/index.ts (insertion only)
- protocol/test/tools/image-upload.test.ts (new)
- protocol/test/tools/rules/validate.test.ts (insert one `image_upload` example only)
- module/src/tools/image-upload.ts (new)
- module/src/tools/index.ts (insertion only)
- module/test/tools/image-upload/** (new)
- module/test/stubs/** (insertion only)
- e2e/image-upload/** (new)
- e2e/vitest.e2e.config.ts (insert one `image-upload/**/*.e2e.test.ts` line only)
- protocol/src/tools/define.ts (Amendment 1: one optional `redactArgs` field on `ToolDefinition` only)
- module/src/ops/registry-class.ts (Amendment 1: the same optional field on `RegistryEntry`, so `ToolInfo` carries it; nothing else)
- module/src/ops/core-tools.ts (Amendment 1: copy the field in `coreEntry` at `:6-22` only)
- module/src/ops/redact.ts (new; Amendment 1)
- module/src/approvals/manager.ts (Amendment 1: only the hash and stored args in `request` at `:376` and `:418`, and the hash in `bindsTo` at `:290`)
- module/src/audit/stage.ts (Amendment 1: the `boundedJson(ctx.args)` call in `record` at `:314` only)
- module/test/ops/redact.test.ts (new; Amendment 1)
- module/test/approvals/redaction.test.ts (new; Amendment 1)
- module/test/audit/redaction.test.ts (new; Amendment 1)

Overlap (before Amendment 1): none with 47-51 or 121-123 apart from the insertion-only shared files above (both registries, validate.test.ts, e2e/vitest.e2e.config.ts). It does not own protocol/test/tools/tool-count.test.ts (120 raises the ceiling) and only imports from protocol/src/images/** and module/src/tools/_image.ts (owned by 120).

## Goal
Let an agent upload one image per call into a fixed, server-named location. In the same call it
can set an Actor's portrait and/or prototype token art. A GM may also set a scene background.
This replaces manual file handling when building maps and characters. There is no URL fetching
(no SSRF), no SVG, and the module never decodes the image.

## Context
- The task 52 findings file (spikes/image-upload/) supplies the confirmed FilePicker path, permissions, extensions and the usable payload size. Replace the caps below with the spike's numbers if they are lower.
- protocol/src/link/messages.ts:9 sets `MAX_FRAME_BYTES = 1 MiB`.
- protocol/test/tools/tool-count.test.ts:6-7: today there are 22 player and 34 GM tools; task 120 raises the ceilings so this tool and 121 and 123 all fit.
- protocol/src/images/** and module/src/tools/_image.ts (task 120): use the shared magic-byte sniffer, MIME allowlist and FilePicker resolver; do not re-implement them.
- gateway/src/mcp/session.ts:503-515: results are text content only today; 122 adds image blocks, which this tool does not use.

## Acceptance
- [ ] A new tool `image_upload` (minRole `player`, category `write`) takes:
  - `data`: base64, with a declared `maxLength` for about 700 KiB raw, or the spike's lower number
  - `mime`: enum `image/png|image/jpeg|image/webp`
  - optional `actorUuid` with `setPortrait` and `setToken` booleans
  - optional `sceneUuid` with `setBackground`

  There is no URL argument. `conservativeProblems` is `[]`.
- [ ] Before upload, the decoded bytes (checked with 120's sniffer) must start with the PNG, JPEG or WebP magic bytes that match `mime`, and the raw size must be within the cap. Otherwise INVALID_ARGS. Unit tests cover SVG text, a mismatched magic number, oversize input and bad base64. The module never constructs an Image or canvas from the data (`rg -n "new Image|createImageBitmap|getContext" module/src/tools/image-upload.ts` is empty).
- [ ] Storage goes to a fixed per-user directory (`agent-gateway/uploads/<userId>/`) under a server-generated filename (`<24 hex random>-<decoded bytes>.<ext>`, extension derived from `mime`; Amendment 1). Caller text never reaches the path. Each user has a total byte cap of 64 MiB, `IMAGE_UPLOAD_USER_QUOTA_BYTES = 64 * 1024 * 1024` in protocol/src/tools/image-upload.ts (Amendment 1; was 8 MiB), and exceeding it returns INVALID_ARGS. Unit-tested, including an upload that fits under 64 MiB but would have exceeded 8 MiB.
- [ ] Permissions:
  - A player may upload only when Foundry grants that user `FILES_UPLOAD`.
  - A player may set only `img` and `prototypeToken.texture.src`, and only on an Actor they OWN.
  - A GM may target any Actor and a scene background (`sceneUuid`).

  Identity comes only from the server-set user. Unit tests cover a player with no upload permission, a player on a non-owned Actor, and a player sending `sceneUuid`.
- [ ] One call means one approval and one audit entry. The approval and audit show size, mime, SHA-256 and target fields, never the base64 payload (mechanism and tests: Amendment 1). Actor and Scene updates are snapshotted and carry `callOptions`, and Undo restores the previous `img`/texture/background. The uploaded file itself is not deleted by Undo, and the result says so.
- [ ] Native acceptance on v14 and v13 (`AGENT_GATEWAY_E2E_UPLOAD=1`):
  - A GM uploads a PNG and sets a temporary scene background.
  - A player sets the portrait and token of an Actor they own.
  - A player is refused on another user's Actor.

  Temporary documents are removed by exact UUID. Native execution needs the repository owner's per-run approval.
- [ ] `npm run verify` passes

## Out of scope
- MCP image content blocks in gateway results (task 122) and viewing images (task 123)
- Browsing or assigning existing files (task 121)
- Changing protocol/test/tools/tool-count.test.ts, protocol/src/images/** or module/src/tools/_image.ts (task 120; stop and report if a helper is missing)
- URL fetching, SVG, image resizing or decoding
- Deleting uploaded files

## Amendment 1 (owner, 2026-10-16)

### A. Payload redaction is in scope

Today the approval and audit views would show the payload. The audit record stores
`boundedJson(ctx.args)` (module/src/audit/stage.ts:314, module/src/audit/record.ts:34-87), which
keeps the first `argsString` characters of every string, so the start of the base64 `data`
appears. The approval record stores `ctx.args` whole (module/src/approvals/manager.ts:418). It is
persisted to client storage, relayed to GMs over the socket (`toPayload`, `:210-224`, `:690`),
exposed on the `agentGateway.approvalRequested` hook (`:449`, `:809`) and rendered by
module/src/apps/approval/index.ts:63 and `:73`. A payload of about 700 KiB also fails `reviewable`
(module/src/apps/approval/model.ts:8), so the dialog shows "too large" and refuses Approve
(module/src/apps/approval/controller.ts:77). Handlers cannot fix this themselves:
`OpHandler.admit` (module/src/ops/dispatch.ts:108-137) is the only hook that rewrites args and it
requires a native GM, and `prepare` is pure.

Add a minimal core mechanism:

- A tool definition may declare `redactArgs: readonly string[]`, the top-level base64 fields to
  redact (protocol/src/tools/define.ts). `coreEntry` copies it into the registry entry. Pack tools
  cannot declare it. `image_upload` declares `['data']`.
- module/src/ops/redact.ts exports a pure, synchronous function that takes a tool's registry info
  and args, and returns a review view. Each declared field is replaced by
  `{ redacted: true, bytes, sha256 }`, where `bytes` is the decoded length and `sha256` is the hex
  SHA-256 of the **decoded bytes**. A field that is not valid base64 becomes
  `{ redacted: true, chars }` and its text is never included. For a tool that declares nothing, the
  function returns its input unchanged (the same reference). It must work without `crypto.subtle`,
  which Foundry served over plain http does not have (module/src/approvals/canonical.ts:24-27). Use
  a pure-JS byte hash that sits beside `sha256Hex` in redact.ts, or that redact.ts exports; do not
  edit canonical.ts.
- The approval manager computes `hash` and stores `args` from the redacted view (`:376`, `:418`)
  and compares `bindsTo` against `callHash(ctx.tool, redacted(ctx.args))` (`:290`). The stored,
  persisted, relayed, hooked and rendered args are therefore all redacted, and the remote check
  `argsHash === callHash(tool, args)` (`:769`) and the load check (`:103`) still hold without being
  edited. The binding still covers the payload because the view contains its SHA-256. Execution
  still uses the live `ctx.args`, never the record (`:502`).
- The audit stage records `boundedJson(redacted(ctx.args))` (stage.ts:314).
- This applies to every caller role, player and GM alike.

Acceptance (Amendment 1):
- [ ] module/test/approvals/redaction.test.ts drives an `image_upload` call through the approval
  manager as a player and as a GM, with a payload whose base64 contains a unique marker substring
  of at least 64 characters. The marker, and every 16-character window of the base64, is absent
  from `JSON.stringify` of: the stored record, the persisted storage value, the emitted
  `approval.request` frame, both `approvalRequested` hook payloads, and `requestView(...)`. The
  request is `reviewable` and can be approved.
- [ ] module/test/audit/redaction.test.ts shows the same absence in the submitted audit record's
  `args`, which contains `"bytes":<decoded length>` and the SHA-256.
- [ ] module/test/ops/redact.test.ts asserts that `sha256` equals the SHA-256 of the decoded bytes
  (a known vector, e.g. the bytes `abc` encoded as `YWJj` give `ba7816bf...15ad`), and that it is
  not the hash of the base64 text.
- [ ] Unchanged elsewhere: for every core tool other than `image_upload` in `TOOLS`, and for a
  pack tool, the redaction function returns its input (`toBe`), `callHash` is unchanged, and the
  audit `boundedJson` text equals the pre-change text for a fixed sample of args (test).
- [ ] An approval granted for one payload does not bind a call with a different payload (a
  different `sha256`) (test).
- [ ] The `sha256` that `image_upload` returns equals the one shown in its approval and audit. The
  tool uses the same synchronous hash, so it no longer depends on `crypto.subtle`
  (module/src/tools/image-upload.ts:35-38 today).

Overlap from these Owns additions:
- **109** (Ready) owns module/src/approvals/manager.ts for the pending-record lookup and waiter
  reattachment. The regions are different but in the same file: do not run 53 and 109 in parallel.
  Whichever merges second rebases.
- **112** (BLOCKED on decision) provisionally owns module/src/approvals/** and
  module/test/approvals/**. It depends on 109 and is not started. If it is unblocked while 53 is
  open, it must follow 53, and its persistence must keep storing the redacted args.
- **44** (Queued) owns module/src/audit/** and module/test/audit/**, which include stage.ts:314
  and the new module/test/audit/redaction.test.ts. 44 is not in flight. If it starts first, 53
  follows it.
- **122** owns module/src/ops/types.ts (insertion). 53 deliberately does not touch types.ts: the
  declaration lives on the tool definition, not on `OpHandler`. There is no overlap.
- **121** owns module/src/ops/context.ts and, by its Amendment 2, module/src/audit/undo-classes.ts.
  53 touches neither.
- **18** owns module/src/ops/stages.ts (insertions), which 53 does not touch. No other open task
  owns protocol/src/tools/define.ts, module/src/ops/registry-class.ts, module/src/ops/core-tools.ts
  or module/src/ops/redact.ts.
- Open 102-114 range: only 109 and 112 above. 104, 106, 111, 113 and 114 own gateway, link and docs
  files that 53 does not touch.

### B. Per-user quota is 64 MiB

`IMAGE_UPLOAD_USER_QUOTA_BYTES` becomes `64 * 1024 * 1024`. It was implemented as 8 MiB. The
storage acceptance item above is updated.

### C. Accepted design (do not flag in review)

- Filenames are `<24 hex random>-<decoded bytes>.<ext>`. The size is in the name so the quota can be
  computed from `browse`, which returns no sizes.
- The quota check needs `FILES_BROWSE`. A player with `FILES_UPLOAD` but not `FILES_BROWSE` gets
  FORBIDDEN.
- A file in the user's directory whose name does not parse counts at the 512 KiB per-file cap
  (`IMAGE_UPLOAD_MAX_BYTES`).
- On v14 the scene background is set with `scene.updateEmbeddedDocuments('Level', ...)` on the
  scene's first Level. On v13 it is set with `scene.update({'background.src'})`.

### D. Undo of the v14 Level background depends on 121

Undo restores a v14 background only if `Level` is in the undo classes. Task 121's Amendment 2 adds
it to module/src/audit/undo-classes.ts, which 53 does not own. 53 now depends on 121 for that
change. If 53 has to merge first, the v14 scene-background Undo check in the native acceptance is
deferred until 121 merges, and the PR must say so. The v13 path and the Actor portrait and token
Undo do not depend on 121.

### Out of scope (Amendment 1)
- Redacting nested or array fields, and anything beyond base64 strings
- Pack tools declaring `redactArgs`
- The gateway's offline queue (gateway/src/offline-queue/**), which stores call args so it can
  replay them (owned by 112 if it proceeds), and gateway logs
- Editing module/src/apps/approval/**, module/src/audit/record.ts or
  module/src/approvals/canonical.ts. The redacted view reaches them through the paths above.

## Amendment 2 (owner, 2026-10-16)

### Why

Task 121's review found that the native player e2e cannot pass on the documented test bed.
player1 has role PLAYER (1), and the world's defaults put `FILES_BROWSE` at Trusted (2) and
`FILES_UPLOAD` at Assistant (3) (spikes/image-upload/findings.md:63-64). `image_upload` needs
`FILES_UPLOAD`, and its quota check also needs `FILES_BROWSE` (Amendment 1 C). The owner chose
the same fix for both suites: grant, then restore. Task 121's Amendment 3 records it for
121's e2e; this amendment mirrors it for e2e/image-upload/**, which is already in Owns. No other
file is added to Owns.

### The native suite (e2e/image-upload/**)

- **Snapshot, then grant.** In `beforeAll`, as the GM, read the world's file-permission setting
  and keep the exact value. Task 121 assumes the key is `core.permissions` and asserts that it
  reads back as an object; do the same, and confirm the key on the native run. Then grant
  `FILES_UPLOAD` and `FILES_BROWSE` to the PLAYER role for the run.
- **Always restore.** In `afterAll`, restore the exact snapshot whether or not the tests passed,
  then read the setting back and assert that it equals the snapshot.
- **Wait for the grant.** In the player's browser, poll `game.user.can('FILES_UPLOAD')` and
  `game.user.can('FILES_BROWSE')` until both are true, bounded at about 10 s. If they never become
  true (for example because v14's `requiredRoles` blocks granting them to a Player), skip the
  player cases with a stated reason that names the Foundry version. Do not fail them.
- **Ownership refusal is specific.** With the grant in place, "a player is refused on another
  user's Actor" asserts the OWNERSHIP refusal: FORBIDDEN, with a message that does not mention any
  `FILES_*` permission.
- **Missing-permission cases.** Add separate native tests that each remove one grant, and re-grant
  in a `finally` block:
  - without `FILES_UPLOAD`: FORBIDDEN, with a message naming `FILES_UPLOAD`;
  - with `FILES_UPLOAD` but without `FILES_BROWSE`: FORBIDDEN, with a message naming
    `FILES_BROWSE` (the quota rule).
- **Uploaded files.** Files uploaded during the native run land under
  `agent-gateway/uploads/<userId>/`. Foundry's API cannot delete files, so the operator deletes
  them afterwards. The run report lists every uploaded path.
- The native run still needs the repository owner's per-run approval.

Acceptance (Amendment 2):
- [ ] e2e/image-upload/** snapshots the file-permission setting in `beforeAll`, asserts it reads
  back as an object, grants `FILES_UPLOAD` and `FILES_BROWSE` to PLAYER, and in `afterAll` restores
  the snapshot and asserts the read-back equals it (visible in the diff).
- [ ] The player cases wait, bounded at about 10 s, for both `game.user.can` checks in the
  player's browser, and skip with a reason naming the Foundry version if the grant never takes
  effect.
- [ ] The non-owned-Actor case asserts FORBIDDEN with a message that matches no `FILES_`
  permission name.
- [ ] Two separate native tests cover the missing `FILES_UPLOAD` and the missing `FILES_BROWSE`
  refusals, each asserting FORBIDDEN and the named permission, each re-granting in `finally`.
- [ ] The native run report confirms the `core.permissions` key (or names the actual key), states
  which player cases ran or were skipped on v14 and v13, and lists the uploaded file paths for the
  operator to delete.

### Out of scope (Amendment 2)
- Changing world permission settings anywhere outside the native e2e run, or leaving the grant in
  place after it
- Changing `image_upload`'s permission rules; the unit-tested behaviour in the Permissions
  acceptance item and Amendment 1 C stands
- Deleting uploaded files from code
- Task 121's e2e (its own Amendment 3)

## Review round 1 — findings

Reviewed HEAD: a982023e9d42403409ac21afbe2b56c95b1f33c4

- [STYLE] module/test/events/native-serialization-probe.mts:7 — Commit 8efe35e reformats this file, which is outside 53's Owns. It only rewraps one `assert.rejects(...)` call and was not needed for verify (the root `lint` runs `prettier --check` on `**/*.ts` only).
  route: orchestrator → decided: revert the hunk (restores scope; no spec change). Implementer reverts it.
- [P3] module/src/tools/image-upload.ts:121-125 — The quota check (browse then sum) and the upload are not atomic, so two concurrent approved uploads from one user can both pass.
  route: implementer — serialise uploads per user inside the handler; the 64 MiB rule is unchanged.
  input: user at 64 MiB − 300 KiB; two concurrent 512 KiB `image_upload` calls, both approved → both pass, total ends ~724 KiB over quota.
- [NOTE] e2e beforeAll/afterAll: if the world never stored `core.permissions`, the snapshot may be `{}` or defaults; the native run must confirm the key and read-back (already in Amendment 2).

## Review round 2 — findings (external PR review on #171)

Reviewed HEAD: 475542e0acfa6e555fb9fbc5a186eddb0c1abf18

- [P2] module/src/tools/image-upload.ts:166-167 — On v14 the handler snapshots the Scene (`ctx.snapshot(scene.uuid)`) but changes the embedded Level's `background.src`. Undo strips embedded collections from a Scene snapshot, so it cannot restore the background, although the result promises restoration. Adding Level to the undo allowlist (task 121) alone does not fix this.
  route: implementer — on v14, snapshot the actual Level document (`Scene.<id>.Level.<id>`) before the update, as task 121's image_assign does; on v13 keep the Scene snapshot. Add a unit test that runs the real dispatch, then `undoEntry`, and asserts the v14 Level background is restored (pattern: module/test/audit/undo-levels.test.ts).
- [P2] e2e/image-upload/upload.e2e.test.ts:25-40 — When approval takes longer than APPROVAL_WAIT_MS (25 s), `settle` returns the approved result as text only (`approval_status` carries `result` but not the structured `path`/`updated`), so a successful upload fails its assertions and its file is missing from the cleanup report.
  route: implementer — recover the completed upload's details before asserting and recording the path, e.g. parse them from the result text, or have the tool's text first line carry the path in a stable form. Record every uploaded path for cleanup either way, and add a unit-level test of the parsing.

## Amendment 3 (owner, 2026-10-16, from review round 2 re-review)

Amendment 1 C's "on the scene's first Level" becomes: on v14 the background is set on, and snapshotted from, the scene's **initial Level, else `defaultLevel0000`, else the first Level**, the same selection task 121's image_assign uses (module/src/tools/image-assign.ts:89-90). The Level a scene opens on is the one whose background users see. The re-review flagged this as DRIFT; the owner chose to keep it.

## Review round 3 — findings (external review of the sibling #172, applied here)

Reviewed HEAD: 119d3998333e1cfc806a12d5aad1415c0ff3d2f5

- [P1] module/src/tools/image-upload.ts — `resolveActor`/`resolveScene` resolve the target without the GM's agent folder allowlist (`folderAllowed` in module/src/policy/folders.ts, applied by the read tools and module/src/tools/_adapters.ts:93), so an agent can set images on excluded Actors and Scenes.
  route: implementer — apply `folderAllowed(doc, user.isGM === true)` to the target Actor and Scene before any upload or update; refuse identically to a missing document. Fixed in 64f8c05.
- [P3] module/test/tools/image-upload/upload.test.ts:244 — the test title "snapshots the Scene" contradicted its body; renamed in 64f8c05.

## Review round 4 — findings (relayed from task 123's round 4)

Reviewed HEAD: 028b575

- [P2] `resolveActor` accepted an unlinked token's synthetic Actor uuid (`Scene.S.Token.K.Actor.A`), whose `folder` is the base Actor's, so the folder allowlist was checked against the wrong document. route: implementer → fixed in 1443492: only top-level world Actors are accepted (no `parent`, `isToken !== true`, uuid is `Actor.<id>`); anything else gets the same bare FORBIDDEN as a missing document, before any upload.
- Test-only: Amendment 3's Level order is now covered by three cases (initial Level; `defaultLevel0000` when not first; first). Fixed in 1443492.

## Amendment 4 (owner, 2026-10-16, from the round 4 re-review)

The Permissions item's "A GM may target any Actor" means any **world** Actor. image_upload refuses a token's synthetic Actor copy for every caller, GMs included, with the same FORBIDDEN as a missing document. To change one token's art a GM uses image_assign's `token` target. Reason: a synthetic copy has no prototype token art of its own, and resolving it to the base Actor would let the folder allowlist be checked against the wrong document.
