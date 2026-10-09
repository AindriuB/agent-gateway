# History

What was built, newest first. Append-only. Only `scribe` edits this file.

**Read this before redesigning anything.** The `Cost` line on each entry is the
point of the file — it is where the sessions that already tried the obvious
approach tell you what happened.

Do not load this file to find out whether something exists. It grows without
bound. `HISTORY-INDEX.md` carries one row per entry; scan that, then grep this
file for the exact heading it names. Every entry added here gets its index row
in the same commit.

<!--
## YYYY-MM-DD — <what landed>
<Two or three sentences: what it does now that it did not before.>
**Cost:** <what was hard, what was tried and abandoned, what not to retry.>
-->

## 2026-10-09 — Gateway skeleton and stdio MCP server (task 05)
`gateway` now has config loading, a stderr-only logger, an app wiring layer and an MCP server over stdio, started by `gateway/dist/bin/cli.js`. The tool registry is empty, so `tools/list` returns no tools and an unknown `tools/call` returns `tool_not_found`; for registered tools, `WORLD_OFFLINE` is returned when no module is connected (proven by a unit test with a fixture tool). Tester passed (clean `npm ci`, `npm run verify` 65 tests in 9 files, MCP Inspector CLI against the built binary); reviewer approved 7 of 7. stdout carries only MCP frames.
**Cost:** The server test sleeps a fixed 1500 ms rather than waiting for the response line, so it can flake. CLI tests need a prior build. The npm package depends on the private `@agent-gateway/protocol` workspace, which must be bundled or published before release.

## 2026-10-09 — Module skeleton and v13/v14 compat layer (task 04)
The module now has a skeleton with a compat layer that isolates Foundry v13/v14 differences, a settings registry (gatewayUrl, pairingToken, includeOtherModuleData) and Foundry stubs for tests; it logs `agent-gateway | ready (v14)`. Tester passed (`npm test -w module` 17/17), reviewer approved. On the Mac test bed (Foundry 14.369, pf2e, headless Chromium from first navigation) there were 272 console messages with 0 errors, 0 warnings and 0 page errors, and `foundry.documents.BaseLevel` is a function on v14.369, so the Levels probe name is right.
**Cost:** v13 is unverified because no v13 instance exists. `hasSceneLevels()` is tree-shaken out of the bundle as unused, so its live result is unchecked. The isolation test regex misses `game['release']`, destructuring and `game.version`, and `foundryGeneration()` silently returns 13 if `game.release` is missing.

## 2026-10-09 — Tool definition framework (task 03)
`protocol` now has a tool definition framework that generates JSON Schema from zod and tests that schemas stay conservative, with tool-count limits of 24 player and 36 GM (approved by Andrew). Tester passed (17 tests in 3 files), reviewer approved 7 of 7. Andrew's review of PR #6 then requested two P2 changes: the schema-keyword checks were applied to the `properties` dictionary, which gave false positives for fields named `properties`, `oneOf`, `anyOf` or `allOf`, and the description check covered input only. Attempt 2 (commit 4901ea0) fixed both, with a positive fixture (`keywordNamedFieldsTool`) and an output negative fixture (`undocumentedOutputTool`); tester 19/19, with proof that both new tests fail against the old walker; reviewer APPROVE, no rule weakened.
**Cost:** zod v4 collapses primitive unions to `type` arrays and merges intersections, so the sweep also flags type arrays and the allOf rule is proven with a raw-schema fixture rather than a real zod schema. In attempt 1 the walker descended into the `properties` map and checked only input descriptions (both fixed in attempt 2, above); it still does not follow `$ref`, so a recursive schema could bypass the depth-3 check.

## 2026-10-09 — Link protocol and version handshake (task 02)
`protocol/src/link/` defines every module-gateway message in zod: hello/welcome/reject handshake with pairing, tool call and result, ping/pong and the error codes, plus a version compatibility check. PROTOCOL_VERSION is 1.0.0 and MAX_FRAME_BYTES is 1 MiB, measured with TextEncoder so it runs in browsers. Tester passed (20 tests), reviewer approved 5 of 5.
**Cost:** `checkCompat` messages say "local/remote side" instead of naming module and gateway, so they are not yet actionable. The version regex is not end-anchored, so `1.0.0garbage` parses as major 1.

## 2026-10-09 — Workspace test wiring and scaffold follow-ups (task 01b)
Root `vitest.config.ts` now lists `protocol`, `module` and `gateway` under `test.projects` (the inert `vitest.workspace.ts` is gone), each workspace has a `test` script so `npm test -w protocol` works, `module/tsconfig.json` sets `types: []` so Node globals no longer type-check in browser code, and root `allowScripts` approves `fsevents`. Verified by tester on the homelab, on the Mac test bed (macOS 27.0.1, Node 24.19: fsevents warning gone, `npm approve-scripts --allow-scripts-pending` reports nothing unreviewed) and by reviewer (9 of 9 criteria). A trial merge of tasks 02, 03 and 04 onto it had no conflicts and the root runner found 54 tests in 7 files.
**Cost:** There are no tests on main yet, so the passes prove wiring only. `npm approve-scripts fsevents` cannot run on Linux because fsevents is not installed, so the entry was written by hand. Project names print only with a TTY or `--reporter=verbose`, and the module project shows its package name and default include until task 04's `module/vitest.config.ts` lands; the root config deliberately has no module `include` override.

## 2026-10-09 — Workspace scaffold (task 01)
The repo is now an npm workspace with `protocol/`, `module/` and `gateway/`, a root `module.json` (id `agent-gateway`, v0.1.0) and one `npm run verify` that builds, lints and tests. The built module logs `agent-gateway | loaded` on `init`, and `docs/conventions.md` fixes layout, ports (link WebSocket 7420, local HTTP 7421) and the insertion-only shared files. Verified by tester (clean `npm ci`, build and lint), reviewer (10 of 11 criteria from the diff) and a Foundry 14.369 / pf2e 8.6.0 console check on the Mac.
**Cost:** Tests are vacuous (`vitest --passWithNoTests`) because `vitest.workspace.ts` is inert under vitest 5 and needs `test.projects` in a root config; do not trust "tests pass" until that is fixed. `module/tsconfig.json` lacks a `types` restriction, so Node globals leak into browser code. The first console capture missed about 617 early boot messages, so "no errors" rests on a partial log. Implementer added `typescript-eslint` as a devDependency and set the gateway tsconfig to `types: ["node"]`.

