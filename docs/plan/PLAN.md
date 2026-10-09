# Plan

What is open, in priority order. Only `scribe` edits this file.

Each item: one line of what, one line of why it matters, and its blocker if it
has one. When an item is in flight, mark it with its task ids. Delete items you
no longer want rather than letting them rot — a plan nobody trusts is worse
than no plan.

---

## Now

### Start wave 2
Task 01 merged (PR #3) and 01b is in PR review. Tasks 02, 03 and 04 depend only on 01 and can start now; 02 and 03 use `npm test -w protocol`, which needs 01b merged first.
**In flight:** 01b (PR awaiting Andrew)

### Testing topology and prerequisites
- Implementation happens on the homelab; client-side and browser tests run in Andrew's Mac test-bed Claude session (clone at `~/workspace/foundry-modules/agent-gateway`). Use `/usr/bin/curl` there, since Anaconda curl ignores the keychain.
- Task 12 (e2e harness) must read Foundry test credentials from `~/.config/agent-gateway/test.env` (`FOUNDRY_URL`, `FOUNDRY_USER`, `FOUNDRY_PASSWORD`; mode 600, outside the repo). It should log in once and reuse Playwright `storageState`, because Claude agents decline to type passwords into non-localhost logins. Test user is `dev-gm` (GM role) in `test-world`.
- A newly linked module only appears after `test-world` is relaunched from the setup screen (admin key, Andrew only).
- **Prerequisite still open:** homelab Foundry v13 instance, needed for the v13 test evidence every PR owes.
- Criterion 11 of task 01 was checked with a console capture that missed about 617 early boot messages; a full Playwright capture from first load is in progress on the Mac and may be added to the PR.

## Next

## Someday
