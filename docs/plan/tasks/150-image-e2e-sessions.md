# 150 — Run the native image e2e suites with both users on one rig

**Repo:** `.` (agent-gateway)
**Depends on:** none
**Owns:**
- e2e/image-upload/**
- e2e/image-assign/**
- e2e/image-view/**

## Goal
On the live run of 2026-10-16 all three native image suites failed in `beforeAll` on v14 and v13.
Each one opened a GM session and then a player1 session while the GM's was still open, so the
second gateway was refused as a secondary ("selector mismatch ... primary: user=dev-gm"). Move the
three suites onto the existing two-browser rig so both users run in one suite. Also replace
image-view's four fixture variables with temporary fixtures the suite creates and deletes itself.

## Context
- e2e/lib/session.ts:27-65: `openUserSession` starts its own `GatewayProcess` bound to one user
  on the e2e link port. That is why a second session opened next to the first fails.
- e2e/run.ts:69-115: `livePreflight` closes the GM session before it opens the player's, for the
  same reason.
- e2e/multi/rig.ts:19-112 is the pattern to use. `Rig.open(boundTo, users)` (28-40) starts one
  gateway and opens and joins one browser per user. `Rig.swap(user)` (73-86) stops that gateway
  and starts one bound to `user` while both browsers stay open, then waits up to `RECONNECT_MS`
  (100 s, line 7) for both to reconnect. `Rig.close()` (105-112) closes every browser and gateway.
  e2e/multi/isolation.e2e.test.ts:57-67 does exactly this for dev-gm and player1:
  `rig.open(playerUser, [gmUser, playerUser])`, then `swap` to each user.
- **Decision: use `Rig` with a bound swap. Do not sequence `openUserSession` calls.** Reasons:
  - `Rig` already does everything these suites need without any change to e2e/multi/**.
  - Gateway calls go to the user the current gateway is bound to (rig.ts:66-70 and isolation:22-32).
    Do not use an unbound gateway. With an unbound gateway the stdio session follows whichever
    page connects first (rig.ts:42-46), so the suite could not choose which user a call runs as.
  - Both pages stay open the whole time. Every `evalGm` and `player.browser.page.evaluate` call
    (permission writes, `game.user.can` checks, native create, read and delete) goes through
    `rig.users.get(user)!.browser.page`, whatever user the gateway is bound to.
  - So the `core.permissions` restore depends only on the GM page, not on any gateway. It still
    works if a swap or a gateway fails partway. Sequencing sessions would close the GM page between
    phases, and then the restore would depend on reopening the GM session successfully.
- e2e/lib/browser.ts:174 `foundryVersion(page)` replaces `UserSession.foundryVersion`. Read it
  from the GM page.
- e2e/lib/context.ts:25 `loadContext()` returns the `Context` that `new Rig(ctx)` takes.
- e2e/image-assign/image-assign.e2e.test.ts:52-64 (`findImage`), 110-175 (the snapshot and grant,
  native Scene and Tile creation, and the afterAll that collects every failure), and
  e2e/image-upload/upload.e2e.test.ts:44-185 (the PNG probe upload, the `uploaded` list, the
  `RESIDUE:` errors). Follow these patterns for temporary fixtures and cleanup.
- e2e/image-view/image-view.e2e.test.ts:5-13: the `AGENT_GATEWAY_E2E_IMAGE_FILE`, `_OWNED_ACTOR`,
  `_NO_PERM_ACTOR` and `_HIDDEN_TOKEN` variables to remove. Only this file reads them (checked with
  grep at e8f0a64).

## Shape each suite must have
1. In `beforeAll`, when enabled: `rig = new Rig(ctx); await rig.open(gmUser, [gmUser, playerUser])`.
   Track the user the gateway is bound to in a suite-local variable. Add one helper,
   `as(user)`, that calls `rig.swap(user)` only when the binding differs and then returns
   `rig.gateway!`. Every gateway call goes through `as(...)`. Every GM call to `settle` and
   `approval_status` must use the same gateway that made the call. Never swap while an approval
   is still pending.
2. Order the tests so there are as few swaps as possible: GM tests first, then player tests. A
   read-back in a player test (for example `document_get` on the owned Actor in
   upload.e2e.test.ts:212) reads natively through the GM page, so it does not need a swap back.
3. A test or hook that may swap has a timeout of at least its approval budget plus `RECONNECT_MS`
   per possible swap.
4. Do the `afterAll` steps in this order, each in its own try/catch and each collected as a
   `RESIDUE:` failure. A failure in one step never skips a later one:
   1. Write the permission snapshot through the GM page, then read it back and assert it equals the
      snapshot.
   2. Delete every temporary document by its exact UUID, natively through the GM page. This needs
      no approval and no swap.
   3. Print the list of uploaded files.
   4. `rig.close()`.

   Throw the collected failures at the end.

## Acceptance
- [ ] No file under e2e/image-upload/, e2e/image-assign/ or e2e/image-view/ imports
      `openUserSession`. Each suite imports `Rig` from `../multi/rig.js` and calls `rig.open`
      exactly once, bound to the GM with both the GM and the player listed.
- [ ] `git diff main -- e2e/lib e2e/multi` is empty.
- [ ] In each suite with a permission grant (image-upload and image-assign), `afterAll` writes the
      snapshot and reads it back through the GM page **before** any gateway call or swap. A
      mismatch, or an error from the write or the read-back, gives an error starting
      `RESIDUE: file permissions were not restored`. Wrap the restore in a guard so it runs whenever
      a snapshot was taken, even if a later `beforeAll` step or a swap threw.
- [ ] Every temporary document (Actors, Scenes, embedded Tiles and Tokens) is deleted in `afterAll`
      by the exact UUID recorded when it was created. No document is deleted by name or by query.
      When an upload succeeds, its file path is added to a list, and `afterAll` prints that list
      under `UPLOADED FILES (delete by hand from the Data folder):`, even if earlier steps failed.
- [ ] image-view no longer reads any `AGENT_GATEWAY_E2E_IMAGE_*` variable except the
      `AGENT_GATEWAY_E2E_IMAGE` gate, and none of its tests is `skipIf` on a fixture variable.
      `beforeAll` sets up these fixtures as the GM:
      - a PNG probe file, uploaded with `image_upload` (the 1x1 PNG from upload.e2e.test.ts:22-23,
        with approval through `settle`). Its path goes on the uploaded list.
      - an Actor the player owns (`ownership.default: 3`) and an Actor with no permission
        (`ownership.default: 0`). Both use the probe file as `img`.
      - a temporary Scene, with a Token of the no-permission Actor set to `hidden: true`, created
        natively the way image-assign.e2e.test.ts:131-138 creates its Scene and Tile.

      The four existing image-view tests use these fixtures.
- [ ] Natively, on v14 and on v13 with `AGENT_GATEWAY_E2E_UPLOAD=1` and `AGENT_GATEWAY_E2E_IMAGE=1`
      (`npm run test:e2e -- --foundry v14 image-` and the same with `v13`), each of the three suites
      gets past `beforeAll` and runs its tests. Skips whose reason names the Foundry version (the v14
      grant skip and the v14-only Undo test) count as run. This native run needs the repository
      owner's approval. The PR body gives, per suite and per Foundry version, the counts of passed,
      failed and skipped tests. It also gives the UPLOADED FILES lists.
- [ ] With no `AGENT_GATEWAY_E2E_*` variable set, all three suites skip without opening a browser or
      a gateway, and `npm run verify` passes as it does on main.
- [ ] `npx tsc -p e2e/tsconfig.json --noEmit` passes.
- [ ] `npx vitest run --config e2e/vitest.e2e.config.ts --project e2e-unit` passes. This includes
      e2e/lib/hygiene.test.ts.

## Out of scope
- Any change to e2e/lib/** (session.ts, gateway.ts, browser.ts, context.ts) or e2e/multi/**
  (rig.ts, frames.ts). If one of them seems to need a change, for example a way to read the
  bound user from `Rig`, or `Rig.open` cleaning up after itself on failure, stop and report it as
  a spec question.
- e2e/run.ts and its preflight.
- Deleting uploaded files automatically. The API cannot do it, so the operator deletes them by
  hand from the list.
- The image tools themselves (module/**, gateway/**, protocol/**) and their test assertions,
  apart from moving a read-back from a gateway call to the GM page as described above.
- Task 149 (image_assign folder allowlist) and the docs scrub tasks 146-148.

## Review round 1 — findings

Reviewed HEAD: 186d513649fe1c9110d1bc5996d3ee840b3721b9

- [P2] e2e/image-view/image-view.e2e.test.ts beforeAll — waits on a human approval (the GM's probe `image_upload` via `settle`) under a fixed 15-minute hook timeout; Shape item 3 requires at least the approval budget. route: implementer — use `humanTimeout(1) + RECONNECT_MS` like the other suites. input: approve the probe 16+ min after the prompt → hook fails, all four image-view tests fail to run, and a later approval uploads a PNG never listed under UPLOADED FILES.
- [STYLE] e2e/image-upload/upload.e2e.test.ts:15 — ~175-char header comment line; wrap to ≤100 (.prettierrc printWidth). route: implementer.
- [NOTE, do it if cheap] image-view's hidden-token fixture belongs to the no-permission Actor, so the refusal can't show the hidden-token rule alone. Give player1 LIMITED on that Actor (or use a third Actor the player can see) so only `token.hidden` causes the refusal, and assert the refusal still happens.

## Review round 2 — findings

Source: the headed native e2e run on Foundry 14.369, after review round 1.

1. **P1: player owned-Actor tests fail on v14.**
   - **Upload:** `e2e/image-upload/upload.e2e.test.ts` "a player sets the portrait and token of an Actor they own" fails with `FORBIDDEN: An owned supported world document is required`.
   - **Assign:** `e2e/image-assign/image-assign.e2e.test.ts` "a player sets the portrait and token art of an Actor they own" fails with `FORBIDDEN: You do not own that document`.
   - **Probe:** a read-only probe as the player, on the same world, shows every `resolveActor` clause passing for the player's real character. That character's ownership is `{ default: 2, <gm>: 3, <player>: 3 }`. The policy snapshot is valid, and `playerAgents` is `[]`.
   - **So:** the product guard is fine. The difference is the test fixture, which creates the Actor with `ownership: { default: 3 }` only.
   - **Fix:** create the owned Actor with explicit per-user OWNER for the player user (and default 0), in both suites, as the real world does. Then wait until the player's client sees the Actor with `testUserPermission(game.user, 'OWNER') === true` before calling the tool.
   - **Assertions:** keep the foreign-Actor refusal tests. Make the upload one assert the reason text, as the assign one already does.

## Amendment 1

Date: 2026-10-16. Owner decision (Andrew, in chat).

- image-view's owned Actor (e2e/image-view/image-view.e2e.test.ts, the `actor(..., 3)` call
  around line 101) is no longer created with `ownership: { default: 3 }`. It is created with
  explicit per-user OWNER for the player user, and `default: 0`.
- After creating it, the test waits until the player's client reports
  `testUserPermission(game.user, 'OWNER') === true` for that Actor, the same as the upload and
  assign suites do after review round 2.
- Reason: on Foundry 14.369 the default-only fixture failed the owned-Actor tests in upload and
  assign. Review round 2 has the probe evidence.
- This supersedes the Acceptance line that says the player-owned Actor uses
  `ownership.default: 3`.
- The no-permission Actor (0) and the LIMITED Actor (1) are unchanged.

## Review round 3 — findings

- [P2] e2e/image-view/image-view.e2e.test.ts beforeAll, the owned Actor (`actor(..., 3)` around
  line 101) — still created with `ownership: { default: 3 }`, which fails on Foundry 14.369 (see
  review round 2). route: implementer — per Amendment 1, create it with explicit per-user OWNER
  for the player user and `default: 0`, then wait until the player's client reports
  `testUserPermission(game.user, 'OWNER') === true` before the tests use it, as in the upload
  and assign suites. Leave the 0 and LIMITED (1) Actors as they are.

## Review round 4 — findings

Source: the headed v14 run of image-view (2/4 passed), then a read-only diagnosis with live probes.

1. **[P1] The player refusal test cannot tell who it ran as.** "a player is refused a hidden token they do not own and an Actor with no permission" (around :436) failed at `expect(r.isError).toBe(true)`.
   - The product code refuses both fixtures for a non-GM player on v14: unit tests and live probes agree. A GM-bound session would explain the result exactly. This is a possible leak until one rerun settles it.
   - After every `as(user)` swap, call `world_info` and assert that the bound user name equals the expected user and that `isGM` matches. Do this in image-view, and add the same assertion to the upload and assign suites' `as()` if they have one.
   - Give each refusal assertion a message that names the source and includes `r.text`.
2. **[P2] The scene background test assumes a background that doesn't exist.** "a GM views the active scene background as one image block" uses the world's active scene. On v14 that scene's Level background is null.
   - Create a temporary Scene in beforeAll whose background is the uploaded PNG. On v14 set it on the Level the tools use: `initialLevel`, then `defaultLevel0000`, then the first Level, as image_upload does. On v13 set `scene.background.src`.
   - Point the test at that Scene, and record it in `created` for cleanup.
