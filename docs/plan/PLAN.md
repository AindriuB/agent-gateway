# Plan

What is open, in priority order. Only `scribe` edits this file.

Each item: one line of what, one line of why it matters, and its blocker if it
has one. When an item is in flight, mark it with its task ids. Delete items you
no longer want rather than letting them rot — a plan nobody trusts is worse
than no plan.

---

## Now

### Wave 3 status
Task 05 (gateway skeleton and stdio MCP server) is merged. Task 06 (gateway link server) is done; PR to follow. Task 08 is on attempt 2 after review defects (see its task file). Task 07 awaits the Mac live check, then attempt 2. Wave 2 PRs are merged.
**In flight:** 07, 08

### Testing topology and prerequisites
- Implementation happens on the homelab; client-side and browser tests run in Andrew's Mac test-bed Claude session (clone at `~/workspace/foundry-modules/agent-gateway`). Use `/usr/bin/curl` there, since Anaconda curl ignores the keychain.
- Task 12 (e2e harness) must read Foundry test credentials from `~/.config/agent-gateway/test.env` (`FOUNDRY_URL`, `FOUNDRY_USER`, `FOUNDRY_PASSWORD`; mode 600, outside the repo). It should log in once and reuse Playwright `storageState`, because Claude agents decline to type passwords into non-localhost logins. Test user is `dev-gm` (GM role) in `test-world`.
- A newly linked module only appears after `test-world` is relaunched from the setup screen (admin key, Andrew only).
- **Prerequisite still open:** homelab Foundry v13 instance, needed for the v13 test evidence every PR owes.
- Criterion 11 of task 01 was checked with a console capture that missed about 617 early boot messages; a full Playwright capture from first load is in progress on the Mac and may be added to the PR.

## Next

### Follow-ups from wave 2
- Handshake mismatch message must name "module" and "gateway", not "local/remote side" (pick up in task 06 or 07). The user needs to know which side to update.
- Link version regex is not end-anchored (`1.0.0garbage` parses as major 1); tighten when 06 or 07 touches it.
- Confirm `result.structured` being optional is what the tool framework wants.
- Schema checker: the `properties`-map false positive and output descriptions are fixed (PR #6). Remaining: follow `$ref` (recursive schemas can bypass the depth check) and add `propertyNames` to the walker's single-schema keywords. Do before real tools land in task 09.
- `hasSceneLevels()` is tree-shaken out of the bundle (unused), so its runtime result is unverified live. Verify once a task uses it, for example by exposing it through the module api or a log line.
- Compat isolation test should also catch `game['release']`, destructuring and `game.version`; `foundryGeneration()` silently returns 13 if `game.release` is missing.
- Task 04 v13 evidence is pending until the v13 instance exists.
- Task 01b's task file was never committed (only HISTORY records it). Future mid-wave tasks put their task file in their PR.

### Follow-ups from task 05
- `gateway/test/mcp/server.test.ts:70` waits a fixed 1500 ms; wait for the id:2 response line instead, or it can flake.
- The CLI tests need a prior build; `npm run verify` builds first, but a bare `npm test` on a clean tree will fail them.
- The published npm package `foundry-agent-gateway` depends on the private workspace `@agent-gateway/protocol`. Bundle it at build time (release task 41) or publish it.

### Follow-ups from task 06
- `gateway/package.json` lacks `@agent-gateway/protocol` as a dependency; bundle it for release (task 41).
- Add a rate limit on pairing-code attempts if `allowNonLoopback` is ever used; loopback-only makes guessing impractical today.
- Implementers must run the full `npm run verify` before reporting done. Two attempts in this wave failed on that alone.

## Someday
