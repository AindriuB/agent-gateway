# 149 — Apply the folder allowlist to image_assign targets

**Repo:** .
**Depends on:** none
**Owns:**
- module/src/tools/image-assign.ts: the `resolveTarget` / `set` path only
- module/test/tools/image-assign/** (a new `folders.test.ts`, or insertions in existing files)

## Goal
`image_assign` (task 121, merged in #169) ignores the GM's agent folder allowlist. Its
`resolveTarget` looks up the target with `fromUuidCompat` and never calls `folderAllowed`. An agent
can therefore set images on excluded Actors and Scenes, and on Tokens and Tiles whose Scene is
excluded. `set` must apply the same rule the read tools and the actor write adapter already apply,
and refuse an excluded document the same way it refuses a missing one.

## Context
- module/src/policy/folders.ts — `folderAllowed(doc, isGM, snapshot?)`. An empty list means no
  restriction. Apply it to the top-level world document; embedded documents follow their root.
- module/src/tools/document-get.ts:178, module/src/tools/document-search.ts:37,
  module/src/tools/world-info.ts:33 — the read tools' use of `folderAllowed(root, user.isGM === true, ...)`
- module/src/tools/_adapters.ts:93 — the actor write adapter's use, with `readWorldSnapshot()`
- module/src/tools/image-assign.ts:64-83 — `resolveTarget`. A missing or wrong-type uuid throws
  `invalid(\`The uuid is not a ${name} (target ${target})\`)`, which is `WriteError('INVALID_ARGS', ...)`
  (module/src/tools/_write.ts:27).
- module/src/tools/image-assign.ts:99-131 — `setHandler.run`. `ctx.snapshot(holder.uuid)` at :131
  and the update come after `resolveTarget`.
- module/test/tools/image-assign/fixtures.ts:148-176 — the event, snapshot and ctx recorders
- module/test/tools/document-read.test.ts:1105-1113 — how a test publishes a world snapshot with
  `folders: { playerAgents: [...], gmAgents: [...] }`
- module/test/stubs/foundry.ts:52 — the default allowlist is empty for both agent kinds

## Acceptance
- [ ] `resolveTarget` calls `folderAllowed(root, user.isGM === true, ...)`, where `root` is the
      Actor for `actor_portrait` and `actor_token`, the Scene for `scene_background`, and the
      parent Scene (`doc.parent`) for `token` and `tile`.
- [ ] The check runs inside `resolveTarget`, before the ownership and `canUserModify` checks, so
      it precedes every update and every approval effect.
- [ ] An excluded root throws the same `WriteError` as a missing uuid for that target: code
      `INVALID_ARGS`, message `The uuid is not a <Actor|Scene|Token|Tile> (target <target>)`.
      A test asserts that the code and message of the refusal for an excluded document equal those
      for a nonexistent uuid of the same type.
- [ ] Tests cover both a player agent and a GM agent (each with its own `playerAgents` /
      `gmAgents` list). For each of `actor_portrait`, `actor_token`, `scene_background`, `token`
      and `tile` with an excluded root: refused as above, no `update` call, no `ctx.snapshot` call.
- [ ] A test shows an allowed root (its folder, or an ancestor folder, is in the list) succeeds
      for each target type.
- [ ] A test shows an empty allowlist imposes no restriction.
- [ ] The `list` action is unchanged: `git diff` shows no edit to the `list` handler, and its
      existing tests still pass.
- [ ] `npm run verify` passes.

## Out of scope
- `list` (Data file browsing). It is not folder-scoped.
- module/src/policy/folders.ts and any other tool. Task 53 (PR #171) and task 123 (PR #172)
  apply the same rule in their own files; they share no file with this task.
- Task 123's refusal shape (FORBIDDEN "You cannot view this image"). Do not copy it here.
  image_assign keeps its existing missing-uuid answer.
- Changing the existing ownership, world-document or GM-only checks, or their messages.
