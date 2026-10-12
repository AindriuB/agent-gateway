# 28a — Stabilize cross-user toolset notification verification

**Repo:** .
**Depends on:** 28
**Status:** Complete; merged in PR #75 (head `1eb9b08`, main `3cd5cb1`). Targeted 16-test checks and required build/lint/full verification passed (3,393 fast / 2,227 slow). Test-only repair; no runtime or native changes.
**Owns:**
- gateway/test/routing/toolset.test.ts (the cross-user notification test only)

## Goal
Make the existing cross-user notification assertion establish its own session binding before another user's connection can trigger a legitimate initial notification. Preserve the assertion that another user's toolset cannot affect the bound user's tools or notifications.

## Acceptance
- [ ] Establish the selected user's binding deterministically before connecting the other user; use actual list/binding/notification barriers rather than adding arbitrary sleeps or weakening the zero cross-user notification assertion.
- [ ] Preserve the selected user's exact tool list, other-user announcement operation and final absence-of-notification assertion. No production changes or blanket count reset that could erase the event under test.
- [ ] The unchanged existing notification tests remain intact; the targeted file and required `npm run verify` pass.

## Out of scope
- Production routing, session binding or notification behavior changes
- Task29 implementation, native actions or completion-doc rewrites
