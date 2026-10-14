# 87 — Make link drops visible and recoverable without re-pairing

**Repo:** .
**Depends on:** 86 (it edits module/src/apps/pairing/index.ts, templates/pairing/pairing.hbs, lang/en.json, gateway/src/mcp/session.ts and gateway/src/mcp/status-tool.ts, which 86 also edits)
**Status:** From the live VPS, Andrew 2026-10-14. The gateway had not restarted, and the GM's pairing was valid and not revoked. Even so, `gateway_status` said the world was offline and waiting for a pairing, and Claude told the user to get a new pairing code. The gateway log showed nothing about connects or disconnects, only rejections. One browser once presented an unknown token, probably a stale one from a local gateway. Following Claude's advice would have made things worse, because redeeming an invite revokes the existing pairing and its OAuth grants (gateway/src/link/invites.ts:83, gateway/src/store/store.ts:97-100).
**Owns:**
- gateway/src/link/server.ts. Add an optional `onLinkEvent` callback to `LinkServerOptions`. Call it from `handshake` once `welcome` is sent (connected), and from the `ws.on('close', …)` handler (:310) when `conn` is set (disconnected). Nothing else in this file changes.
- gateway/src/app.ts. Only the `new LinkServer({...})` options (:484-510), to wire `onLinkEvent` to `writeStatus`, and the session options, to pass `pairingState` (below).
- gateway/src/store/store.ts. Insertions only: one method `pairingStateFor(worldId, userId): 'active' | 'revoked' | 'none'` on the `Store` interface and its implementation. It is one indexed query, not a scan of `listPairings()`.
- gateway/src/mcp/session.ts. `notConnected` (:268-285), `statusResult` (:287-317) and one new optional `SessionServerOptions` field, `pairingState`.
- gateway/src/mcp/status-tool.ts. `GatewayStatus` (one new optional field `pairing`), `statusToolListing.outputSchema` (the same field) and `statusText`.
- gateway/test/link/connection-log.test.ts (new).
- gateway/test/store/pairing-state.test.ts (new).
- gateway/test/mcp/status-pairing-state.test.ts (new).
- gateway/test/mcp/status.test.ts. Edit an existing assertion only where this task changes the wording it pins. Add no new cases here.
- module/src/link/client.ts. `LinkState`'s `disconnected` reasons (a new module-local reason `TOKEN_REJECTED`), the `onclose` handler (:429-445), the `reject` case (:514-535), and one new public method `retryNow()`. The protocol is not touched.
- module/src/link/status-indicator.ts (new). A small view of `LinkState` for the current user. It has no Foundry globals, apart from what is injected, so it can be tested on its own.
- module/src/main.ts. Insertions only, next to the existing `pagehide`/`pageshow` listeners (:41-60): install the indicator, and add `online` and `visibilitychange` listeners that call `retryNow()`.
- module/src/apps/pairing/index.ts. `describeState`, for the `TOKEN_REJECTED` reason, and `_prepareContext`, for the one-pairing notice.
- templates/pairing/pairing.hbs. One line for the one-pairing notice.
- lang/en.json. Insertions only, under `AGENT_GATEWAY.Link.tokenRejected`, `AGENT_GATEWAY.Link.Indicator.*` and `AGENT_GATEWAY.Pairing.OnePerUser.*`. Existing values are not edited.
- styles/agent-gateway.css. Insertions only: one rule block for the indicator.
- module/test/link/reconnect.test.ts (new).
- module/test/link/status-indicator.test.ts (new).
- module/test/apps/pairing-one-per-user.test.ts (new).
- module/test/link/client.test.ts. Edit an existing assertion only where this task changes the behaviour it pins (a 1008 `PAIRING_INVALID` close now stops retrying). Add no new cases here.

## Goal
When an established link drops, the browser should get back on its own with the token it already holds, and the GM should be able to see whether it is connected, reconnecting or needs pairing. The gateway should log each authenticated connect and disconnect, so an operator can tell "the browser left" from "the gateway refused it". The AI's status tool should stop telling a user with a valid pairing to fetch a new code, because doing so revokes the very pairing and grant it depends on.

## Decisions (made here; Andrew may override)
- **(a) One pairing per (world, user) stays.** Redeeming an invite revokes every active pairing for that (world, user) and its OAuth grants, in one transaction (gateway/src/link/invites.ts:79-95, gateway/src/store/store.ts:97-100). This task keeps that behaviour. **Recommendation: keep it for now.**
  - It makes "who is this AI acting as" a single answer. A revoked or lost browser cannot keep acting.
  - The operator's revoke and re-invite flow (task 68) relies on it.
  - Allowing several pairings per user would need a decision on which browser receives calls (the registry already keys connections by (world, user), gateway/src/link/registry.ts:117-137) and a revoke-one UI. That is a separate task, if friends ever need two browsers.

  The cost is that pairing a second browser silently disconnects the first and ends the AI's grant. This task makes that visible instead of changing it: the pairing window says so before the player submits (Acceptance, "One-pairing notice"), and the status tool stops recommending a new code when a pairing exists. **Decision for Andrew.**
