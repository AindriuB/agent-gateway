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

## Review round 2 — findings

Reviewed HEAD: 7f335ca. The new P2 goes to the implementer, with the in-spec fix: the window's `paired` uses the current-gateway lookup.

VERDICT: FIX

All five routed round-1 items are fixed in 7f335ca, and the tests guard each one. Nothing from the original round was lost or only half-applied. However, the fix for the third P2 caused a new defect in the pairing window's Unpair action. That is the reason for FIX.

FINDINGS
- [P2] /Users/Andrew/workspace/foundry-modules/agent-gateway/.claude/worktrees/task-89/module/src/apps/pairing/index.ts:139 (cause: module/src/link/client.ts:331-333 together with runtime.ts:83-86) — The window's `paired` flag now uses `hasStoredToken()`, which since this round is true for an entry under any gateway. `unpair()` removes only the entry for the current gateway. So when the user's entry belongs to an older gateway address, the window shows "Unpair this browser", the click does nothing, and the token stays in localStorage.
  route: implementer — the fix keeps the spec: base the window's `paired` on the current-gateway lookup (for example a public wrapper over `tokenFor(getGatewayUrl())`) and leave `hasStoredToken()` as the any-gateway check for the indicator and the submit path. This matches Acceptance "Unpair … removes only the current (gateway, world, user) entry" and "the pairing window reflect[s] only the current user's entry". The other fix, having Unpair remove every entry for the (world, user), would change that Acceptance line and would go to the orchestrator.
  input: a player is paired with gateway X (entry [X, w, u]). The GM changes `defaultGatewayUrl` to Y, and the player opens the pairing window and clicks Unpair.  →  `unpair()` calls `setToken(null, owner)`. runtime.ts `setToken` resolves the URL to Y and removes [Y, w, u], which does not exist. [X, w, u] remains, `hasUserToken()` is still true, and the window re-renders with the same Unpair button. The user believes the browser is unpaired, but X's token is still stored. At ba4bb02 this did not happen, because the button was hidden in this case.

FIXED
- [P2] runtime-level per-user keying test — FIXED — module/test/link/pairing.test.ts:228-284. Proof: with `userId: 'shared'` in runtime.ts `owner()`, the new test fails (1 failed / 26 passed). With runtime `hasUserToken` changed to `size() > 0`, it also fails.
- [P2] `authSource` stays `'legacy'` after migration — FIXED — module/src/link/client.ts:531-533. Test: user-switch.test.ts:263. Proof: removing `this.authSource = 'keyed'` makes that test fail.
- [P2] `hasStoredToken()` only checked the current gateway — FIXED — client.ts:331-333, credential-store.ts:113-121 (`hasUser`), runtime.ts:83-86. Test: user-switch.test.ts:288. Proof: reverting `hasStoredToken` to `readCredential() !== null` makes it fail. (This fix is what causes the new P2 above.)
- [P3] no origin check after the migration awaits — FIXED — client.ts:531. Test: user-switch.test.ts:277. Proof: removing the check makes the test fail.
- [P3] wrong "(for any gateway)" doc comment — FIXED — client.ts:330. The comment now matches the behaviour.

No DRIFT. 7f335ca changes only the five routed items: the new optional `hasUserToken` dep, the store's `hasUser`, the runtime binding, the migration-branch fix and the tests. No Acceptance assertion was edited or weakened, and pairing.test.ts:108 is untouched. 9c18207 changed only the task file, so all of ba4bb02's code is still in HEAD. The five touched test files pass at HEAD in a scratch copy (62 tests). I ran each mutation against user-switch.test.ts and pairing.test.ts.

NOTE (setup, not a defect): the local `main` ref (5540b1e) is behind origin. `git diff main...HEAD` therefore also shows task 87's gateway and docs changes. `git diff --stat ba4bb02..HEAD -- gateway` is empty.

SCOPE: clean. Every path in 9c18207..HEAD is within Owns as amended by Amendment 1.

## Review round 3 — findings (external review on PR #143)

