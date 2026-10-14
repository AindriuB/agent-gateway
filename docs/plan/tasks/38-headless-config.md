# 38 — Add headless agent configuration, explicit binding and the owner override

**Repo:** .
**Depends on:** 37, 35, 68, 74 (for migration order: 35's 010 and 68's 011 must merge before this task's 012)
**Status:** MVP B wave 4, after 37. Rewritten 2026-10-14 in the MVP B re-plan. It holds migration 012 (74 decision h; it moved from 011 because 68 lands first and takes 011).
**Owns:**
- gateway/src/headless/config/**
- gateway/test/headless/config/**
- gateway/src/store/migrations/012-headless-agents.ts (new)
- gateway/src/store/migrations/index.ts (insertion only: one import and one array entry)
- gateway/src/store/store.ts (insertion only: one `headless` repository field and its construction)
- gateway/src/bin/cli.ts (the `headless` subcommands only)
- gateway/src/config/index.ts (reading the per-agent password keys only)
- gateway/src/app.ts (several runners from the stored agents, and the follow-pool filter in `knownIdentities` only)
- gateway/src/link/server.ts (the `welcome` fields for headless connections only)
- gateway/test/routing/headless-follow.test.ts (new)
- gateway/test/link/headless-welcome.test.ts (new)
- protocol/src/link/messages.ts (insertions only: optional `ownerUserId` and `headless` in `WelcomeMessage`)
- module/src/link/client.ts (keep the two `welcome` fields only)
- module/src/link/bridge.ts (owner and headless from `welcome` only)
- module/test/link/headless-owner.test.ts (new)

## Goal
Make headless agents configurable and safe. The operator manages several agents with CLI subcommands, stored in SQLite, with passwords only in the 0600 config file or env. A headless identity is reached only by an explicit binding, never by follow mode. For connections the gateway classifies as headless from its own config, `welcome` names the configured owner so that ask-owner approvals reach that human.

## Context
- docs/plan/specs/2026-10-09-agent-gateway.md:204-207 (credentials in a 0600 file or env), :213-214 (headless config in SQLite), :229-233 (headless off until enabled; the owner is the human who paired the agent).
- docs/plan/tasks/37-headless-runner.md decisions (a) to (d): the single-agent settings, identity from config, provisioned pairing, and the agent user is not for humans.
- docs/plan/tasks/74-remote-exposure-foundation.md decision (h): 012 is this task's. Because the migrations array is positional, 35's 010 and 68's 011 must have merged first, which the wave order guarantees.
- gateway/src/app.ts:504-509 `knownIdentities` from `store.listActivePairings()`.
- gateway/src/routing/binding.ts:
  - :87-89 follow mode means no user selector;
  - :195-224 `resolveFollow` (bind to the only connected pairing, re-bind after `REBIND_GRACE_MS`, :38);
  - :226-241 `matching`: with no user selector the pool is `knownIdentities` only (:232, :236). With a user selector, connected identities are added (:233).
- gateway/src/link/server.ts:433-440 `welcome`. protocol/src/link/messages.ts:40-47 `WelcomeMessage` is a `strictObject`, so an older module rejects unknown fields. Send them only to connections classified headless, whose module comes from the same release.
- module/src/link/bridge.ts:49 and :120 set `ownerUserId: user.id`. module/src/link/client.ts:369-400 handles `welcome`.
- The headless toggle is already enforced in the module (module/src/policy/evaluate.ts:30-31, module/src/policy/stage.ts:64-71). This task wires the gateway's classification into it.

## Decisions
Defaults. Follow them unless the PR shows a reason not to.
- (a) **Storage.** Migration 012 adds `headless_agents`: name (primary key), foundry_url, world_id, user_id, owner_user_id or null, created_at. There is no password column. The password comes from `AGENT_GATEWAY_HEADLESS_<NAME>_PASSWORD` or the `headless.<name>.password` key of the 0600 `--config` file. 37's single-agent settings still work as an extra agent that is not stored. Every agent, stored or not, uses 37's `profileDir(stateDir, worldId, userId)`, so moving the flag/env agent into SQLite with `headless add` reuses its profile with no file moves. 38 does not define profile paths of its own.
- (b) **Explicit binding, and how it interacts with 71.**
  - Headless identities are removed from the follow pool. app.ts filters them out of `knownIdentities`, which is the whole pool when there is no user selector (binding.ts:232-236).
  - A follow-mode session therefore never binds or re-binds to a headless pairing. A GM tab plus a headless agent is not "ambiguous" for it: it follows the GM tab, and the 30 s re-bind grace never moves it onto the agent.
  - A session reaches a headless identity only with `--world` and `--user <agent id>`, or with an OAuth grant naming it (35, through 74's `exactId` seam).
  - `gateway_status` in follow mode does not list headless identities as candidates.
- (c) **Trust model of the owner override.**
  - `welcome.ownerUserId` and `welcome.headless: true` are sent only to a connection that the gateway classifies as headless from its own config (37 decision b): its (world, user) is a configured agent's. Since 37 refuses human codes for that identity, its pairings come only from provisioned codes. They are never sent to a browser connection.
  - The module uses `ownerUserId` only when the same `welcome` has `headless: true`, and only if `game.users.get(ownerUserId)` exists. Otherwise approvals fall back to the existing route (owner is the connected user, and GMs can approve).
  - The override is a routing hint for approvals chosen by the operator. It grants no permission: role, policy and Foundry's checks still apply to the agent user.
  - `ctx.agent.headless` is `welcome.headless || the session flag` (37). Either one makes the agent headless, and neither can make a headless agent non-headless.

## Acceptance
- [ ] `foundry-agent-gateway headless add <name> --foundry-url <u> --world <id> --user <id> [--owner <id>]`, `headless list` and `headless remove <name>` manage rows in `headless_agents`. `list` prints no password. A test inspects the SQLite file after `add` with a password in env and finds no password.
- [ ] `add` refuses a password flag, and refuses `--user` equal to an existing agent's user in the same world.
- [ ] The primary starts one 37 runner per stored agent that has a password available, each on its own `profileDir`, and logs one line naming any agent that has none. A test with the fake launcher starts two agents and asserts two different user-data dirs, both under `<state dir>/headless/profiles/`.
- [ ] Profile cleanup on `headless remove <name>` keeps the profile. The command deletes the row, revokes that agent's active pairings (so the token in the old profile is useless), and prints the profile path, saying it can be deleted once the gateway has restarted. It never deletes files, because a running gateway's Chromium may still hold the dir. Re-adding the same (world, user) reuses the dir, and the runner pairs again with a provisioned code (test).
- [ ] Follow mode (gateway/test/routing/headless-follow.test.ts):
  - with only a headless agent connected, a follow-mode session is unbound and gets the not-connected error;
  - with a GM tab and a headless agent connected, it binds to the GM tab and is not ambiguous;
  - after the GM tab is gone for longer than `REBIND_GRACE_MS`, it does not re-bind to the agent;
  - a session started with `--world w1 --user <agent id>` binds to the agent.
- [ ] `welcome` for a headless-classified connection carries `headless: true` and the configured `ownerUserId`. A browser connection for a non-agent user, even one that sent `hello.headless: true`, gets neither field (gateway/test/link/headless-welcome.test.ts).
- [ ] Module: with `welcome.headless: true` and `ownerUserId: 'owner1'` (an existing user), both bridge paths set `ctx.agent.ownerUserId` to `owner1` and `headless` to true. With `ownerUserId` but no `headless: true` the field is ignored, and with an unknown owner id it falls back (module/test/link/headless-owner.test.ts).
- [ ] With `headlessAgentsEnabled` off, a call from a connection whose `welcome` said `headless: true` is denied with the localized reason, even when the session flag is absent (test).
- [ ] `gateway/src/store/migrations/012-headless-agents.ts` is the 12th entry of `MIGRATIONS`, after 35's 010 and 68's 011.
- [ ] `npm run verify` passes.

## Out of scope
- The runner, provisioned codes and Chromium in the image (37).
- Headless agents as observers for 68's pairing confirmation.
- A GM-facing agents app (18).
- Docs (43).