- **(b) Extend the existing reconnect; do not add a second one.** module/src/link/client.ts already reconnects with capped exponential backoff and jitter (`backoffDelay`, :100-107; `scheduleRetry`, :617-631). It retries only with the stored token bound to its URL, stops on a `reject` message (:514-535), and stops on a `replaced` close (:429-440). The gaps this task closes:
  - A 1008 close whose reason is `PAIRING_INVALID`, arriving without the `reject` message (a race at revocation, gateway/src/link/server.ts:183-197), is treated as a network error and retried forever.
  - After a rejected token, the window says "The pairing code was not accepted" (`Link.pairingInvalid`), which is wrong when no code was entered.
  - Nothing outside the pairing window shows the state.
  - A backgrounded tab's backoff timer can be throttled for minutes after the network is back.
- **(c) Where the state is shown.** A small text element in Foundry's Players list (the `renderPlayers` hook), on the current user's own row, set with `textContent`. It is shown to a GM always and to a player only when that player's link is in use (a stored credential or an active link), so local-only players see nothing new. One `ui.notifications.warn` is shown when the state enters "needs pairing", once per entry. Reasons: the Players list is visible on every scene and needs no new application window, and a toast alone is missed.
- **(d) What the status tool can know.** The gateway cannot see a browser, only whether a pairing row exists for (world, user) and whether it is revoked. Three states come from `pairingStateFor`: `active` (a pairing exists but no browser is connected), `none` (never paired) and `revoked` (the most recent pairing was revoked and none is active). The text never contains an invite or pairing code that this task adds. Local mode's existing `pairingHint` clause is unchanged.

## Context
- module/src/link/client.ts:16-19 (`LinkState`), :100-107 (`backoffDelay`), :301-323 (`start`, `requirePairing`), :429-445 (`onclose`), :514-535 (`reject`), :617-631 (`scheduleRetry`). Line numbers are origin/main; 86 does not touch this file.
- module/src/main.ts:41-60. The `pagehide`/`pageshow` handling to sit next to.
- module/src/apps/pairing/index.ts:22-38 (`describeState`) on origin/main. 86 moves these lines; follow 86's version.
- gateway/src/link/server.ts:183-197 (`dropConnection`), :296-319 (the close handler), :555-600 (handshake success and `welcome`).
- gateway/src/link/registry.ts:117-137. A replaced connection is closed with 1000 `replaced`.
- gateway/src/app.ts:484-510 (`onOriginRejected` → `writeStatus`, the existing log style and its dedupe).
- gateway/src/mcp/session.ts:268-317 and gateway/src/mcp/status-tool.ts:35-56. These are the current wording, as amended by 86.
- gateway/test/mcp/status.test.ts:1-30 and gateway/test/link/helpers.ts. The harness to reuse.
- module/test/link/client.test.ts. Its fake socket and timer injection (`setTimer`, `clearTimer`, `random`).

## Acceptance

**Gateway: connect and disconnect log (gateway/src/link/server.ts, gateway/src/app.ts)**
- [ ] After a successful handshake, `onLinkEvent` receives `{kind:'connected', worldId, userName, connectionId}`. When that socket closes, it receives `{kind:'disconnected', worldId, userName, connectionId, code, reason, durationMs}`, where `durationMs` is measured with the server's injected `now`. Tested in gateway/test/link/connection-log.test.ts with a fake clock.
- [ ] Rejected handshakes produce no `onLinkEvent` call. They keep the existing `onOriginRejected` path.
- [ ] A connection replaced by the same (world, user) logs a `disconnected` event with code 1000 and reason `replaced`. A revoked one logs code 1008 and reason `PAIRING_INVALID`. A heartbeat termination logs its close code (1006). Each is a test.
- [ ] app.ts writes one line per event through `writeStatus`, in this shape: `link connected: world <id> / user <name>` and `link disconnected: world <id> / user <name> after <n>s (code <c>[, <reason>])`.
- [ ] The user name and the close reason go through the same control-character sanitising that `notConnected` uses (`safeText`, or an equivalent), and the reason is truncated to 64 characters. A test closes from the client with a reason containing `\n` and ANSI escapes, and asserts the logged line contains neither.
- [ ] No logged line contains the pairing token, an invite or pairing code, or the token hash. The test pairs with a known code and token, then asserts that neither string, nor `hashToken(token)`, appears in any captured line.

**Gateway: status wording (gateway/src/store/store.ts, session.ts, status-tool.ts)**
- [ ] `pairingStateFor(w, u)` returns `'none'` with no rows, `'active'` with an unrevoked row, and `'revoked'` when every row is revoked. After revoke-then-redeem it returns `'active'`. Rows for another world or user do not count. Tested in gateway/test/store/pairing-state.test.ts.
- [ ] For a session bound to (w, u) with no live connection, gateway/test/mcp/status-pairing-state.test.ts asserts all of the following, through both `gateway_status` and a tool call that fails with `WORLD_OFFLINE`:
  - `active`: the text says to open or reload the Foundry tab as <user>, and that no new invite or code is needed. It contains neither "ask the gateway operator" nor "invite from". The structured status has `pairing: 'active'`.
  - `none`: the text says an invite is needed (server mode) or keeps today's local-mode pairing-code clause. `pairing: 'none'`.
  - `revoked`: the text says the pairing was revoked and a new invite is needed. `pairing: 'revoked'`.
