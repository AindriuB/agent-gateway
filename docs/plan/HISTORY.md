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

## 2026-10-09 — Workspace scaffold (task 01)
The repo is now an npm workspace with `protocol/`, `module/` and `gateway/`, a root `module.json` (id `agent-gateway`, v0.1.0) and one `npm run verify` that builds, lints and tests. The built module logs `agent-gateway | loaded` on `init`, and `docs/conventions.md` fixes layout, ports (link WebSocket 7420, local HTTP 7421) and the insertion-only shared files. Verified by tester (clean `npm ci`, build and lint), reviewer (10 of 11 criteria from the diff) and a Foundry 14.369 / pf2e 8.6.0 console check on the Mac.
**Cost:** Tests are vacuous (`vitest --passWithNoTests`) because `vitest.workspace.ts` is inert under vitest 5 and needs `test.projects` in a root config; do not trust "tests pass" until that is fixed. `module/tsconfig.json` lacks a `types` restriction, so Node globals leak into browser code. The first console capture missed about 617 early boot messages, so "no errors" rests on a partial log. Implementer added `typescript-eslint` as a devDependency and set the gateway tsconfig to `types: ["node"]`.