Reviewed HEAD: cf0cb45. Both findings are in-spec and routed to the implementer. This is the last allowed round.

1. [P2] Clear the credential for the rejecting socket's gateway — runtime.ts:74
If the gateway setting changes from X to Y, the existing X socket remains open. A subsequent `PAIRING_INVALID` from X resolves the current gateway setting and deletes Y's credential, leaving X's rejected credential intact. Capture the gateway URL with the hello owner and use it when clearing rejected credentials.
2. [P2] Preserve the legacy credential when migration storage fails — client.ts:535
When localStorage is readable but full, `credentials().set()` silently swallows the failed write. Migration then clears the legacy setting, destroying the only persisted copy of the accepted token and requiring pairing again on reconnect. Clear the legacy value only after confirming successful persistence; an in-memory fallback would still lose it after reload. The migration contract (this file, around :54) requires writing the keyed entry before clearing the legacy setting.

## Amendment 2 (Andrew, 2026-10-14)

- A fourth review round is approved, beyond the three-round cap.
- Owns gains `module/test/link/runtime-credentials.test.ts` (new in round 3).
- When a new code-pairing token cannot be persisted (the `setToken` result is `false`, e.g. localStorage quota), the client keeps the token in memory for this session, so reconnects and backoff still use it. It warns once, through a localized `ui.notifications.warn`, that the pairing will not survive a reload because browser storage is full. The warning never includes the token. Reason: on main this case never reached connected; under 89 it shows connected and then needs a new code on the first drop.

## Review round 4 — findings (re-review of round 3)

Reviewed HEAD: ae5ccbe. Routed to the implementer: the P3 test for the `authSource` guard, and the storage-full code-pairing P3, as specified by Amendment 2. The scope item is settled by Amendment 2.

VERDICT: FIX

The only reason for FIX is scope: a new test file is outside `Owns`. It is a one-line amendment for the orchestrator. Both external P2s are fixed, tests guard each fix, and the round-3 commit introduces no drift. The code at HEAD has no P1, P2 or STYLE finding.

FINDINGS
- [P3] module/src/link/client.ts:518 — In the code-pairing `welcome` path, the result of `setToken` is ignored. If the keyed write fails (localStorage full), the window still shows "connected", but the issued token was never stored, and the code has already been cleared. The first network drop then turns into PAIRING_REQUIRED.
  route: orchestrator — the spec does not say what should happen when the issued token cannot be stored. There are two possible fixes: keep the token in memory for this session, or tell the user that pairing will not survive a reload. Each is new behaviour, and the choice belongs to the planner. This is not a regression in kind: on main, a failed client-setting write made the promise reject inside `handle`, and the link never reached connected.
  input: localStorage throws QuotaExceededError on `setItem`. `pair('CODE-1')`, then `welcome` with `pairingToken: 'newTok'`, then close 1006, then advance through the backoff.  →  state goes `connected`, then `{kind:'disconnected', reason:'PAIRING_REQUIRED'}`. Only 1 socket is ever created, so no reconnect is attempted.
  proof: I ran this as a scratch probe in runtime-credentials.test.ts against a copy of HEAD and got exactly that sequence.

- [P3] module/src/link/client.ts:543 — No test guards `if (saved) this.authSource = 'keyed'`. If a write fails while the link is connected through the legacy credential and the gateway then revokes it, the client should clear the legacy setting. With the guard removed it would instead remove a keyed entry that does not exist, and the dead legacy token would be sent once more on the next load before being cleared.
  route: implementer — add a test: fail the write, accept the legacy welcome, send `reject` PAIRING_INVALID, and assert that `pairingCredential` is `''`.
  input: same setup as the test at runtime-credentials.test.ts:116, followed by `reject` PAIRING_INVALID  →  with the guard removed, the legacy credential survives the revocation.
  proof: with the guard removed, all 43 tests in the 4 related files still pass.

