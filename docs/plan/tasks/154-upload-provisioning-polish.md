# 154 — Upload provisioning: two-GM test and a narrower `updateUser` trigger

**Repo:** .
**Depends on:** none
**Owns:**
- module/src/tools/_upload-dirs.ts
- module/test/tools/upload-dirs/**

## Goal
Task 151 added GM-side provisioning of each uploader's `agent-gateway/uploads/<userId>` folder. Two
follow-ups: prove with a test that when two GMs are online only the active GM's client creates
folders, and stop re-running provisioning on every user update, so only a change to a user's
`role` or `permissions` triggers a run.

## Context
- module/src/tools/_upload-dirs.ts:52-53: `isActiveGm()`, the election
  (`game.users.activeGM?.id === game.user.id`).
- module/src/tools/_upload-dirs.ts:100-110: `installUploadProvisioning`; `updateUser` is wired
  straight to `trigger` today. Foundry calls `updateUser` hooks as `(user, changed, options, userId)`,
  where `changed` holds only the changed fields.
- module/src/tools/_upload-dirs.ts:59-99: the serialised, merging run loop. Keep it as is.
- module/test/tools/upload-dirs/provision.test.ts:12-50: the fakes for `game`, `Hooks` and
  `FilePicker`; :105-120 the trigger test; :140 the merge test. Both call `hooks.updateUser!()` with
  no arguments and must be updated to pass a `changed` object.
- The module state (`chain`, `running`, `queued`) is module-level, so two clients in one test need
  two module instances (for example `vi.resetModules()` and a second dynamic import), each with its
  own `game` and `FilePicker` fake.
- docs/plan/tasks/151-image-tools-v14-fixes.md: the original design and acceptance.

## Acceptance
- [ ] A unit test runs two clients against one shared `game.users` list where both GMs are online
      and `activeGM` is GM A. Each client calls `installUploadProvisioning()`. GM A's `FilePicker`
      gets the expected `createDirectory` calls; GM B's gets none, and its `browse` is never called.
- [ ] `updateUser` triggers a run only when `changed` has an own `role` or `permissions` key. A test
      shows `{ role: 2 }` and `{ permissions: { FILES_UPLOAD: true } }` each cause a run, and
      `{ flags: {...} }`, `{ color: '#ff0000' }`, `{ character: 'abc' }`, `{ name: 'x' }` and a
      missing or non-object `changed` cause none.
- [ ] `createUser` and the `core.permissions` setting hooks behave as before (existing tests pass
      unchanged apart from the `updateUser` argument).
- [ ] No hook callback throws or returns a rejected promise for any `changed` value (a test passes
      `null` and a string).
- [ ] `git diff --stat` touches only the owned files.
- [ ] `npm run verify` passes.

## Out of scope
- Adding a `userConnected` or active-GM-change trigger.
- `module/src/main.ts`, `module/src/tools/image-upload.ts` and every other tool file.
- `lang/en.json`, `module/test/stubs/**`.
- Changing which levels are created or the FORBIDDEN message.
