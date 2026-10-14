# 37 — Add the headless runner with gateway-provisioned pairing

**Repo:** .
**Depends on:** 16, 42, 68, 74
**Status:** MVP B wave 4, after the friend-test milestone; 38 follows it. Rewritten 2026-10-14 in the MVP B re-plan. Headless Chromium moved here from 42's base image.
**Owns:**
- gateway/src/headless/** (except gateway/src/headless/config/**, which is 38's; includes the new `profile.ts` path function)
- gateway/test/headless/** (except gateway/test/headless/config/**)
- gateway/src/link/pairing-codes.ts (minting provisioned codes and returning them as the `provisioned` kind from 68's lookup only)
- gateway/src/link/server.ts (the decision (d) refusal of human codes for the agent identity only; the provisioned bypass check is 68's)
- gateway/test/link/headless-*.test.ts (new)
- gateway/src/app.ts (start and stop the runner with the primary only)
- gateway/src/config/index.ts and gateway/src/bin/cli.ts (the single-agent headless settings only)
- gateway/package.json (`playwright-core` dependency only) and package-lock.json
- protocol/src/link/messages.ts (insertion only: an optional `headless` field in `HelloMessage`)
- module/src/link/bridge.ts (the headless flag only)
- module/src/link/toolset.ts (the headless default only)
- module/src/link/runtime.ts (the `hello` headless field only)
- module/test/link/headless-*.test.ts (new)
- gateway/Dockerfile and gateway/docker/** (insertions only: Chromium and the profile volume)

## Goal
Let the gateway run an agent without anyone's browser open. It launches Chromium through `playwright-core` with a persistent profile, logs into Foundry as a dedicated agent user, and pairs with a code the gateway mints in-process for exactly that user, so no human copies codes. It follows the world's lifecycle by polling `/api/status` and never launches worlds. The gateway decides which connection is headless from its own configuration, never from what the browser claims.

## Context
- docs/plan/specs/2026-10-09-agent-gateway.md:204-207 (the headless runner), :153-154 (headless requests relayed to the owner or a GM), :229-231 (headless agents are off until the GM enables them).
- module/src/link/bridge.ts:29-30 `LINK_AGENT_HEADLESS = false`, used at :49 and :120 for `ctx.agent.headless`. module/src/link/toolset.ts:86 and :120 import it as the default for the tool listing.
- The module's headless toggle is already enforced: module/src/policy/evaluate.ts:30-31 and module/src/policy/stage.ts:64-71 deny every call with `headless: true` while `headlessAgentsEnabled` is off.
- module/src/link/runtime.ts:47-62 `getIdentity`, which builds every `hello` field except `type`, `protocolVersion` and `auth`.
- protocol/src/link/messages.ts:11-38 `HelloMessage` is a `strictObject`, so a gateway without this field rejects a `hello` that carries it. Send `headless` only when true: a human's module never sends it, and the runner always talks to the gateway that launched it.
- gateway/src/link/pairing-codes.ts:1-40 and on: `PairingCodes` holds one live human code. `consume` is called at gateway/src/link/server.ts:377.
- gateway/src/link/server.ts:374-391 the pairing-code branch; :392-412 the token branch; :425 `registry.add`.
- gateway/src/link/registry.ts:116-127: last writer wins per (world, user). A human logged in as the agent user would evict the runner, and the reverse.
- module/src/link/client.ts:347-358: on close 1000/`replaced` the client stops for good and reports `REPLACED`.
- gateway/src/app.ts:409-580 `startPrimary` and :294-314 `teardown`, where the runner starts and stops. Only the primary runs it.
- gateway/src/config/index.ts:4-18 `ConfigSchema` and `ENV_KEYS`; :20-42 `readConfigFile` (it refuses group- or world-readable files).
- e2e/lib/browser.ts: the existing Playwright join flow against Foundry, a pattern for `/join`.

## Decisions
Defaults. Follow them unless the PR shows a reason not to.
- (a) **One agent, configured by the operator.**
  - `--headless-foundry-url` / `AGENT_GATEWAY_HEADLESS_FOUNDRY_URL`;
  - `--headless-world <world id>` / `AGENT_GATEWAY_HEADLESS_WORLD`;
  - `--headless-user <Foundry user id>` / `AGENT_GATEWAY_HEADLESS_USER`, an id, not a name;
  - the password only from `AGENT_GATEWAY_HEADLESS_PASSWORD` or the `headlessPassword` key of the 0600 `--config` file. Never a flag.

  38 generalizes this to several agents stored in SQLite.
- (b) **Identity from config.** A link connection is headless if and only if its (world id, user id) equals the configured agent's. `hello.headless` is informational: when it disagrees with the classification the gateway logs one line and ignores it.
- (c) **Provisioned pairing.**
  - When the runner's page has no stored token, the gateway calls `PairingCodes.provision({ worldId, userId, origin })`. `origin` is the canonical origin of the configured `--headless-foundry-url`, the origin the runner's page will connect from.
  - This mints a separate single-use code in memory, marked `provisioned`. It expires after 2 min (`PROVISIONED_CODE_TTL_MS`). It never appears in `current()`, `issue()`, an MCP result or a notice, and does not replace the human code. The operator log gets only a redacted note: "provisioned a pairing code for headless agent <world>/<user> (redacted)".
  - Playwright types it, with the gateway URL, into the module's pairing prompt, the same UI a human uses.
  - 68's lookup returns it as `{ kind: 'provisioned', worldId, userId, origin }`. 68's handshake branch (68 decision f) accepts it directly, skipping server-mode confirmation, only on an exact match of world, user and origin. On any mismatch the code is spent and refused, never left pending. The pairing row gets `verified_role = 'headless'`, so a headless agent is never a pairing observer.
  - Ordering: 68 merges before 37 (wave 3 before wave 4), so 37 only mints, wires the runner and tests end to end. It does not touch the bypass check.
- (d) **The agent user is not for humans.** A human pairing code (not provisioned) whose `hello` claims the configured agent (world, user) is refused with `PAIRING_INVALID`, and the operator log has one line saying that user is the headless agent and pairs only through the runner. At startup, active pairings for the agent identity are listed in the log as a warning. If the runner's page is closed with `replaced`, the runner logs "agent user <name> was taken by another client; the runner is paused" and does not reload until the next world start or 5 min (named constant). It never fights for the slot.
- (e) **Profile, one directory per agent.** Chromium cannot run two persistent contexts on one user-data dir, and a shared profile would mix Foundry login cookies and pairing tokens. So every agent gets its own dir from the start.
  - `profileDir(stateDir, worldId, userId)` in `gateway/src/headless/profile.ts` returns `<state dir>/headless/profiles/<agent-id>/`.
  - `<agent-id>` is `<slug>-<hash>`. `slug` is `<worldId>-<userId>` lowercased, with every character outside `[a-z0-9-]` replaced by `-`, runs of `-` collapsed, and the result cut to 48 characters. `hash` is the first 12 hex characters of `sha256(JSON.stringify([worldId, userId]))`. The hash is computed on the original, case-sensitive ids, so ids that differ only in case or punctuation still get distinct dirs. The id is stable and depends only on (world id, user id).
  - The single flag/env-configured agent from decision (a) uses exactly this scheme. There is no unnamed `profile/` dir, so 38's stored agents reuse an existing profile without moving files.
  - `headless/`, `headless/profiles/` and each agent dir are created 0700 inside the 0700 state dir. The runner refuses to start if any of them is a symlink or is not owned by the current user (`lstat`), and logs which one.
  - The runner launches `launchPersistentContext` on that dir. The token the module stores there survives restarts, so a restart reconnects with the token and mints no code. In Docker the state dir is the `/data` volume from 42, so profiles live under `/data/headless/profiles/`.
- (f) **Module flag.** The runner sets a session-storage flag (`agent-gateway.headless`) with an init script before Foundry loads. The module reads it once at load. `LINK_AGENT_HEADLESS` becomes a function used by bridge.ts (:49, :120) and toolset.ts (:86, :120), and runtime.ts sends `headless: true` in `hello` only when the flag is set.

## Acceptance
Runner:
- [ ] Browser discovery prefers system Chrome, then Edge, then Chromium, then a Chromium downloaded under `<state dir>/browsers/`. The chosen executable is logged.
- [ ] The runner polls `<foundryUrl>/api/status` every 15 s (named constant). When a world is active it opens `/join`, logs in as the configured user and waits for the module's link to connect. When the world goes down, or status fails three times in a row, it closes the browser. Integration test against a stub HTTP server that simulates the status transitions.
- [ ] The runner itself navigates to or fetches only `/api/status`, `/join` and `/game`, never a setup or admin endpoint (test records the runner's navigations and requests against the stub).
- [ ] The runner runs only on the primary. It stops within 5 s of `app.stop()`, a step-down, or `teardown` (tests with a fake browser launcher).

Pairing and identity:
- [ ] A provisioned code for (w1,u-agent) pairs a FakeModule that says hello as (w1,u-agent) from the configured origin. The same code presented with (w1,u-gm), or from another origin, is refused, and the code is then spent (tests).
- [ ] Server mode, unattended: with `--server-mode`, no observer online and no stored token in the agent's profile, the runner (fake browser launcher, FakeModule page) gets a provisioned code, pairs without any confirmation prompt, and its `world_info` call succeeds. In the same gateway, a human code for another user still goes to pending (test).
- [ ] The operator log contains the redacted provisioning note and never the code itself (test).
- [ ] A provisioned code never appears in stderr, in `gateway_status`, in a not-connected error or in an MCP notice (test captures all four).
- [ ] A human code with a `hello` for the configured agent identity is refused with `PAIRING_INVALID`, and the log names the reason (test).
- [ ] A FakeModule for the agent identity sending `headless: true` and one for another user sending `headless: true` are classified headless and not headless, respectively, and the second produces the mismatch log line (test).
- [ ] A restart with the same profile dir reconnects with the stored token and mints no provisioned code (test with a fake browser whose storage persists).
- [ ] `profileDir` (gateway/test/headless/profile.test.ts):
  - two agents (w1,uA) and (w1,uB) get distinct dirs;
  - so do ids differing only in case (`(w1,"AbC")` and `(w1,"abc")`);
  - the same (world, user) always gets the same dir;
  - every result is under `<state dir>/headless/profiles/` and matches `^[a-z0-9-]{1,48}-[0-9a-f]{12}$`, also for ids containing `/`, `..` or spaces;
  - created dirs are mode 0700 (skipped on win32), and a symlinked `profiles/` makes the runner refuse to start.
- [ ] The flag/env agent's runner launches on `profileDir(stateDir, world, user)`, never `<state dir>/headless/profile` (test with the fake launcher).

Module:
- [ ] With the session flag set, `ctx.agent.headless` is true in both bridge paths, the tool listing uses the same value, and `hello` carries `headless: true`. Without it, `hello` has no `headless` key (`module/test/link/headless-*.test.ts`).
- [ ] With the flag set and `headlessAgentsEnabled` off, a call through the bridge is denied with `AGENT_GATEWAY.Policy.headlessAgentsDisabled` (the existing policy, now reached).

Docker:
- [ ] The image from 42 gains Chromium in a final stage (Debian `chromium`), the runner finds it as the system browser, and profiles live under `/data/headless/profiles/<agent-id>/`. The PR reports the image size before and after. Compose needs no new volume, because `/data` is already one.

Manual:
- [ ] Against foundry.local v14 with a dedicated agent user, the runner joins `test-world` with no human copying a code, and `world_info` over a session bound with `--world` and `--user <agent id>` works. Log in the PR.
- [ ] `npm run verify` passes.

## Out of scope
- Several agents, SQLite storage of agent config, the `headless add|list|remove` commands and the owner override (38).
- `welcome` fields (38).
- Follow-mode exclusion of headless identities (38).
- Headless agents as pairing observers for 68.
- Docs (43).
