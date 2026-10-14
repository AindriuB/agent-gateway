# 89 — Key stored pairing credentials by gateway, world and Foundry user

**Repo:** .
**Depends on:** 87
**Owns:**
- module/src/link/credential-store.ts (new)
- module/src/link/runtime.ts
- module/src/link/client.ts (only the token-auth hello, the `welcome` handling and `pairingInvalid`, plus the deps interface)
- module/src/link/status-indicator.ts (only if `hasStoredToken`'s meaning changes)
- module/src/apps/pairing/index.ts
- templates/pairing/pairing.hbs
- lang/en.json (insertions only)
- styles/agent-gateway.css (insertions only)
- module/test/link/credential-store.test.ts (new)
- module/test/link/user-switch.test.ts (new)
- module/test/link/client.test.ts
- module/test/link/reconnect.test.ts
- module/test/link/pairing.test.ts
- module/test/link/bridge-bundle.test.ts (only the credential seed)
- module/test/link/status-indicator.test.ts
- module/test/apps/pairing-onboarding.test.ts
- module/test/apps/pairing-one-per-user.test.ts

## Goal
Make pairing belong to the Foundry user, not to the browser. Today one client-scoped
`pairingCredential` {url, token} is shared by every user who logs in from a browser. When a
second user logs in, the first user's token goes into the second user's hello. The gateway
rejects it, and the client then wipes the first user's pairing. This is a live bug (2026-10-14):
Andrew logged out as Gamemaster and in as "ChatGPT", and Gamemaster lost its pairing. After this
task, credentials are stored in the browser, keyed by (gateway URL, world id, user id), and only
the logged-in user's credential is ever sent, cleared or shown.

## Context
- module/src/settings/index.ts:47-56 (origin/main) — the legacy client-scoped `pairingCredential` registration. It stays registered so migration can read it. Do not change it.
- module/src/link/runtime.ts:38-47 (claude/task-87) — `getToken`/`setToken` bound to the single setting. This is the seam to rebind to the keyed store.
- module/src/link/client.ts:52-57, 271-311 (claude/task-87) — `getToken`/`setToken` deps, `tokenForUrl`, `readCredential`, `hasStoredToken`, `start`.
- module/src/link/client.ts:398-407 (claude/task-87) — the token is chosen for the hello.
- module/src/link/client.ts:460-462 (claude/task-87) — `welcome` stores a newly issued token. A token-auth welcome carries no `pairingToken`, and that welcome is where migration must commit.
- module/src/link/client.ts:445, 523-535, 622-643 (claude/task-87) — the close-1008 and `reject` PAIRING_INVALID paths, which reach `pairingInvalid`, which calls `setToken(null)` and then reports `TOKEN_REJECTED`.
- module/src/link/bridge.ts:22, module/src/approvals/live.ts:15,45-52 — existing direct `localStorage` use with a world-scoped key. Follow this shape: an injected Storage-like dependency, and try/catch around reads.
- module/src/apps/pairing/index.ts:207-225 (claude/task-87) — the submit path that uses `hasStoredToken()` and `start()`.
- module/src/link/status-indicator.ts:51,71-76 (claude/task-87) — the indicator's "in use" check through `hasStoredToken`.
- gateway/src/link/server.ts:557-568 (origin/main) — the gateway rejects a token whose pairing is for another world or user. That is correct, and it does not change.
- docs/plan/done/87-link-resilience-diagnostics.md (on claude/task-87) — the `TOKEN_REJECTED` contract this task narrows.

## Acceptance
- [ ] A new `module/src/link/credential-store.ts` reads and writes one browser-local map (`localStorage`, or a client-scoped value that lives only in the browser). Each entry is keyed by (normalized gateway URL, world id, Foundry user id) and holds the token plus a timestamp used for eviction. Reads tolerate a missing, unparsable or wrong-shaped value and treat it as empty, never throwing.
- [ ] Nothing in the diff writes a token to a `world`-scoped or `user`-scoped setting, to document or user flags, or to any other server-persisted store. `rg -n "scope: 'world'|scope: 'user'|setFlag" ` over the diff shows no token-bearing value.
- [ ] `getToken` (or its replacement) returns only the entry for the current `game.world.id`, `game.user.id` and the effective gateway URL. A test with user A paired and user B logged in (no entry for B) shows that B's attempt sends no `hello` with `auth.kind === 'pairingToken'`, the state is `PAIRING_REQUIRED`, and A's entry is byte-identical afterwards.
- [ ] Switching back to A in the same store (a new `LinkClient` with A's identity) sends a hello with `auth: {kind:'pairingToken', token: <A's token>}`.
- [ ] When B holds its own entry and the gateway rejects it (`reject` PAIRING_INVALID, and separately a close 1008 `PAIRING_INVALID`), only B's entry is removed, A's entry is unchanged, and the state is `{kind:'disconnected', reason:'TOKEN_REJECTED'}`. A test covers each path.
- [ ] A rejected pairing code (code-auth hello) removes no entry. 87's fallback to the current user's token is unchanged.
- [ ] A code-paired `welcome` with `pairingToken` stores the token under the key of the identity that sent the hello, and does not overwrite any other key.
- [ ] Legacy migration: when there is no keyed entry for the current user and the legacy `pairingCredential` holds a valid {url, token} for the effective gateway, the client presents it. On the first accepted (token-auth) `welcome`, it is written under the current user's key and the legacy setting is cleared. If it is rejected instead, the legacy setting is cleared and no keyed entry is created or removed. Tests cover both branches and assert that the other keys are unchanged.
- [ ] Legacy `pairingToken` handling (runtime.ts `clearLegacyToken`) is unchanged, and the existing test at module/test/link/pairing.test.ts:108 passes without edits to its assertions.
- [ ] The map is capped at a named constant (16 entries suggested). Adding an entry beyond the cap evicts the entry with the oldest timestamp. A test fills cap+1 entries and asserts the size is the cap and the oldest key is gone. Using an entry (an accepted token-auth welcome) refreshes its timestamp.
- [ ] `hasStoredToken()`, the pairing window and the 87 Players-list indicator reflect only the current user's entry. A test with only A's entry, rendered as B, shows the indicator as not in use for a non-GM B, and shows the pairing window without the paired state.
- [ ] The pairing window has an "Unpair this browser" action (new `lang/en.json` key). It removes only the current (gateway, world, user) entry, stops the link and leaves every other entry intact, and a test asserts this.
- [ ] No token reaches the DOM or a log. Tests render the pairing window context and the indicator, and capture `console.*` and `ui.notifications.*` through user switch, rejection, migration and eviction. They assert that no seeded token string appears in any of them.
- [ ] No gateway file and no protocol type in `shared/` (or wherever link messages live) is changed: `git diff --stat origin/main -- gateway` is empty.
- [ ] `npm run verify` passes.

## Out of scope
- The legacy `pairingToken` string: leave it as it is.
- Gateway behaviour, including the one-pairing-per-(world, user) rule, the protocol and the store.
- Moving credentials into Foundry user or world settings or flags. This is refused, not deferred (see Notes).
- `--invite` output formatting and the consent-page offline hint (follow-ups below).
- 87's open follow-ups in PLAN.md (the "inherited" note while connecting, the `pairings(world_id, user_id)` index).
- Any other change to reconnect or backoff behaviour.

## Notes for the scribe
- **Decision (Andrew, 2026-10-14): pair against the Foundry user, not the browser, and keep tokens in browser-local storage only.** Foundry stores user-scoped and world-scoped settings and flags server-side, where any GM and the world database can read them. A token stored there would let a GM, or anyone with the world files, read a player's pairing token and impersonate that player to the gateway. Browser-local storage keyed by (gateway URL, world id, user id) fixes the shared-browser bug without that leak. The cost is that each browser still pairs separately for each user.
- Follow-up (not in this task): `--invite` should print the address and the code on separate labelled lines, and the docs should say "paste into Foundry, don't open in a browser". Two people tried to open the `wss://` string as a link.
- Follow-up (not in this task): the consent page gives no hint when the target user is offline. The neutral wording is deliberate. Consider a GM-side notice, "a sign-in code was requested for X".
