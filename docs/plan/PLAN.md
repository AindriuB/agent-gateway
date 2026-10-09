# Plan

What is open, in priority order. Only `scribe` edits this file.

Each item: one line of what, one line of why it matters, and its blocker if it
has one. When an item is in flight, mark it with its task ids. Delete items you
no longer want rather than letting them rot — a plan nobody trusts is worse
than no plan.

---

## Now

### Review and merge wave 2
Tasks 02, 03 and 04 passed test and review; their code PRs (#5, #6, #7) and the record PR await Andrew. Merge the record PR after the three code PRs.
**In flight:** PRs #5 (02), #6 (03), #7 (04), record/wave-2

### Start wave 3
Tasks 05, 06, 07 and 08 depend only on 02, 03 and 04 and can start once those PRs are merged. 05 needs 03; 06 needs 02; 07 needs 02 and 04; 08 needs 03 and 04.

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

## Someday
