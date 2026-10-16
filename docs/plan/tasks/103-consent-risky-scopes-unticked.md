# 103 — Leave destructive and code unticked on the consent page

**Repo:** .
**Depends on:** none
**Status:** Ready.
**Owns:**
- gateway/src/oauth/consent/render.ts (the `renderRequestPage` checkbox markup only)
- gateway/test/oauth/consent/scope-defaults.test.ts (new)

## Goal
The OAuth consent page pre-ticks every scope the client requested, including `destructive` and
`code`, so a non-technical user who just presses the button grants everything. Default those two to
unticked; `read` and `write` stay ticked when they were requested.

## Context
- gateway/src/oauth/consent/render.ts:81-98 — `renderRequestPage`; every box is `checked` at `:85`.
- gateway/src/oauth/repository.ts:3 — `SCOPES = ['read','write','destructive','code']`.
- gateway/src/oauth/consent/index.ts:258 — the server already intersects the posted scopes with the
  requested ones, so only the default changes. Nothing server-side needs to change.
- gateway/test/oauth/consent/consent.test.ts:114-127 — the existing "cannot widen" test posts its
  scopes explicitly, so it is unaffected.

## Acceptance
- [ ] For a request of all four scopes, the rendered step-1 HTML has `checked` on the `read` and
      `write` boxes and not on `destructive` or `code` (the test asserts each input).
- [ ] A request of only `destructive` and `code` renders both boxes unticked, and the page still
      renders and posts (test).
- [ ] Each box still carries its scope as `value` and is escaped as before.
- [ ] No existing test under `gateway/test/oauth/` or `gateway/test/http/` is edited, and all pass.
- [ ] `npm run verify` passes.

## Out of scope
- Scope descriptions or help text on the page, the world and user fields (task 104), the code page,
  the footer and the styles.
- Changing which scopes a client may request, or the default `read` scope in the metadata.
- The wording about unticking scopes in docs/guides/*.md (task 113).

## Attempt 1 — failed

Reviewer: REQUEST CHANGES on acceptance item 2 ("the page still renders and posts (test)").
gateway/test/oauth/consent/scope-defaults.test.ts:27-28 only checks the static HTML for a
`<form method="post" …>` and a `type="submit"`; nothing posts the form. For a destructive+code
request, posting the defaults sends no scope, so gateway/src/oauth/consent/index.ts:258-266
re-renders with "Choose at least one permission." That path is untested.
Fix: drive the real consent route (the `postConsent` helper in consent.test.ts). Post the defaults
for a destructive+code request and assert the "Choose at least one permission." page comes back;
then post with `scope: 'destructive'` and assert it reaches the code page. Add these to
scope-defaults.test.ts only; do not edit consent.test.ts.
