# 54 — gm-builder pack: deterministic Universal VTT (.dd2vtt) import

**Repo:** .
**Status:** Planned — do not start; queued after current workloads (32, 44, and the five gap tasks)
**Depends on:** 47, 48, 50, 53
**Owns:**
- packs/gm-builder/** (new pack module: manifest, registration, the UVTT parser and import tool), except packs/gm-builder/src/planning/**
- module/test/packs/gm-builder/** (new), except module/test/packs/gm-builder/planning/**
- e2e/packs/gm-builder/** (new)

## Goal
Start the GM-only `gm-builder` tool pack with a deterministic importer for Universal VTT
(`.dd2vtt`/`.uvtt`) maps. It turns the file's walls, doors and portals, lights, grid
resolution and embedded image into one scene. Everything goes through pack API 1.1's write
helper, in bounded batches. Each batch is one approval and one undo group. Map text is
untrusted data.

## Context
- docs/packs/api.md, docs/packs/security.md and docs/packs/naming.md set the pack contract, security model and prefixed tool names. Task 50's `writeHandler` and bulk-write contract apply.
- Task 47's batch caps and scene and wall data mapping, and task 53's upload storage rules (fixed directory, magic bytes, server filenames). A pack cannot call those tools (task 50), so it reuses their rules through the shared, documented limits, not through cross-tool calls.
- protocol/src/link/messages.ts:9: `MAX_FRAME_BYTES = 1 MiB`. UVTT files with an embedded image often exceed it.
- examples/hello-pack: pack layout and registration.

## Spike (verify before code; record in PR)
- [ ] The UVTT format versions seen in the wild (0.2/0.3), the field names (`resolution`, `line_of_sight`, `objects_line_of_sight`, `portals`, `lights`, `image`), and coordinate units.
- [ ] Transport for files larger than one frame. Either a chunked upload (N calls assembled into a bounded buffer with a TTL and a per-user cap) or a GM-side file pick in the Foundry UI. Choose one and justify it. Neither may fetch URLs.
- [ ] Vision accuracy: whether imported walls block vision correctly on v13 and v14 for a sample map. This is not assumed.
- [ ] Repo and release layout: whether `packs/gm-builder` ships in-repo and is excluded from the core release zip like examples/ (task 41), or lives in its own repo. Andrew decides.

## Acceptance
- [ ] The pack registers with `apiVersion: '1.1'`, a prefix per docs/packs/naming.md, and only `minRole:'gm'` tools. A test asserts that a player-role session's tools/list contains no `gm-builder` tool, in module/test/packs/gm-builder/ and in the e2e roles check.
- [ ] The parser is bounded. The input is at most the spike-chosen size; at most 5,000 wall segments, 500 portals and 500 lights in total; nesting depth 8; and finite numbers only. A unit test hits each bound with INVALID_ARGS and no write. The image goes through task 53's checks: PNG, JPEG or WebP magic bytes, never decoded, no SVG.
- [ ] The import plan is deterministic: the same file gives the same batches. A golden test covers this. Walls are split into batches of at most the task 50 `maxTargets`. Each batch is one `writeHandler` call: one approval, one audit entry and one undo group. Undoing one batch removes exactly that batch, which a unit test checks.
- [ ] Every text from the file (labels, names) is stored as data and shown escaped. A unit test feeds `<script>` and `@UUID[...]` labels and asserts that they are inert (`escapeHtml` semantics, module/src/tools/_write.ts:47-56).
- [ ] Doors and portals map to door walls with the correct `door` state, and lights map to AmbientLight with bounded radii, both checked against a fixture file.
- [ ] Native acceptance on v14 and v13 (`AGENT_GATEWAY_E2E_GM_BUILDER=1`). A sample UVTT imports into a temporary scene, and the wall, door and light counts match. The last batch undoes to its prior count. The scene is deleted by exact UUID. Native execution needs Andrew's per-run approval.
- [ ] `npm run verify` passes

## Out of scope
- Image-based wall planning (55); encounters and campaigns (56)
- Core changes outside the pack; URL fetching