- [NOTE] module/src/link/client.ts:535-539 — The migration branch reads the legacy setting again at `welcome` instead of using the credential it presented. Suppose another tab clears the legacy setting between this tab's `hello` and its `welcome`: B's rejection in a second tab of the same browser does this. Then `saved` is vacuously true, `authSource` becomes `'keyed'` and nothing is written. The outcome, A re-pairing once, is the residual already accepted in Amendment 1, so this is not a defect. Storing the presented credential on `connect` would close the gap if anyone wants it.

- [NOTE] client.ts:455 (`onopen`) and :553 (`eventResume`) call `tokenFor(url)` with the socket's URL, but runtime `getToken` (runtime.ts:66-70) only returns the entry for the *current* setting. If the setting changes between `connect` and `onopen`, nothing is sent and the client goes to PAIRING_REQUIRED. If it changes between `hello` and `welcome`, `eventResume` is undefined. Both outcomes are safe: no wrong token is sent and nothing is cleared, and the next connect targets the new URL anyway.

- [NOTE] With the in-memory fallback (`volatile`), a failed migration leaves an in-memory keyed entry while `authSource` stays `'legacy'`. In practice this cannot happen: when localStorage is unavailable, Foundry's client setting `pairingCredential` cannot exist either.

FIXED (round 3, external)
- [P2] Clear the credential for the rejecting socket's gateway — FIXED — client.ts:464 (`helloOwner` now carries `url`), runtime.ts:74 (`c?.url ?? o?.url ?? current`). The same fix covers touch, at runtime.ts:79. Tests: runtime-credentials.test.ts:90 and :104. Proof:
  - Removing `o?.url` from `setToken` fails the reject test.
  - Removing it from `touchToken` fails the touch test.
  - Removing `url` from `helloOwner` fails both.
  - The close-1008 path shares `pairingInvalid`, so it is covered by the same code.
- [P2] Preserve the legacy credential when the migration write fails — FIXED — client.ts:536-540, credential-store.ts:83-91 (`set` returns false on a throw or on volatile storage), runtime.ts:75. Tests: runtime-credentials.test.ts:116 and :130, credential-store.test.ts:69. Proof:
  - Making the legacy clear unconditional fails :116.
  - Having runtime `setToken` return true regardless fails :116.
  - Making `write` return true for volatile storage fails the store test.

DRIFT: none. 8e9b425..HEAD changes only these two findings plus their tests: optional `TokenOwner.url`, `StorageLike.volatile`, `CredentialStore.set` returning a boolean, and the widened `setToken` return type. No Acceptance assertion was edited, and pairing.test.ts:108 is untouched. The migration now clears the legacy credential only after the keyed write is confirmed, as the external finding asked. That is the persist-then-clear order the Acceptance item already specifies, so it is not a weakening.

SWEEP (origin/main...HEAD) for "current setting or assumed write instead of what was presented or persisted":
- Token touch and clear on reject or 1008: they now use the presented URL, world and user. Clean.
- The code-pairing write uses the socket URL and the identity from the `hello`. Clean, apart from the ignored result (the first P3).
- Unpair, at client.ts:402-406, uses the current setting with no URL. That matches the window's `paired` flag, `hasCurrentGatewayToken` (client.ts:338, apps/pairing/index.ts:139), and the Acceptance item "removes only the current (gateway, world, user) entry". Clean.
- The indicator and the submit path use `hasStoredToken`, which checks the current user's entry for any gateway, as settled in round 1. Clean.
- The code-reject fallback (client.ts:708) uses the current setting, which is correct: `start()` connects to the current gateway.
- Ignored `setToken` results:
  - client.ts:518: see the first P3.
  - client.ts:405 and :704: removes, where the runtime always returns true.
  - touch: the result is ignored, which is harmless.
- Callers that return void (the test deps) count as persisted (`!== false`), which is intended.

Checks at HEAD, run in a scratch copy: these 6 test files pass (68 tests):
- runtime-credentials
- credential-store
- user-switch
- pairing
- pairing-one-per-user
- status-indicator

