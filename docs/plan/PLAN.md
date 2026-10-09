# Plan

What is open, in priority order. Only `scribe` edits this file.

Each item: one line of what, one line of why it matters, and its blocker if it
has one. When an item is in flight, mark it with its task ids. Delete items you
no longer want rather than letting them rot — a plan nobody trusts is worse
than no plan.

---

## Now

### Wave 3 status
Tasks 05 (gateway skeleton and stdio MCP server), 06 (gateway link server) and 07 (module LinkClient and pairing app) are merged. Task 08 (module operation registry and markdown conversion) is done; PR #18 is open. Wave 2 PRs are merged.
**In flight:** none (08 awaiting PR #18 merge)

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

### Follow-ups from task 07
- A rejected code is never visible when a token is stored: status goes Connecting to Connected in about 0.3 s. Show a one-off notification that the code was not accepted.
- After a rejected code, retries keep re-sending it before the token fallback. Drop the code once it is rejected.
- Verify Local Network Access behaviour once in Andrew's everyday Chrome profile. The live proof used a fresh profile only.
- Foundry test stubs: `ApplicationV2` is empty, so pairing app rendering is covered only by the live check.
- Rename the test at `module/test/link/client.test.ts:276`; it covers the throw path only, not all reply paths.
- Add a dedicated "replaced" close code in `protocol/`, shared by gateway and module, instead of matching 1000 plus the reason string `replaced`.
- Submitting an empty gateway URL in the pairing app is a silent no-op; show a message.
- The `gatewayUrl` setting has no `onChange`; editing it in Foundry's core settings does nothing until Connect or a reload.
- One unexplained Tab-B load stall was seen once with bfcache enabled; it did not reproduce with diagnostics on. Watch for it.
- The pairing test's fake `querySelector` is permissive; tighten it so a wrong selector fails.
- The reload test should also assert the registered setting type is String and that the token is sent in hello after a reload.
- The `stringStorage` stub change replaced an existing line; keep stubs additive.
- A newer code entered between two stops during a pending welcome write is dropped in favour of the older-issued token. Same gateway, nothing leaks.
- A socket closing during the welcome write retries the used code once before the token fallback (one extra round trip).

### Follow-ups from task 08
- Separators after empty cells in flattened tables (`/ /`, `; ;`).
- A UUID split across cells is stitched with a separator.
- The deep-nesting scaling test misses cheap O(depth)-per-node work.
- A quadratic `@UUID` scan is detected only as a hang, since synchronous code cannot be interrupted by a vitest timeout; it is not a clean failure.
- `_` and `*` are escaped intra-word and inside bare URLs, which hurts readability.
- `#` and `>` after newlines inside `<pre>` are not handled.
- Relative links are resolved against a dummy root, so deep `../` is normalised.
- GFM autolinks of bare URLs are typed as text.
- Other-module data outside `flags` is still not filtered: ActiveEffect `changes[].key`, `_stats.compendiumSource`/`duplicateSource`, and module-written `system` fields, including objects named `system` outside schema system data.
- The module test suite now takes about 27 s (full verify); consider moving the min-of-runs scaling tests to a separate slow suite.
- Duplicate SPACING oracle cases: the second template ignores `b`, and no case has trailing whitespace inside the second element.
- The generated-case skip filter can narrow to text containing `](`, because marked mis-parses `\](` in link text.
- `<pre>` content inside indented code blocks shows escape backslashes literally (`\<`, `\&`, `\*`); readability only.
- Intra-word emphasis fidelity: `x<em>*star </em>y` becomes `x*\*star* y`, where emphasis does not open after a word character (it reads `x**star*`).

## Someday
