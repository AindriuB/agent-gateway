# 151 — Fix player image uploads and the v14 scene background read

**Repo:** .
**Depends on:** none
**Owns:**
- module/src/tools/image-upload.ts
- module/src/tools/image-view.ts
- module/src/tools/image-assign.ts
- module/src/tools/_upload-dirs.ts (new)
- module/src/compat/index.ts (insertion only: the new helper export)
- module/src/main.ts (insertion only: one install call inside the existing `ready` hook)
- module/test/tools/image-upload/**
- module/test/tools/image-view/**
- module/test/tools/image-assign/**
- module/test/tools/upload-dirs/** (new)
- module/test/compat/scene-background-level.test.ts (new)
- spikes/image-upload/findings.md

## Goal
Live e2e on Foundry 14.369 (pf2e) found two product bugs that must be fixed before 0.4.0.

First, `image_upload` never works for a Player or Trusted user. On v13 and v14 the Foundry server lets only Assistant+ (or a setup admin) call `createDirectory`, and it checks this before it checks whether the directory exists. `ensureDirectories` calls `createDirectory` for every level, so a lower-role user always fails, and the failure is reported as INVALID_ARGS. Owner decision: the active GM's client creates each uploader's folder automatically, and the tool only creates directories when the caller is allowed to.

Second, `image_view` and `image_assign` read the deprecated `Scene#background`. On v14 that getter reads `firstLevel`, but the tools write to `initialLevel ?? defaultLevel0000 ?? first`. The getter is removed in v16. Fix this with one shared compat helper.

## Context
- module/src/tools/image-upload.ts:35-48: `ensureDirectories`, the code to replace. It tolerates only EEXIST.
- module/src/tools/image-upload.ts:96-104: `backgroundLevel`, which picks `initialLevel ?? levels.get('defaultLevel0000') ?? list[0]`.
- module/src/tools/image-assign.ts:91-100: `sceneLevel`, the same choice but with a `size === 1` fallback; image-assign.ts:121-128 is the read-back that uses `doc.background?.src`.
- module/src/tools/image-view.ts:87-91: the `scene_background` source. An empty src currently falls through to the "must be a PNG, JPEG or WebP" message at :154.
- module/src/tools/_image.ts:15: `resolveFilePicker()`. Reuse it.
- module/src/tools/_write.ts: `forbid` and `invalid`. These produce the FORBIDDEN and INVALID_ARGS codes.
- module/src/audit/journal.ts:126 and module/src/audit/index.ts:66: the module's existing active-GM election, `game.users.activeGM?.id === game.user.id`. Use the same rule.
- module/src/main.ts:32-45: the `ready` hook where the installer is called.
- module/src/compat/index.ts: the only place allowed to branch on Foundry generation (`foundryGeneration()`, `hasSceneLevels()`).
- module/test/tools/image-assign/fixtures.ts:119-135: the v14 Level fixture. Today it copies the level src onto `scene.background`; new tests must not depend on that copy.
- Foundry server source, `resources/app/dist/files/local.mjs` (createDirectory) and `files.mjs`: the Assistant-role check runs before the existence check.

## Design
- **`_upload-dirs.ts`** exports:
  - the fixed levels for a user id: `['agent-gateway', 'agent-gateway/uploads', 'agent-gateway/uploads/<userId>']`;
  - `canCreateDirectories(user)`: true for a GM or a user with role >= `CONST.USER_ROLES.ASSISTANT`;
  - `ensureUploadDirs(fp, user, userId)`:
    - for each level, call `fp.browse('data', level)` and skip the level if it resolves;
    - for a missing level, call `createDirectory` only if `canCreateDirectories(user)`;
    - otherwise throw FORBIDDEN, as described in the acceptance list;
  - `installUploadProvisioning()`, which registers the GM-side hooks.
- **GM provisioning.**
  - It runs only when `game.user.isGM` and `game.users.activeGM?.id === game.user.id`. Re-check this on every trigger, not just at install.
  - Triggers:
    - once at `ready`;
    - `updateUser`, for a role change;
    - `createUser`;
    - `createSetting` / `updateSetting` whose key is `core.permissions`.
  - On each trigger it walks `game.users` and, for every user where `user.can('FILES_UPLOAD')` is true and the id matches `/^[A-Za-z0-9]{1,32}$/`, calls `ensureUploadDirs`.
  - Runs are serialised, so two triggers never interleave.
  - Every error is caught and sent to `console.warn` with the `agent-gateway |` prefix. Nothing is thrown or rejected into a hook.
  - No socket messages are sent and no player-side request path exists.
- **Compat helper.**
  - `sceneBackgroundLevel(scene)` returns the document that holds the background:
    - on v14 with levels: `initialLevel ?? levels.get('defaultLevel0000') ?? first level`;
    - on v13: the Scene itself, which keeps `scene.background`.
  - It returns `null` when v14 has no level.
  - It is used by `image_upload` (replacing `backgroundLevel`), `image_assign` (replacing `sceneLevel` and the read-back) and `image_view`.
- **Security (keep these true):**
  - Directory paths are built only from Foundry user ids taken from `game.users` (in the tool path, from the authenticated caller's user id), never from tool arguments or any caller text.
  - Nothing is created except these three fixed, empty directory levels per user.
  - No files are written by provisioning.

## Acceptance
- [ ] A non-GM, non-Assistant caller whose three levels all exist (browse resolves) uploads successfully, and `createDirectory` is never called. There is a unit test for this.
- [ ] A Player caller whose `agent-gateway/uploads/<userId>` browse rejects gets code `FORBIDDEN`, not `INVALID_ARGS`. There is a unit test for this. The message:
  - names the folder `agent-gateway/uploads/<userId>`;
  - says a GM must create it, or a GM must load the world so it is created automatically;
  - has no `createDirectory` call before it.
- [ ] A GM or Assistant caller with a missing level gets `createDirectory('data', level)` for each missing level only. Levels that browse finds are skipped. There is a unit test for this.
- [ ] `grep -n "createDirectory" module/src/tools/image-upload.ts` returns nothing: directory handling lives in `_upload-dirs.ts`.
- [ ] GM provisioning, with unit tests in `module/test/tools/upload-dirs/`:
  - It creates folders only for users where `can('FILES_UPLOAD')` is true. A user without it gets no calls.
  - A second run with every level present makes zero `createDirectory` calls (idempotent).
  - Every `createDirectory` path is one of the three fixed levels, built from a `game.users` id. A user whose id fails the id regex is skipped.
  - When the current user is a GM but not `game.users.activeGM`, nothing runs. With two GMs online, only the active one creates folders.
  - A `createDirectory` rejection is logged with `console.warn` and does not reject the hook callback.
  - An `updateSetting` for `core.permissions` and an `updateUser` both trigger a run. An unrelated setting key does not.
- [ ] `module/src/main.ts` gains exactly one inserted call, `installUploadProvisioning()`, inside the existing `ready` hook. No other lines in the file change.
- [ ] `sceneBackgroundLevel` is exported from `module/src/compat/index.ts`, with unit tests in `module/test/compat/scene-background-level.test.ts` for these cases:
  - a v14 scene whose `initialLevel` is not the first Level returns `initialLevel`;
  - a v14 scene with no `initialLevel` returns `defaultLevel0000`, and otherwise the first level;
  - v13 returns the Scene itself.
- [ ] `grep -n "\.background" module/src/tools/image-view.ts module/src/tools/image-assign.ts` shows reads only through the holder returned by `sceneBackgroundLevel`. There is no direct `scene.background` or `doc.background` read.
- [ ] Unit tests:
  - `image_view` with `source: 'scene_background'` on a v14 fixture whose `initialLevel` is not the first Level returns the image from `initialLevel`.
  - `image_assign`'s read-back for a scene background reads that same Level.
- [ ] `image_view` on a scene whose background src is empty or null returns `INVALID_ARGS` with the message "The scene has no background image", not the "must be a PNG, JPEG or WebP" message. There is a unit test for this.
- [ ] `spikes/image-upload/findings.md` records the Assistant-role rule:
  - at :64, the "Server enforcement" row says `createDirectory` requires Assistant+ (or a setup admin) on v13 and v14, and that the role check runs before the existence check, so a Player or Trusted user fails even when the directory exists;
  - at :138, the 53 bullet's "create each directory level" says to browse first and create only as GM/Assistant.
- [ ] `npm run verify` passes.

## Notes for others
- **E2E:** the native `e2e/image-upload` suite belongs to task 150 (branch `claude/task-150`); this task does not touch it. Task 150's player upload test should pass once this lands, because the GM's client provisions the player's folder when the world loads.
- **User docs belong to the scribe.** No file under `docs/` describes image_upload's GM setup today. On `/record`, the scribe should add a GM setup note (in `docs/security.md` or a guide, the scribe's choice) that says:
  - players need both `FILES_UPLOAD` and `FILES_BROWSE`;
  - the GM's client creates each uploader's `agent-gateway/uploads/<userId>` folder automatically when a GM loads the world, or when a user is granted `FILES_UPLOAD` while a GM is online;
  - the `agent-gateway` folder must not be marked private.

## Out of scope
- Anything under `e2e/` (task 150).
- `docs/**` and `CHANGELOG.md` (scribe / release).
- Shared registries: `module/src/tools/index.ts`, `protocol/**`, `lang/en.json`, `module/test/stubs/**`. Tests use local fakes for `FilePicker`, `game.users` and `Hooks`.
- Changing the upload quota, the naming scheme, the tool's argument schema or its description.
- A socket or relay so players can ask a GM to create folders.
- Migrating other deprecated v14 getters elsewhere in the module.