eslint, prettier and `tsc -p module --noEmit` are clean on the round-3 files.

SCOPE: module/test/link/runtime-credentials.test.ts (new in ae5ccbe) is not in `Owns`, and Amendment 1 widened only client.ts. Route: orchestrator. Either amend `Owns` to include the file, or have the tests moved into pairing.test.ts, which is owned. Every other path in origin/main...HEAD is within `Owns` or is a scribe file under docs/plan.

## Review round 5 — findings (Andrew approved a fifth round, 2026-10-14)

Reviewed HEAD: c9ebf6a. Routed to the implementer: the P2 (the `start()` gate ignores `sessionToken`) and the three P3s (bind `sessionToken` to `helloOwner`; tests for the session-token invariants; the `notifyWarn` doc comment). The NOTE on clearing at `stop()` is not adopted, because Amendment 2 keeps the token for the session.

VERDICT: FIX

Both round-4 items are fixed, and the fix commit has no drift. The verdict is FIX because of one P2 that this round introduced: when the only token is the new in-memory `sessionToken`, `start()` cannot see it.

FINDINGS
- [P2] module/src/link/client.ts:360-363 (`start()`) — The first check in `start()` looks only at storage (`hasStoredToken()`) and the legacy setting. It ignores `sessionToken`. `pairingInvalid` (client.ts:744-747) and `resume()` both reach the session token through `start()`, so it bails out early. The rejected-code fallback in `pairingInvalid` leaves the link inactive and showing "connecting" for good. Before round 4, `tokenFor` returned null in this case and the state became PAIRING_INVALID.
  route: implementer — Amendment 2 says reconnects must still use the in-memory token. Let the gate in `start()` accept a token that `tokenFor(currentUrl)` finds, including the session token. No spec change is needed.
  input: localStorage throws on `setItem`. `pair('CODE-1')`, then `welcome` with `pairingToken:'newTok'` (connected). Then `pair('BAD')`, then `reject PAIRING_INVALID`, then wait 60 s.  →  state stays `{"kind":"connecting"}`, `isActive` is false, and no new socket is created.
  proof: I ran a scratch probe in runtime-credentials.test.ts against a copy of HEAD and got exactly that. A second probe, `stop()` then `resume()` (the pagehide/pageshow bfcache path in main.ts:55-65), ends in `{"kind":"disconnected"}` with no reason and no socket, while `hasCurrentGatewayToken()` is still true. The same gate fix covers both.

- [P3] module/src/link/client.ts:538-544 — The session token's identity is read from `getIdentity()` when `welcome` arrives. The `setToken` call just above it uses `this.helloOwner`. If the identity changed during the `await`, user A's token would be bound to B and sent in B's next hello. With the runtime as written this cannot happen: `setToken` is synchronous, and in Foundry a user switch reloads the page. The fix is cheap and matches the round-3 rule of using what was presented.
  route: implementer — build `sessionToken` from `this.helloOwner` (url, worldId, userId).
  input: a deps `setToken` that resolves `false` after `getIdentity` has switched to B  →  `sessionToken` has userId B and A's token, and B's next hello presents it.

- [P3] module/test/link/runtime-credentials.test.ts:159 — No test guards any of the session-token invariants you listed.
  route: implementer — add tests for:
  - a different URL (setting changed) sends nothing;
  - a different user or world in the same page sends nothing;
  - the token is cleared on unpair, on token rejection, and after a successful later store.
  input: each of these mutations to client.ts leaves all 165 tests passing:
  - drop the world/user check in `tokenForUrl`;
  - drop the URL check;
  - drop the clear in `pairingInvalid`;
  - drop the clear in `unpair`;
  - drop the clear on a successful store.
  proof: I ran 9 files (runtime-credentials, credential-store, user-switch, pairing, client, reconnect, pairing-one-per-user, pairing-onboarding, status-indicator). Each mutation passed 165/165. Today's behaviour is correct, but nothing guards it.

