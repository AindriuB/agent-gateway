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

## Amendment 1 (Andrew, 2026-10-14)

Owns widens to all of `module/src/link/client.ts`. The code reviewer found that the extra edits are required: `start` and `connect` must present the legacy credential before their PAIRING_REQUIRED guards fire, and `unpair()` needs the private `requirePairing()`. The legacy-migration contract stays as written (a rejected legacy token clears the legacy setting), recorded as an accepted residual: a browser whose legacy credential belongs to A, where B logs in first, makes A re-pair once.

## Review round 1 — findings

Reviewed HEAD: ba4bb02. Routed to the implementer: the three P2s and the two P3s. The scope NOTE is settled by Amendment 1, and the legacy-clearing NOTE is accepted as a residual.

VERDICT: FIX

FINDINGS
- [P2] module/test/link/user-switch.test.ts:61-97 (also module/test/link/pairing.test.ts:172-226) — None of the tests checks the per-user keying that actually ships. That keying lives in `runtime.ts` (`owner()`, `getToken`, `setToken`, `hasOtherTokens`). `user-switch.test.ts` builds its own copy of those deps in `clientFor()`. The `runtime.ts` reload test in `pairing.test.ts` only ever uses one user.
  route: implementer — add a runtime-level test. Load `getLinkClient()` with `game.user` set to A and A's entry stored, then reset the modules with `game.user` set to B. Assert that no `pairingToken` hello is sent, the state is `PAIRING_REQUIRED`, `hasStoredToken()` is false, and A's localStorage bytes are unchanged.
  input: the key is changed so every user shares it: `runtime.ts:46` `userId: 'shared'`  →  B would be sent A's token, and B's rejection would delete A's entry. Every test still passes.
  proof: with that one-line change in a scratch copy, the 4 files touched by the diff passed (48 tests). The other 6 test files that import `runtime.js` also passed (74 tests).

- [P2] module/src/link/client.ts:524-528 — When a legacy credential is migrated, `authSource` stays `'legacy'` for the rest of the connection. If the gateway later revokes that live connection, `pairingInvalid` clears the already-empty legacy setting and leaves the migrated keyed entry in place, even though that token is now dead.
  route: implementer — set `this.authSource = 'keyed'` once the migration commits. This brings the code back in line with "only the credential that was sent is stale" and the TOKEN_REJECTED acceptance item.
  input: B's legacy token is accepted and moved to B's keyed entry. B then pairs from another browser, so the gateway sends `reject` PAIRING_INVALID and closes with 1008 (gateway/src/link/server.ts:197-210).  →  The state is TOKEN_REJECTED, but B's keyed entry survives. The pairing window still shows the paired state and Unpair. On the next load the dead token is sent again and rejected once more before it is removed.

- [P2] module/src/link/client.ts:328-331 (meaning set by runtime.ts:68-72) — `hasStoredToken()` now only looks up the entry for the current gateway address. Its doc comment and the 87 contract say it is true for any gateway. As a result, a paired player whose gateway address changes loses the Players-list "needs pairing" indicator.
  route: implementer — add a store lookup for "any entry for this (world, user)" and use it in `hasStoredToken`. `tokenFor` keeps the lookup for the current address. The task's "reflect only the current user's entry" still holds.
  input: a non-GM player is paired with gateway X. The GM changes `defaultGatewayUrl` to Y, and the player reloads.  →  `start()` sets PAIRING_REQUIRED because of `hasOtherTokens`. But `hasStoredToken()` is false, so the indicator's `used` stays false and the indicator is hidden (status-indicator.ts:76). Before this branch it showed `needsPairing`. Submitting the pairing form now shows a toast instead of the status line (apps/pairing/index.ts:223).

- [P3] module/src/link/client.ts:524-528 — The legacy-migration branch awaits `setToken` and `clearLegacyToken` and then reports connected without the `this.socket !== origin` check that the `pairingToken` branch above it has.
  route: implementer — repeat the origin check after the awaits.
  input: `stop()` or a restart runs while `game.settings.set` for the legacy setting is still pending  →  the state reads `connected` for a socket that has been detached. Only a narrow window, since a client-scope set settles in microtasks.

- [P3] module/src/link/client.ts:328 — The doc comment "(for any gateway)" is now wrong (see the third P2). Fix it together with that finding.
  route: implementer

- [NOTE] module/src/link/client.ts:684-689, spec Acceptance "Legacy migration" — Suppose B logs in first in a browser whose legacy credential belongs to A. A's token is sent in B's hello. The gateway rejects it (server.ts:557-568), and the client then clears the legacy setting, so A loses the pairing in that browser once and has to pair again. The token cannot end up attached to the wrong user, because the gateway is what decides; when it is accepted, the token is the user's own. The Acceptance text says to clear on rejection, so this is the agreed contract. The only alternative is to keep the legacy credential when a token is rejected, which reopens that Acceptance line and is a question for the orchestrator.

- [NOTE] module/src/link/runtime.ts:80 — `hasOtherTokens` is `size() > 0`. That also counts the user's own entries for other gateways or worlds. The result is still right: when the current user has no usable token, `start()` sets PAIRING_REQUIRED if the browser holds any entry, and stays idle in a fresh browser. The name just overstates what it checks. It reveals only that someone has paired in this browser, never who.

- [NOTE] Store hardening checks out:
  - `__proto__` keys: a stored `__proto__` key only resets the prototype of the local `out` object. Lookups use JSON-array keys, so they never hit it.
  - Wrong-shaped values: wrong-shaped entries are dropped.
  - Huge or hostile values: the store size is limited by the browser's localStorage quota, and `set` trims it back to `MAX_CREDENTIALS`.
  - Storage errors: throwing storage is caught.
  - Token exposure: no token reaches the DOM (`paired` is a boolean), logs, notifications or any world/user setting or flag.

- [NOTE] Scope: `client.ts` changed outside the areas its Owns line names: `start`, `tokenFor`/`parseCredential`, `unpair()`, the token check in `connect`, and the code-reject fallback in `pairingInvalid`. In my view all of it is needed:
  - The legacy-migration Acceptance requires the legacy credential to be presented. Without the changes to `start()` and `connect()`, their guards would send PAIRING_REQUIRED before any hello.
  - `unpair()` must call the private `requirePairing()` to stop the link, as the Unpair Acceptance requires.
  - Recommend amending Owns to the whole of `client.ts` rather than reverting.
  route: orchestrator — Owns line `module/src/link/client.ts (only the token-auth hello, the welcome handling and pairingInvalid, plus the deps interface)`.

SCOPE: module/src/link/client.ts — changes outside the parts Owns names (`start`, `tokenFor`/`parseCredential`, `unpair`, `connect`); route: orchestrator, see the scope NOTE above. Every other path is inside Owns, and `gateway/` is untouched.
