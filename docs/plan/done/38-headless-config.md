# 38 — Add headless agent configuration, explicit binding and the owner override

**Repo:** .
**Depends on:** 37, 35, 68, 74, 90 (all merged. 68 for its invite redeem path and `revokePairingsFor`, which re-pairing and removal use. 90 took migration 012 (`012-admin-pairings.ts`), so this task's migration is 013)
**Status:** MVP B wave 4, after 37. Rewritten 2026-10-14 in the MVP B re-plan. Refreshed 2026-10-15 against what 37 shipped (PR #151, Amendments 1-7): the migration moves from 012 to 013 because 90 landed 012 first (90's follow-up note); the relay fingerprint covers several agents (decision e); per-agent and global runner settings are fixed (decision f); 37's residual "an agent user with an empty password cannot be configured" is closed as by design (decision g, Andrew 2026-10-15: the password stays required); and the follow-pool filter applies to follow mode only (decision b), so an explicitly bound agent still resolves while offline. Line references re-checked at d8a8b8e.
**Owns:**
- gateway/src/headless/config/**
- gateway/test/headless/config/**
- gateway/src/store/migrations/013-headless-agents.ts (new)
- gateway/src/store/migrations/index.ts (insertion only: one import and one array entry)
- gateway/src/store/store.ts (insertion only: one `headless` repository field and its construction)
- gateway/src/bin/cli.ts (the `headless add|list|remove` subcommand dispatch and its help text only; not the signal wiring, which is gateway/src/bin/signals.ts and stays untouched)
- gateway/src/config/index.ts (reading the per-agent password keys and refusing an empty one only; decision g. `headlessPassword` handling is unchanged. No change to error messages beyond the new keys' own, which name the key and never echo a value)
- gateway/src/relay/config.ts (`headlessFingerprint` only: an optional third parameter for the stored agents' passwords, and its doc comment plus the doc comment of `RelayConfig.headless`. No change to `RelayConfig`'s shape, `makeRelayConfig`, `parseRelayConfig`, `sameSessionConfig`, `sameConfig` or `describeConfigDiff`; decision e)
- gateway/src/app.ts (several runners from the flag/env agent plus the stored agents, one shared browser discovery and launcher, their reconcile on 68's sweep, the store-backed `isAgentActive`/`isHeadlessAgent`/owner lookup, the multi-agent `headlessFingerprint` input to `relayConfig`, and the follow-mode filter in `knownIdentities` only)
- gateway/src/link/revocation.ts (insertion only: an `onSweep` callback list that the sweep runs on each tick)
- gateway/src/link/server.ts (an optional `headlessOwner(worldId, userId)` option and the `welcome` fields for headless connections only)
- gateway/test/routing/headless-follow.test.ts (new)
- gateway/test/link/headless-welcome.test.ts (new)
- protocol/src/link/messages.ts (insertions only: optional `ownerUserId` and `headless` in `WelcomeMessage`)
- module/src/link/client.ts (keep the two `welcome` fields only, next to `admin` at :601)
- module/src/link/bridge.ts (owner and headless from `welcome` only, at :71 and :142)
- module/test/link/headless-owner.test.ts (new)
- gateway/test/store/store.test.ts, gateway/test/store/admin-flag.test.ts and gateway/test/store/retire-legacy-pairings.test.ts (migration-count and `user_version` assertions forced by migration 013 only; standing rule, Andrew 2026-10-14; any other test found pinning the count gets the same one-line change)

## Goal
Make headless agents configurable and safe. The operator manages several agents with CLI subcommands, stored in SQLite, with passwords only in the 0600 config file or env. A headless identity is reached only by an explicit binding, never by follow mode. For connections the gateway classifies as headless from its own config, `welcome` names the configured owner so that ask-owner approvals reach that human.

## Context
- docs/plan/specs/2026-10-09-agent-gateway.md:204-207 (credentials in a 0600 file or env), :213-214 (headless config in SQLite), :229-233 (headless off until enabled; the owner is the human who paired the agent).
- docs/plan/done/37-headless-runner.md decisions (a) to (e) and Amendments 2, 5, 6 and 7: the single-agent settings, identity from config, gateway-minted invites with the `isAgentActive` seam, the agent user is not for humans, `profileDir`, `headlessNoSandbox`, and the relay takeover rules ("headless wins": a headless primary never steps down for a plain caller).
- What 37 built, which this task extends rather than replaces:
  - gateway/src/headless/profile.ts:8-24 `agentId` and `profileDir(stateDir, worldId, userId)`; :27-51 `ensureProfileDir` (0700, refuses symlinks and foreign owners).
  - gateway/src/headless/invites.ts: `HeadlessInvites` already keeps one live invite per agent (keyed by world and user), calls `isAgentActive` at mint and at redeem, and has `dropAgent`. One provider serves every agent.
  - gateway/src/headless/runner.ts:97-103 `HeadlessAgent` (one agent per runner, `password: string`); :105-130 `RunnerOptions` (`noSandbox`, `pageCallMs`, `launchMs`, ...); :430-436 the password fill; :271-274 the sandbox-failure message, logged once per runner.
  - gateway/src/headless/browser.ts:105 `findBrowser`, :125-133 `launchOptions` (`chromiumSandbox: !noSandbox`, all three signal handlers off), :138-150 `explainLaunchError`, :200 `playwrightLauncher(executablePath)`.
  - gateway/src/app.ts:187-201 `relayConfig()` and :202-211 `agentCfg` (the flag/env agent); :212-213 `isConfiguredAgent`; :493-543 `startHeadless` (stray-pairing warning, browser discovery, one runner); :632-651 the provider and `isHeadlessAgent` are passed to the link server only when `agentCfg` is set; :714-722 the sweep and the runner start; :723-734 `sessionOptions` and `knownIdentities` from `store.listActivePairings()`; :797-810 OAuth sessions override the selector with the grant's `principal.selector`.
  - gateway/src/relay/config.ts:10-29 `RelayConfig.headless`; :36-46 `headlessFingerprint(agent | undefined, noSandbox)` (scrypt on the password, then sha256 over `[foundryUrl, worldId, userId, noSandbox, pw]`); :106-111 `sameSessionConfig` ("headless wins" for an empty caller field).
  - gateway/src/config/index.ts:46-58 the headless keys in `ConfigSchema` (`headlessPassword` defaults to `''`); :73-91 `ENV_KEYS`; :178-198 `readConfigFile` (fixed message on a JSON error, never the parser's); :213-262 `loadConfig` (an empty env value is skipped at :222-225, and :241-254 requires all four headless settings non-empty together; an empty `headlessPassword` is refused, and decision g keeps that).
  - gateway/src/bin/signals.ts `installShutdownSignals`, called from gateway/src/bin/cli.ts:566. The `--revoke-pairing` style operator commands are parsed by `operatorCommandOf` (cli.ts:233) and run by `runOperatorCommand` (:347-444), before `main` (:446) parses the server flags.
- gateway/src/link/revocation.ts:4 `REVOCATION_SWEEP_MS = 5_000`; :45-63 `sweepOnce` (returns early with no store).
- gateway/src/store/store.ts:134-135 and :444 `revokePairingsFor(worldId, userId)`: one transaction revokes the target's pairings and grants and cancels its unused invites.
- gateway/src/store/migrations/index.ts: positional; 012 is 90's `012-admin-pairings.ts`.
- gateway/src/routing/binding.ts:
  - :89-91 follow mode means no user selector;
  - :197-225 `resolveFollow` (bind to the only connected pairing, re-bind after `REBIND_GRACE_MS`, :40);
  - :228-243 `matching`: the pool is `knownIdentities` (:234); with a user selector, connected identities are added (:235); `exactId` at :241.
- gateway/src/link/server.ts:112-118 the `inviteProvider` and `isHeadlessAgent` options; :577-617 the invite branch (the provider is consulted first, in both modes); :720-731 `classifyHeadless`; :766-775 `welcome`. protocol/src/link/messages.ts:42-51 `WelcomeMessage` is a `strictObject` (it already has the optional `admin`), so an older module rejects unknown fields. Send the new fields only to connections classified headless, whose module comes from the same release.
- module/src/link/bridge.ts:71 and :142 set `ownerUserId: user.id`. module/src/link/client.ts:552-601 handles `welcome` and keeps `admin` at :601.
- The headless toggle is already enforced in the module (module/src/policy/evaluate.ts:30-31, module/src/policy/stage.ts:64-71). This task wires the gateway's classification into it.

## Decisions
Defaults. Follow them unless the PR shows a reason not to.
- (a) **Storage.** Migration 013 adds `headless_agents`: name (primary key), foundry_url, world_id, user_id, owner_user_id or null, created_at. There is no password column. `name` matches `^[a-z0-9][a-z0-9-]{0,31}$`, so its env form (uppercase, `-` to `_`) is unambiguous. The password comes from `AGENT_GATEWAY_HEADLESS_<NAME>_PASSWORD` or the `headless.<name>.password` key (a nested object, `{"headless": {"<name>": {"password": "..."}}}`) of the 0600 `--config` file, which 37 already reads with a fixed error message. 37's single-agent settings still work as an extra agent that is not stored. `headless remove` does not apply to it: it is disabled by restarting the gateway without its flags or env (37 decision c). Every agent, stored or not, uses 37's `profileDir(stateDir, worldId, userId)`, so moving the flag/env agent into SQLite with `headless add` reuses its profile with no file moves. 38 does not define profile paths of its own. `add` refuses a (world, user) that equals the flag/env agent's or another stored agent's.
- (b) **Explicit binding, and how it interacts with 71.**
  - Headless identities are removed from the follow pool. app.ts filters them out of `knownIdentities` only for a session whose effective selector has no user (deps.selector, or the OAuth grant's `principal.selector` at app.ts:803-810). Refreshed 2026-10-15: the original "filter `knownIdentities`" applied to every session would also hide an offline agent from `--user <agent id>` and from an OAuth `exactId` binding, because `matching` adds only *connected* identities on top of `knownIdentities` (binding.ts:234-235). Such a session must still bind to the agent's stored pairing while it is offline.
  - A follow-mode session therefore never binds or re-binds to a headless pairing. A GM tab plus a headless agent is not "ambiguous" for it: it follows the GM tab, and the 30 s re-bind grace never moves it onto the agent.
  - A session reaches a headless identity only with `--world` and `--user <agent id>`, or with an OAuth grant naming it (35, through 74's `exactId` seam).
  - `gateway_status` in follow mode does not list headless identities as candidates.
- (c) **Trust model of the owner override.**
  - `welcome.ownerUserId` and `welcome.headless: true` are sent only to a connection that the gateway classifies as headless from its own config (37 decision b; `classifyHeadless` at server.ts:720-731): its (world, user) is a configured agent's. Since 37 refuses the shared code and operator invites for that identity, its pairings come only from gateway-minted invites. They are never sent to a browser connection. `ownerUserId` comes from a new `headlessOwner(worldId, userId)` link-server option that app.ts answers from the stored row (absent for the flag/env agent and for a row with no owner, in which case only `headless: true` is sent).
  - The module uses `ownerUserId` only when the same `welcome` has `headless: true`, and only if `game.users.get(ownerUserId)` exists. Otherwise approvals fall back to the existing route (owner is the connected user, and GMs can approve).
  - The override is a routing hint for approvals chosen by the operator. It grants no permission: role, policy and Foundry's checks still apply to the agent user.
  - `ctx.agent.headless` is `welcome.headless || linkAgentHeadless()` (37's session flag). Either one makes the agent headless, and neither can make a headless agent non-headless.
- (d) **One provider, one classifier, always on the primary.** 37 passes `inviteProvider` and `isHeadlessAgent` to the link server only when the flag/env agent is set (app.ts:632-651). With stored agents, an agent can be added while the gateway runs, so the primary always creates one `HeadlessInvites` and always passes both. `isAgentActive` and `isHeadlessAgent` are true for the flag/env agent and for any (world, user) with a `headless_agents` row read from the store at call time. 37 already showed that a provider with no matching invite leaves the local shared code working (server.ts:577-617 falls through on `unknown` for a non-agent identity).
- (e) **Relay fingerprint for several agents.** Decision, refreshed 2026-10-15. 37's `RelayConfig.headless` is one digest over one agent. Relay peers on one link port share one state dir and therefore read the same `headless_agents` rows; what differs per process is only what that process brings in from its own flags, env and config file. So:
  - `headlessFingerprint(agent, noSandbox, stored = [])` gains an optional third parameter: the stored agents' passwords this process holds, as `{name, password}` pairs. The digest covers the flag/env agent as in 37, `noSandbox`, and the pairs sorted by name with each password through the same scrypt. With `stored` empty the result is byte-identical to 37's (37's takeover tests in gateway/test/headless/takeover.test.ts pass unchanged), and it is `''` only when there is neither a flag/env agent nor any stored-agent password.
  - The stored rows themselves (URL, world, user, owner) are not in the digest: they are shared, and a `headless add` in another process would otherwise make the primary's startup digest stale and cause a needless takeover.
  - Passwords are read once at process start, like every other setting, and the digest is computed once in `relayConfig()`. No re-read, so no server.ts change is needed (97 owns that file).
  - 37 Amendment 6 "headless wins" carries over unchanged: a primary with a non-empty digest never steps down for a caller whose digest is `''`. A primary that holds a stored-agent password counts as headless even if no row uses it yet, because a later `headless add` would start that agent on it.
  - Callers with a non-empty digest keep 37's rules: newer and different takes over, older and different is refused with `RELAY_CONFIG_MISMATCH`.
- (f) **Runner settings: per agent or global.**
  - Per agent: foundry URL, world, user, password (from the row and the agent's password key) and `profileDir(stateDir, world, user)`. One `HeadlessRunner` per agent, each with its own `isLinked` (`registry.get(world, user)`).
  - Global: `headlessNoSandbox` (a property of the host or container, not of the agent; 37 Amendment 2.2 and review round 7), the test-only `pageCallMs`/`launchMs` and the other `deps.headless.runner` overrides, and the browser. `findBrowser` runs once per primary, the "headless runner browser: ..." line is logged once, and every runner shares one `playwrightLauncher`. The "no Chrome, Edge or Chromium found" line is logged once, not per agent.
  - The sandbox-failure message stays 37's, once per runner. Each runner's own log lines already name its world and user; this task does not dedupe across runners.
- (g) **The agent password is required; an empty one is refused.** Decided by Andrew, 2026-10-15. This closes 37's open residual "an agent user with an empty password cannot be configured" (docs/plan/PLAN.md "Now 0a"; done file review round 9) as by design. Reason: a Foundry user with no password can be logged into by anyone who reaches `/join`, which undercuts 37 decision (d) (the agent user is not for humans).
  - The flag/env agent keeps 37's rule unchanged: `loadConfig` (:241-254) requires a non-empty `headlessPassword` together with the other three settings.
  - Every per-agent key follows the same rule. A key that is present but empty (`""` in the config file, or `AGENT_GATEWAY_HEADLESS_<NAME>_PASSWORD` set to the empty string) is a `ConfigError` whose message names the key (`headless.<name>.password` or the env name) and never a value. An absent key means no password is available: that stored agent is not started, and one log line names it.
  - runner.ts is not touched; its comment at :430 ("Config requires headlessPassword") stays true.
  - **Note for 43:** the docs must say that the agent user needs a Foundry password.

## Acceptance
- [ ] `foundry-agent-gateway headless add <name> --foundry-url <u> --world <id> --user <id> [--owner <id>]`, `headless list` and `headless remove <name>` manage rows in `headless_agents`. `list` prints no password. A test inspects the SQLite file after `add` with a password in env and finds no password.
- [ ] `add` refuses a password flag, a name that does not match `^[a-z0-9][a-z0-9-]{0,31}$`, a `--foundry-url` that `normalizeFoundryUrl` refuses (without echoing it), and a `--user` equal to an existing stored agent's or the flag/env agent's user in the same world.
- [ ] The primary starts one 37 runner per agent that has a password available (the flag/env agent plus each stored one), each on its own `profileDir`, and logs one line naming any stored agent that has none. A test with the fake launcher starts two stored agents and asserts two different user-data dirs, both under `<state dir>/headless/profiles/`, one browser discovery, and `noSandbox` passed equally to both launches.
- [ ] Password required (decision g): `{"headless": {"a1": {"password": ""}}}` in the 0600 config file, and `AGENT_GATEWAY_HEADLESS_A1_PASSWORD=` set to the empty string, each make `loadConfig` throw a `ConfigError` whose message contains `a1` and the key name; with the key absent, `a1` is not started and one log line names it; `"headlessPassword": ""` with the other three flag/env settings is still refused as in 37 (tests). `git diff main -- gateway/src/headless/runner.ts` is empty.
- [ ] Relay fingerprint (decision e), in gateway/test/headless/config/:
  - `headlessFingerprint(agent, ns)` equals `headlessFingerprint(agent, ns, [])`;
  - it changes when a stored password changes, when a stored name is added, and not when the pairs are given in a different order;
  - `headlessFingerprint(undefined, false, [{name: 'a1', password: 'p'}])` is a 64-hex digest, not `''`;
  - the wire form of the relay config contains no password;
  - app-level: two gateways sharing a state dir and the same config file relay (no takeover) after a `headless add` made between their starts; a newer plain gateway (no flag/env agent, no stored passwords) relays to a primary that holds only a stored-agent password, and the primary's runners keep running.
- [ ] Removal reaches a running gateway. `headless remove` runs in a separate CLI process that writes SQLite. The running gateway reconciles stored agents on every tick of 68's revocation sweep (`REVOCATION_SWEEP_MS`, through the `onSweep` hook): no second timer.
  - For an agent whose row is gone, it calls the runner's `stop()` (the browser context closes and the profile is kept), calls the provider's `dropAgent`, and relies on the same sweep to close the agent's live link connection, whose pairings `remove` revoked.
  - The provider's `isAgentActive` (37 decision c) reads the `headless_agents` row from the store at mint time and again at redeem time. Redeem time is the authority, so an invite minted before removal cannot pair afterwards.
  - Tests in gateway/test/headless/config/remove-live.test.ts, with a fake launcher and a short sweep:
    - remove while an invite is outstanding: redeeming it is refused with `PAIRING_INVALID` and creates no row;
    - after remove, the runner is stopped within one sweep interval plus 1 s, and no new invite is minted;
    - pairing for that agent stays refused until it is re-added;
    - `headless add` with the same (world, user) (its password already held by the gateway) starts a fresh runner on the same `profileDir` within one sweep interval, and it pairs again through a newly minted invite.
- [ ] Profile cleanup on `headless remove <name>` keeps the profile. The command deletes the row and revokes that agent's active pairings through 68's `store.revokePairingsFor(world, user)`, the same path as `--revoke-pairing`. The token in the old profile is then useless, a running gateway closes the agent's live connection within 68's sweep interval, and the agent's OAuth grants are revoked. The command then prints the profile path, saying it can be deleted once the gateway has restarted. It never deletes files, because a running gateway's Chromium may still hold the dir. Re-adding the same (world, user) reuses the dir, and the runner pairs again through a newly minted invite. Each agent re-pairs (a lost token, a new profile) only through a fresh minted invite redeemed by 68's path, which revokes the old pairing as a replacement (tests).
- [ ] With no flag/env agent and no stored agents, the primary still passes the provider and classifier (decision d), and the local shared code pairs a human (test).
- [ ] Follow mode (gateway/test/routing/headless-follow.test.ts):
  - with only a headless agent connected, a follow-mode session is unbound and gets the not-connected error;
  - with a GM tab and a headless agent connected, it binds to the GM tab and is not ambiguous;
  - after the GM tab is gone for longer than `REBIND_GRACE_MS`, it does not re-bind to the agent;
  - a session started with `--world w1 --user <agent id>` binds to the agent, both while it is connected and while it is offline with an active pairing (bound with no connection, not unbound).
- [ ] `welcome` for a headless-classified connection carries `headless: true` and the configured `ownerUserId` (no `ownerUserId` for the flag/env agent or a row without owner). A browser connection for a non-agent user, even one that sent `hello.headless: true`, gets neither field (gateway/test/link/headless-welcome.test.ts).
- [ ] Module: with `welcome.headless: true` and `ownerUserId: 'owner1'` (an existing user), both bridge paths set `ctx.agent.ownerUserId` to `owner1` and `headless` to true. With `ownerUserId` but no `headless: true` the field is ignored, and with an unknown owner id it falls back (module/test/link/headless-owner.test.ts).
- [ ] With `headlessAgentsEnabled` off, a call from a connection whose `welcome` said `headless: true` is denied with the localized reason, even when the session flag is absent (test).
- [ ] `gateway/src/store/migrations/013-headless-agents.ts` is the 13th entry of `MIGRATIONS`, after 90's 012 (`grep -n "m013" gateway/src/store/migrations/index.ts`).
- [ ] `git diff main -- gateway/src/relay/` touches only `headlessFingerprint` and the two doc comments in config.ts (no change to server.ts, upstream.ts, secondary.ts or constants.ts).
- [ ] `npm run verify` passes.

## Out of scope
- The runner's lifecycle, minting its invites, the browser layouts, and Chromium in the image (37).
- Changing 68's invite or revocation mechanism.
- The relay handshake, the capability flag and any server.ts/upstream.ts/secondary.ts/constants.ts change (97). The takeover rules from 37 Amendments 5-7 are kept, not changed.
- Re-reading the config file or env at runtime: a stored agent added while the gateway runs starts only if the gateway already holds its password.
- Redacting the existing `normalizePublicUrl`/`normalizeLinkUrl`/`--allow-origin` error echoes (96; it also edits config/index.ts and cli.ts error messages, so expect a small merge, not an overlap of qualifiers).
- `gateway.db` created 0644 and the shared "playwright-core is not installed" constant (37's other follow-ups, not this task's).
- A GM-facing agents app (18).
- Docs (43).

## Review round 1 — findings
Reviewed HEAD: 37ce211.

- [P2] gateway/test/routing/headless-follow.test.ts:47-60: the follow-mode tests do not test app.ts's wiring. `open()` builds its own `knownIdentitiesFor(selector.user, …, (_w,u) => u === AGENT)`, so nothing guards app.ts:858-870 or the OAuth selector argument at app.ts:939-943. Add app-level tests against `createApp`:
  - `deps.selector` in follow mode with a connected headless agent: it is not bound;
  - an OAuth `principal.selector` naming an offline agent: it still binds.
  route: implementer
  input: replace app.ts's `isActiveAgent` argument with `() => false` →  every test still passes.
- [P3] gateway/src/bin/cli.ts:470-472: `--foundry-url`, `--owner` and `--password` are global parseArgs options, and nothing refuses them outside `headless add`. Refuse them anywhere else (exit 2 with a message), following the `operatorCommandOf` pattern at cli.ts:262-266 ("--ttl and --origin go with --invite"). The message must never echo the value.
  route: implementer
  input: `foundry-agent-gateway --password hunter2` →  the server starts and ignores the flag; before, it exited 2 "Unknown option". The same applies to `headless list --owner x`.
- [P3] gateway/src/config/index.ts:123: a `headless.<name>` entry that is not an object is silently treated as "no password". Refuse it with a ConfigError that names the key, never the value.
  route: implementer
  input: config file `{"headless": {"a1": "pw"}}` →  no error; a1 just never starts.

## Review round 2 — findings
Reviewed HEAD: 2c6e2ab. All round 1 findings are FIXED (mutation-proven).

- [P3] gateway/test/headless/follow-app.test.ts is a new file outside Owns. Move it to gateway/test/headless/config/follow-app.test.ts, which Owns already covers, and adjust only the relative imports. Content otherwise unchanged; both tests must still pass.
  route: implementer

## Review round 3 — findings (external)
Andrew's PR review of #153 at fa08e37 (2026-10-15).

- [P2] gateway/src/headless/config/commands.ts:113: adding an agent leaves existing connections with a stale classification. A browser already connected as that (world, user) keeps its old `headless` status and approval owner, so it can bypass the headless-disabled policy and get requests attributed wrongly. When an identity becomes a headless agent, revoke the affected connections (and existing pairings) so they re-pair and are classified afresh. Revoking is consistent with 37 decision (d): the agent user is not for humans. Apply the same rule wherever classification can change at runtime: `add`, the owner changing on re-add, and `remove` if it is not already covered. A running gateway must close the affected live connection within one revocation sweep.
  - Test: a connected non-headless client for (w, u), then `headless add` for (w, u) →  within one sweep that connection is closed and its pairing revoked, and the next connection for (w, u) is classified headless with the stored owner. The test must fail on fa08e37.
  route: implementer
- [P3] gateway/src/app.ts:634: an agent named `constructor` bypasses the missing-password check. The object lookup returns an inherited function, so the runner launches with an invalid password. Use own-property checks (`Object.hasOwn`) or a `Map` for every name-keyed lookup in the headless config path (config/index.ts per-agent keys, app.ts, commands.ts). Also refuse, or safely handle, names such as `constructor`, `__proto__` and `toString` if the name rule allows them.
  - Test: an agent named `constructor` with no password is "not started" (one log line) and never launches.
  route: implementer

## Review round 4 — findings
Reviewed HEAD: 0fd6398 (re-review of the round 3 external fix). Both parts are FIXED in code with mutation proofs. One test half and one wording issue remain.

- [P2] gateway/test/headless/config/add-revokes.test.ts:287-291: the test is missing round 3's second assertion, "the next connection for (w, u) is classified headless with the stored owner". After the sweep, let a connection for (W, U) pair through the app (mint an invite via the app's provider, or let the runner pair), and assert its `welcome` contains `{headless: true, ownerUserId: <stored owner>}`. It must fail when app.ts's `headlessOwner` is mutated to always return `undefined`.
  route: implementer
- [P3] gateway/src/headless/config/commands.ts:14-16, :137-139: `add` calls `revokePairingsFor`, which also revokes the identity's OAuth grants and cancels its unused invites. Its help text and output mention only pairings, and print nothing when the count is zero. Make the help and output say what was revoked and cancelled (pairings, grants, invites), with counts, the way `remove` does. Revoking grants on `add` is intended: the agent user is not for humans.
  route: implementer

## Review round 5 — findings
Reviewed HEAD: fb1d8d6 (round 4 FIXED; reviewed CLEAN). Wording only.

- [P3] gateway/src/headless/config/commands.ts:~157: `remove`'s output reports pairings and invites but not the OAuth grants it also revokes, while its help (:20-21) and `add`'s output both name grants. Name grants in `remove`'s output without a count, as `add` does. The store returns no grant count, and the store is outside Owns.
  route: implementer
- [P3] gateway/src/headless/config/commands.ts:138: "Revoked 0 pairing(s) and its OAuth grants": "its" has no antecedent. Use e.g. "that world and user's OAuth grants". Keep `add` and `remove` worded the same way, and update any test that matches this text.
  route: implementer