- [P3] module/src/link/client.ts:79 — The doc comment on `notifyWarn` says "already localized", but the client passes the i18n key `AGENT_GATEWAY.Link.storageFull`, and runtime.ts:122 localizes it. A future implementer who trusts the comment would show the raw key to the user.
  route: implementer — correct the comment so it says the argument is an i18n key.

- [NOTE] `sessionToken` is not cleared on `stop()`. Clearing it there would contradict Amendment 2 ("keeps the token in memory for this session"). In this module `stop()` runs only on pagehide, and a page restored from bfcache is the same session and user. The token is also never presented without matching URL, world and user at presentation time (client.ts:302-305). Clearing on stop would be a spec change, so it goes to the orchestrator if you want it. Once the P2 is fixed, resume after bfcache will reconnect with the token.

- [NOTE] Checked and sound at HEAD:
  - **Wrong gateway or user:** the token is never presented to another gateway, world or user. Both checks are in `tokenForUrl`. A stored credential for the current URL always takes precedence. After a gateway change, `connect` goes to PAIRING_REQUIRED.
  - **Clearing:** the token is cleared on unpair (client.ts:418), on token rejection (client.ts:738; the legacy branch never used it), and on a successful store (client.ts:550).
  - **Warning:** it passes only a constant key, so it cannot carry the token. The test asserts this.

FIXED
- [P3] code-pairing `setToken` result ignored when storage is full — FIXED — client.ts:532-551, runtime.ts:122, lang/en.json:117. Warns once, and the warning carries no token. Proof: changing `stored === false` to `false` fails the new test. The fix follows Amendment 2, but the P2 above leaves a gap in it.
- [P3] untested `if (saved) this.authSource = 'keyed'` guard — FIXED — runtime-credentials.test.ts:145. Proof: making the assignment unconditional fails that test.

DRIFT: none. f63cfac..HEAD changes only what the two round-4 items need: the optional `notifyWarn` dep, `sessionToken` and `storageWarned`, one lang key added, and two tests. No Acceptance item or decision is weakened. Prettier is clean on the changed files.

SCOPE: clean. client.ts (whole file, Amendment 1), runtime.ts, lang/en.json (one line added) and runtime-credentials.test.ts (Amendment 2) are all within Owns.

## Review round 6 — findings (second external review on PR #143; round approved by Andrew pasting the findings, 2026-10-14)

Reviewed HEAD: 077e8dc. Both findings are in-spec and routed to the implementer.

1. [P2] Prefer the newly issued session token over the stale stored token — client.ts:299
If a user pairs again while localStorage writes fail, the new credential stays in `sessionToken`, but the old persisted token takes precedence. Reconnecting sends the superseded credential; its rejection also clears the valid session fallback. Prefer the matching session token. This violates the reconnect guarantee (Amendment 2); the new quota tests only cover initially empty storage.
2. [P2] Refresh Unpair visibility when pairing succeeds — pairing/index.ts:139
Opening the window without a credential omits Unpair. Successful pairing leaves the window open, but state notifications update only status and address text, so Unpair remains unavailable until reopening. Update its visibility on state changes while preserving form inputs, and hide it when the credential is rejected.

## Review round 7 — findings (tests only; Andrew approved, 2026-10-14)

Reviewed HEAD: 2fec6b9. No behaviour defect. Routed to the implementer, as tests only with no change to src behaviour: the P2 test defect and the three P3 missing tests. The NOTEs are not adopted.

VERDICT: FIX

The code at HEAD behaves correctly in every combination I checked, and I found no behaviour bug. Both external round 6 P2s are fixed, and the fix commit has no drift. The verdict is FIX because of one P2 test defect: the test written for round 6 finding 1 claims to guard a property that it cannot detect. Three related precedence mutants also survive, and one of them is the mutant the implementer called equivalent. It is not equivalent.

