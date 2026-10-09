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

## 2026-10-09 — Workspace test wiring and scaffold follow-ups (task 01b)
Root `vitest.config.ts` now lists `protocol`, `module` and `gateway` under `test.projects` (the inert `vitest.workspace.ts` is gone), each workspace has a `test` script so `npm test -w protocol` works, `module/tsconfig.json` sets `types: []` so Node globals no longer type-check in browser code, and root `allowScripts` approves `fsevents`. Verified by tester on the homelab, on the Mac test bed (macOS 27.0.1, Node 24.19: fsevents warning gone, `npm approve-scripts --allow-scripts-pending` reports nothing unreviewed) and by reviewer (9 of 9 criteria). A trial merge of tasks 02, 03 and 04 onto it had no conflicts and the root runner found 54 tests in 7 files.
**Cost:** There are no tests on main yet, so the passes prove wiring only. `npm approve-scripts fsevents` cannot run on Linux because fsevents is not installed, so the entry was written by hand. Project names print only with a TTY or `--reporter=verbose`, and the module project shows its package name and default include until task 04's `module/vitest.config.ts` lands; the root config deliberately has no module `include` override.

## 2026-10-09 — Workspace scaffold (task 01)
The repo is now an npm workspace with `protocol/`, `module/` and `gateway/`, a root `module.json` (id `agent-gateway`, v0.1.0) and one `npm run verify` that builds, lints and tests. The built module logs `agent-gateway | loaded` on `init`, and `docs/conventions.md` fixes layout, ports (link WebSocket 7420, local HTTP 7421) and the insertion-only shared files. Verified by tester (clean `npm ci`, build and lint), reviewer (10 of 11 criteria from the diff) and a Foundry 14.369 / pf2e 8.6.0 console check on the Mac.
**Cost:** Tests are vacuous (`vitest --passWithNoTests`) because `vitest.workspace.ts` is inert under vitest 5 and needs `test.projects` in a root config; do not trust "tests pass" until that is fixed. `module/tsconfig.json` lacks a `types` restriction, so Node globals leak into browser code. The first console capture missed about 617 early boot messages, so "no errors" rests on a partial log. Implementer added `typescript-eslint` as a devDependency and set the gateway tsconfig to `types: ["node"]`.