- [ ] With `pairingState` not supplied (older callers and the relay), every text is byte-identical to 86's. Existing tests pass unchanged, apart from edits allowed in Owns.
- [ ] No status text or structured field contains an invite code. A test seeds an unredeemed invite and asserts that its code is absent from every output.

**Module: reconnect and rejection (module/src/link/client.ts)**
- [ ] Existing behaviour is pinned in module/test/link/reconnect.test.ts, using injected timers and `random`. After `connected`, a close with code 1006 schedules retries whose delays are `backoffDelay(0..n)`. Each retry sends `hello` with `auth.kind === 'pairingToken'` and the stored token. No retry sends a `pairingCode`.
- [ ] A close with code 1008 and reason `PAIRING_INVALID`, with no `reject` message first, stops retrying: no timer is pending afterwards. It clears the stored credential only if the attempt used a token, and the state becomes `{kind:'disconnected', reason:'TOKEN_REJECTED'}`.
- [ ] A `reject` with `PAIRING_INVALID` after a token-auth `hello` clears the stored credential, sets the reason to `TOKEN_REJECTED` and schedules nothing. After a code-auth `hello`, today's behaviour is unchanged, including the fallback to the token at :523-530.
- [ ] `start()` with a credential bound to a different URL still goes to `PAIRING_REQUIRED` and sends nothing. This pins the stale-local-token case.
- [ ] `retryNow()` connects immediately only when a retry timer is pending. It cancels that timer, keeps `attempt` unchanged, and in every other state (connected, connecting, stopped, replaced, rejected) does nothing. Each is a test.
- [ ] module/src/main.ts calls `retryNow()` on the window `online` event and on `visibilitychange` when `document.visibilityState === 'visible'`. Checked by `rg -n "retryNow" module/src/main.ts`, which shows both listeners.

**Module: visible state (module/src/link/status-indicator.ts)**
- [ ] A pure `indicatorState(state, inUse)` maps `connected` → `connected`, `connecting` and `disconnected`/`ERROR` → `reconnecting`, `disconnected` with `PAIRING_REQUIRED`, `PAIRING_INVALID` or `TOKEN_REJECTED` → `needsPairing`, `REPLACED` → `elsewhere`, and anything else, or `inUse === false` for a non-GM, → `hidden`. A table test covers every `LinkState` reason.
- [ ] The rendered element's text comes from `AGENT_GATEWAY.Link.Indicator.<state>` and is set with `textContent`. `rg -n "innerHTML|\{\{\{" module/src/link/status-indicator.ts` is empty.
- [ ] The element updates on `onState` without re-rendering the Players list. A test drives three state changes and asserts the text after each.
- [ ] Entering `needsPairing` shows exactly one `ui.notifications.warn` (`AGENT_GATEWAY.Link.Indicator.needsPairingToast`). Staying in it, or a second state change within it, shows none. Leaving and re-entering shows one more.
- [ ] The indicator never renders the token, the code or the gateway URL. A test with a stored credential asserts that none of them appears in the element's text or attributes.

**Module: wording (module/src/apps/pairing/index.ts, templates/pairing/pairing.hbs)**
- [ ] `describeState({kind:'disconnected', reason:'TOKEN_REJECTED'})` returns `AGENT_GATEWAY.Link.tokenRejected` ("This browser needs pairing: its saved pairing was not accepted. …"). The other reasons return the same keys as before.
- [ ] One-pairing notice: the pairing window shows `AGENT_GATEWAY.Pairing.OnePerUser.notice` ("Pairing here disconnects any other browser paired as you, and ends AI access granted to that pairing.") near the submit button, in both local and server mode. Tested in module/test/apps/pairing-one-per-user.test.ts by rendering the context.

**Gate**
- [ ] `git diff origin/main -- protocol` is empty.
- [ ] `npm run verify` passes.

## Out of scope
- Changing one-pairing-per-(world, user), or adding several pairings per user (decision (a)).
- Any automatic re-pairing or code reuse. The module never sends a `pairingCode` it did not just receive from the user.
- The link protocol, `reject` codes and close codes. A distinct "revoked" reject code would be a protocol change.
- Changing `backoffDelay`'s constants or formula.
- Logging pre-handshake rejections differently (the existing `onOriginRejected` path and its dedupe), and the local-mode code shown in rejection lines (gateway/src/app.ts:500-506).
- gateway/src/relay/** and the secondary's status wording.
- A gateway-side "last seen" for browsers, or a metrics endpoint.
- Docs (docs/server-mode.md, docs/architecture.md, recording decision (a)). These are for the scribe.
- gateway/test/bin/invite-cli.test.ts's environment leak (86's residual).