FINDINGS
- [P2] /Users/Andrew/workspace/foundry-modules/agent-gateway/.claude/worktrees/task-89/module/test/link/runtime-credentials.test.ts:311-332 — The test 'rejecting the session token clears only it, leaving the persisted entry' does not guard what its name says. `failWrites` is still `true` when the `reject` arrives, so `credentials().remove()` would fail without error even if the client tried to remove the stale entry. The assertion at :320 passes either way. The tail is the same: the comment at :327 says "Its rejection clears the persisted entry", but nothing checks `stored()`, and `failWrites = false` at :330 comes after the reject.
  route: implementer — set `failWrites = false` before each `reject`. At :320, assert that the entry is still present. After the second reject, assert `stored()[key(X)]` is undefined.
  input: mutate client.ts:753 to `else if (this.authSource === 'session') { this.sessionToken = null; await this.deps.setToken(null, this.helloOwner ?? undefined); }`. A rejected session token then also deletes the persisted entry, which breaks "only the credential that was sent is stale".
  proof: with that mutant, all 9 link and app files pass (176/176). A scratch probe that is the same test with `failWrites = false` before the reject fails on the mutant and passes at HEAD.

- [P3] /Users/Andrew/workspace/foundry-modules/agent-gateway/.claude/worktrees/task-89/module/src/link/client.ts:752-754 — The implementer called "a rejected keyed token also clears the session token" equivalent. It is not. Precedence makes the session token and the keyed token mutually exclusive only for the same URL. After a gateway change, a keyed entry for Y is presented while a session token for X is still held. The same applies to the legacy branch: the mutant "a rejected legacy token also clears the session token" also survives 176/176.
  route: implementer — add a test for each rejection that asserts the session token for the other gateway survives.
  input: localStorage holds only Y's entry, and writes fail. On X, `pair('CODE-1')` then `welcome{pairingToken:'freshTok'}` creates a session token for X. Set the gateway to Y and call `start()`; the hello carries `tok-Y`; Y sends `reject PAIRING_INVALID`. Set the gateway back to X and call `start()`.  →  HEAD sends `freshTok` to X. The mutant has cleared the session token, so X needs a new pairing code and the window loses Unpair.
  proof: that sequence as a scratch probe passes at HEAD and fails on the mutant. With the mutant, the 9 files pass 176/176.

- [P3] /Users/Andrew/workspace/foundry-modules/agent-gateway/.claude/worktrees/task-89/module/src/link/client.ts:324-332 — No test checks that the user's own token (keyed or session) wins over the legacy credential. Swapping the order in `tokenFor` so legacy is checked first passes all 176 tests in the 9 files. That swap brings back the bug that started this task: user B is sent A's shared token while B holds its own entry, the gateway rejects it, the legacy setting is cleared, and A loses its pairing.
  route: implementer — add a test with B's keyed entry and A's legacy credential, both for the current gateway. Assert that the hello carries B's token and that `pairingCredential` is unchanged.
  input: `seedMap([X])` plus `pairingCredential = {url: X, token: 'legTok'}`, then `start()` and `onopen`.  →  The mutant sends `legTok`. HEAD sends `tok-X`.
  proof: legacy-first mutant, 176/176 pass.

- [NOTE] /Users/Andrew/workspace/foundry-modules/agent-gateway/.claude/worktrees/task-89/module/test/apps/pairing-one-per-user.test.ts:132,148 — `input` is not reachable from `app.element`, so `expect(input.value).toBe('typed')` can never fail. The real guard is `render` not being called, and that one works: a mutant that re-renders fails 4 tests.
- [NOTE] If the session token is rejected while an older persisted entry for the same key remains, the state is TOKEN_REJECTED but the window still shows Unpair, because `hasCurrentGatewayToken` finds the persisted entry. The next `start()` presents that entry. In practice it is dead: the gateway allows one pairing per (world, user), so re-pairing superseded it. Its rejection then removes it. This follows the spec ("only the credential that was sent is stale") and is pinned by the test at :311. It costs one extra rejected hello. Removing the superseded entry as soon as a new token fails to persist would be a design change, so it would go to the orchestrator if wanted.
- [NOTE] runtime.ts:76-77 — `setToken(null)` returns `true` even when `remove` hits a throwing `setItem`. If a browser blocks every write rather than only being over quota, a rejected keyed token is never removed and is presented again on every reload. This predates round 6.

FIXED (round 6, external)
- [P2] Prefer the newly issued session token over the stale stored token — FIXED — client.ts:305-318 (the session token is checked before the persisted entry) and :752-754 (a rejected session token clears only the session token, and a rejected keyed token no longer clears the session token). Test: runtime-credentials.test.ts:300. Proof: restoring keyed-before-session precedence fails :300 and :311.
- [P2] Refresh Unpair visibility when pairing succeeds — FIXED — apps/pairing/index.ts:167-169, templates/pairing/pairing.hbs:22, styles/agent-gateway.css:185-187. Every state change toggles `hidden` without re-rendering. Every path that changes the token updates storage before it calls `setState`: a successful pair, a rejection of each source, and a rejected code falling back to the token. A full render follows Unpair. Proof: removing the toggle fails the new test, and adding `this.render()` fails 4 tests.

DRIFT: none. 03770d2..HEAD changes only the two findings, their tests, one template line and one CSS insertion. The template assertion in pairing-one-per-user.test.ts:93 was rewritten to match the new markup. The "not paired: Unpair hidden" contract still holds, so it is not weakened. pairing.test.ts:108 is untouched.

STATE MACHINE AUDIT AT HEAD (no behaviour defect found)
- Order of presentation: a session token matching URL + world + user, then the persisted entry for the current URL, then a legacy credential for the same URL, then nothing.
- With nothing to present, `start()` either does nothing or sets PAIRING_REQUIRED (when another entry exists). `connect()` sets PAIRING_REQUIRED.
- Rejection clears only the credential that was presented:
  - legacy: the legacy setting;
  - session: the session token only;
  - keyed: the entry for `helloOwner`'s URL and identity.
- A rejected code falls back to `start()`, and the gate at :373 sees the session token.
- Writes:
  - A code-pair whose write fails sets a session token bound to `helloOwner`.
  - A successful store clears the session token.
  - A migration whose write fails keeps the legacy setting and `authSource` stays 'legacy'.
  - A successful migration switches `authSource` to 'keyed'.
- Unpair clears the session token and the current-URL entry, then re-renders.
- User switch: the session token is bound to its identity (tests guard this). The keyed lookup is per user.
- Gateway change: the session token and the entry are both URL-bound. A rejection clears by `helloOwner.url`. Unpair visibility follows `hasCurrentGatewayToken`, which counts the session token and the persisted entry but not the legacy credential.
- `eventResume` uses whichever token was presented.
- Window after each case:
  - keyed rejected: Unpair hidden;
  - legacy rejected: hidden;
  - session rejected with an older entry: shown (see the NOTE);
  - successful pair, whether persisted or session-only: shown.
- Mutation results across the 9 files (runtime-credentials, credential-store, user-switch, pairing, client, reconnect, pairing-one-per-user, pairing-onboarding, status-indicator), 176 tests at HEAD, all passing:
  - Killed:
    - keyed-before-session;
    - no session clear on reject;
    - session reported as keyed;
    - start gate ignores the session token;
    - no clear on a successful store;
    - no identity check;
    - no URL check;
    - window ignores the session token;
    - unpair keeps the session token;
    - no Unpair toggle;
    - re-render on state change.
  - Survived:
    - session rejection also clears keyed (P2 above);
    - keyed rejection also clears the session token (P3);
    - legacy rejection also clears the session token (P3);
    - legacy before own (P3).
- eslint, prettier and `tsc -p module --noEmit` are clean on the changed files.

SCOPE: clean. client.ts (Amendment 1), apps/pairing/index.ts, templates/pairing/pairing.hbs, styles/agent-gateway.css (insertion only), runtime-credentials.test.ts (Amendment 2) and pairing-one-per-user.test.ts are all within Owns.
