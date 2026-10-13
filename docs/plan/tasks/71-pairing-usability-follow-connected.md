# 71 — Follow the connected pairing, retire legacy pairings, keep a live pairing code in reach

**Repo:** .
**Depends on:** 70
**Status:** MVP A (Andrew approved 2026-10-13); before 34
**Decisions (Andrew, 2026-10-13):** defaults approved as written.
**Owns:**
- gateway/src/routing/binding.ts
- gateway/src/mcp/session.ts
- gateway/src/mcp/status-tool.ts (new: the full-session `gateway_status` tool)
- gateway/src/mcp/degraded.ts (import `STATUS_TOOL` from `status-tool.ts` only; no behaviour change)
- gateway/src/link/pairing-codes.ts
- gateway/src/app.ts
- gateway/src/store/migrations/008-retire-legacy-pairings.ts (new; next free number at merge if 35b lands first)
- gateway/src/store/migrations/index.ts (insertions only: one import, one array entry)
- gateway/test/routing/**
- gateway/test/mcp/**
- gateway/test/app/** (new)
- gateway/test/store/store.test.ts (latest-`user_version` assertions only)
- gateway/test/store/retire-legacy-pairings.test.ts (new)
- gateway/test/link/pairing-codes.test.ts (new)
- gateway/test/link/** and gateway/test/relay/** (only where an existing assertion breaks because of the single-live-code rule, the new `gateway_status` entry in `tools/list`, or a changed binding message; change those assertions, nothing else)

## Goal
Three pairing bugs turned up on Andrew's Mac after task 70, using the Claude Desktop `.mcpb`, and Andrew added a fourth.

1. A session stays bound to a dead pairing.
2. Legacy pairings with a NULL origin stay around and get in the way of binding.
3. The pairing code is issued once and expires after 10 min. After that, the only way to get a new one is to restart.
4. The user has to read a log file to find the code.

After this task:
- A session started without `--user` follows the one pairing that is connected.
- Legacy pairings are revoked.
- One code is always available when needed.
- Any call that is not connected to Foundry tells the user, in the chat, how to pair and which code to enter.

## Context
- gateway/src/routing/binding.ts:37-115: `SessionBinding`. The binding is set once and never changes (`bound`, `sawAmbiguity`). The candidate pool is `knownIdentities` (active pairings, whether connected or not).
- gateway/src/mcp/session.ts:59-63: the "Bound MCP session to … start with --user to choose" line.
- gateway/src/mcp/session.ts:121-138: `pinnedEventOwner`, which throws "Event pairing changed; start a new session".
- gateway/src/mcp/session.ts:234: `queueOwner` pinning.
- gateway/src/mcp/session.ts:189-202: the ambiguity (`INVALID_ARGS`) and `offline()` error paths.
- gateway/src/mcp/session.ts:324-331: the call takes `conn` and `sessionId` from the snapshot.
- gateway/src/mcp/session.ts:346-393: the `connected`/`disconnected` listeners and the coalesced `tools/list_changed`.
- gateway/src/link/pairing-codes.ts: `generate()` can hold several live codes. `consume()` is single use.
- gateway/src/link/code-attempts.ts and gateway/src/link/server.ts:374-380: task 70's code-guess limit. Neither file changes here.
- gateway/src/link/server.ts:31-40: the `OriginRejection` reasons. The token refusals are "pairing token is unknown, revoked, …", "pairing predates origin binding; pair again with a code" and "pairing was made from a different origin".
- gateway/src/app.ts:264-333: `startPrimary` does three things that matter here:
  - generates one code at line 302;
  - prints the `Pairing code:` / `Link URL: … (pid N holds link port P)` lines;
  - sends the startup notice only to the primary's stdio session, through `oninitialized`.
- gateway/src/app.ts:269-281: `onOriginRejected` and its `warned` dedupe, capped at `MAX_WARNED_ORIGINS`.
- gateway/src/app.ts:333: relayed sessions come from the same `createSessionServer(sessionOptions(…))`.
- gateway/src/store/store.ts:84: `listActivePairings` is `revoked_at IS NULL`.
- gateway/src/store/migrations/007-pairing-origin.ts: `origin` is NULL for rows made before 007.
- gateway/src/store/migrate.ts: each migration runs once, in its own transaction.
- gateway/src/mcp/degraded.ts:4: `STATUS_TOOL = 'gateway_status'`, the name a degraded instance already uses.
- e2e/lib/gateway.ts:33: `CODE_RE = /Pairing code:\s*(\S+)/`. The format of the code line must not change.
- docs/conventions.md, "Several tasks edit these in parallel": the migration directory is insertion only.

## Design (normative)

### 1. Follow the connected pairing (`binding.ts`, `session.ts`)
**Follow mode** applies when no `--user` selector is given. If `--world` is given, it limits the pool to that world. With `--user`, behaviour is exactly as today: the session binds once and never re-binds. The terms below are used throughout:
- **K**: the active pairings in the pool.
- **C**: the members of K that have an open connection (`registry.get(...)` is set and not `closed`).
- **P**: the bound pair.

**Unbound session**, checked at every `resolve`:
- If |C| = 1, bind to it.
- If |C| > 1, answer `ambiguous` and name C. The answer is not permanent: there is no `sawAmbiguity` latch in follow mode.
- If |C| = 0 and |K| = 1, bind to that pairing while it is offline. This is today's behaviour, and it keeps offline queueing working.
- If |C| = 0 and |K| ≠ 1, the session stays `unbound` (see section 4). This replaces today's ambiguity error for "several pairings, none connected".

**Bound session (P)**:
- If P ∈ C, stay bound to P, even if other pairings are also connected.
- If P is not active any more (revoked), treat the session as unbound and apply the rules above.
- **Immediate re-bind.** On a registry `connected` event for a pair Q ≠ P, when P is not connected and C = {Q}, re-bind to Q. This covers a user switching worlds.
- **Grace re-bind.** At `resolve` time, when P has been disconnected for at least `REBIND_GRACE_MS` (exported from `binding.ts`, 30 000) and C = {Q}, re-bind to Q.
- A `disconnected` event alone never re-binds. A GM page reload must not hand the session to another connected user.
- If P ∉ C and |C| > 1, the call gets the ambiguity error, and P stays bound.
- If C is empty, P stays bound, with today's offline semantics: `WORLD_OFFLINE` or a queued intent.

**On re-bind (P → Q)**, in this order, synchronously:
1. Set `bound = Q`, and reset `wasOnline`.
2. Clear the session's pinned `eventOwner` and `queueOwner`, so the "Event pairing changed; start a new session" check applies only within one binding.
3. Call `events.cancelSession(sessionId)`, so a long-poll waiting for P returns.
4. Schedule the coalesced `tools/list_changed`.
5. Write one stderr line: `MCP session <first 8 chars of sessionId> re-bound from <user> in <world> to <user> in <world> (the only connected pairing).` Pass the names through `safeText`.
6. Send the same text to that session as an MCP `notifications/message` (level `notice`, logger `binding`).

The first implicit bind keeps today's "Bound MCP session to …" line.

**In-flight calls.** A tool call resolves the binding once, on entry. That snapshot (pair, owner, `conn`) is used for the whole call.
- A call already sent over the link stays on P's connection. If P's connection closed, it fails as it does today (`WORLD_OFFLINE` or a link error). It is never resent to Q.
- A pre-rebind result is returned unchanged.
- A module-side approval pending for that call stays with P's world. It resolves, is denied or times out there.

**Queued intents and approvals.** Offline-queued intents keep the owner (world, user, agentId) they were created under. They are delivered to and reviewed in P's world when it reconnects.
- After a re-bind, `approval_status` looks up only Q's owner, so an id from P is not visible under Q.
- If the session later re-binds to P, the same id is visible again, because the owner key is derived from the pairing.

**Audit attribution.**
- Every link call carries the snapshot's `conn` and the session's unchanged `sessionId`. The module therefore records the Foundry user that its own server set for the connection that ran the call. Nothing in the gateway rewrites the user.
- The re-bind stderr line ties a `sessionId` prefix to the pairing change, which is enough to read audits across the switch.

### 2. Retire legacy pairings (migration 008)
Add one migration:

```sql
UPDATE pairings
SET revoked_at = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE origin IS NULL AND revoked_at IS NULL
```

- `revoked_at` is in milliseconds, like `Date.now()`.
- The rows are kept, for audit history.
- No startup sweep is needed, because since 007 `createPairing` always writes an origin.
- Revoked rows are already absent from `listActivePairings`, so they leave binding and listings with no other change.

### 3. Single live code with bounded refresh (`pairing-codes.ts`, `app.ts`)
`PairingCodes` holds **at most one live code**. It takes injectable `now`, `setTimer` and `clearTimer` functions.

**Methods:**
- `current(): { code, expiresAt } | undefined` returns the code only while it is live and not consumed.
- `issue(reason)` returns `current()` if a code is live. Otherwise it creates a code with `PAIRING_CODE_TTL_MS` and calls `onIssued({ code, expiresAt, reason })`. The reason is `'startup' | 'expired' | 'refused-token' | 'mcp'`.
- `generate()` stays as an alias of `issue('startup')` that returns the code string, for existing callers.
- `consume()` keeps its single-use semantics. On a successful consume, the live code is cleared and its timer is cancelled.
- `stop()` clears the timer.

**Timer:**
- There is exactly one `unref`'d timer, armed for the live code's `expiresAt`.
- When it fires and the code was not consumed, `issue('expired')` runs.
- If the code was consumed, no timer remains. Further codes are issued only on demand: a refused token, or an MCP call (section 4).
- There is never more than one timer and never more than one live code.

**In `app.ts`:**
- `onIssued` prints the same two lines as at startup: `Pairing code: XXXX-XXXX (expires in 10 min)` and `Link URL: ws://localhost:P (pid N holds link port P)`.
- It sends the joined notice as an MCP logging message (level `notice`, logger `pairing`) to every **initialized** session the primary serves: stdio and relayed. Sessions not yet initialized get the current code when they initialize, not the startup one.
- `app.stop()` and `teardown()` call `codes.stop()`.

**Refused token.**
- In `onOriginRejected`, before the `warned` dedupe, the three token-refusal reasons call `codes.issue('refused-token')`. That call does nothing if a code is live.
- The refusal log line ends with ` Enter pairing code XXXX-XXXX (expires in N min) in the Agent Gateway pairing prompt; it is also in the client's MCP log.`
- Code-hello refusals do not issue codes: a wrong code (`no valid pairing code`) or `too many failed pairing codes`.
- `CodeAttempts` and its check order in `server.ts` are untouched.

### 4. The code in the chat (`session.ts`, `status-tool.ts`)
`SessionServerOptions` gains `pairingHint?: () => { code: string; expiresInMin: number } | undefined`. `app.ts` supplies it as `codes.issue('mcp')`, mapped to minutes rounded up.

**Not-connected errors.** These replace the gateway-originated `WORLD_OFFLINE` text in two cases: `unbound`, and bound with no connection when the call is not queued.
- Unbound: `WORLD_OFFLINE: Not connected to Foundry yet. Open your world in a browser and enter code XXXX-XXXX in the Agent Gateway pairing prompt (expires in N min).`
- Bound to an offline P: `WORLD_OFFLINE: world <W> / user <U> is not connected. Open that world in a browser as <U>; to pair a different browser, enter code XXXX-XXXX in the Agent Gateway pairing prompt (expires in N min).`
- `LinkCallError`s raised by the link during an in-flight call do not get a code. Ambiguity errors do not get a code.
- A queued-intent result (`pending_approval`) does not get a code.

**`gateway_status`.** It is defined in the new `status-tool.ts`, and `degraded.ts` imports `STATUS_TOOL` from there. Every full session lists it, bound or not, and it never goes over the link.
- Its input schema is `{}` with `additionalProperties: false`.
- It returns `structuredContent` `{ state: 'connected' | 'not_connected' | 'ambiguous', world?, user?, pairingCode?, codeExpiresInMin?, candidates? }`, with matching text.
- `pairingCode` and `codeExpiresInMin` appear only when `state === 'not_connected'`.

**Security** (the PR description must restate this):
- MCP clients of this gateway are the local stdio client and relay clients authenticated by 69's relay secret. They have the same trust as whoever reads the local stderr log.
- The code is single use, has a 10 min TTL, and is returned only to this gateway's MCP sessions.
- The code is never sent over the link, and never written into Foundry chat or any document.
- Residual risk: an agent with web tools could be prompt-injected into posting the code to a web page. Three things bound this: the TTL, single use, and the unchanged guess limit. Pairing also still needs a browser tab, on an allowed origin, to submit the code.
- When the session's pair is connected, no result contains a code.

## Acceptance
- [ ] **Follow, one connected (binding unit test and integration).**
  - Setup: two active pairings, A (not connected) and B (connected).
  - A session with no selector routes `fixture_tool` to B's fake module.
  - A receives no `call` frame.
- [ ] **Re-bind on switch.**
  - Setup: a session bound to connected A.
  - When A disconnects and B connects, the next call reaches B, with the same `sessionId` it had on A.
  - The client receives `tools/list_changed` and a `notifications/message` from logger `binding`.
  - stderr holds one `re-bound from … to …` line.
- [ ] **No re-bind on blip.** Setup: bound to A, with B also connected.
  - A disconnects and reconnects within `REBIND_GRACE_MS` (fake clock). Calls still reach A.
  - A disconnects and stays away for at least `REBIND_GRACE_MS`. The next call reaches B.
- [ ] **Ambiguity.** With two pairings connected and none bound, a call returns `INVALID_ARGS` naming both. When one disconnects, the next call binds to the survivor.
- [ ] **Explicit selector unchanged.** With `--user`, existing binding tests pass, and the session never re-binds.
- [ ] **In-flight.**
  - A call pending on A when the session re-binds to B either completes on A or fails with A's link error.
  - B never receives that call.
  - A pending `events_poll` on A returns once the re-bind happens.
- [ ] **Queued intents.** An id queued while bound to offline A:
  - is not reported by `approval_status` after the re-bind to B;
  - is reported again after the session re-binds to A.
- [ ] **Migration.** On a db at `user_version` 7 holding one NULL-origin active row and one row with an origin, opening the store:
  - sets `revoked_at` on the NULL-origin row only, and keeps the row;
  - leaves `listActivePairings` returning only the row with an origin;
  - leaves a no-selector session bound to the row with an origin.

  `store.test.ts` asserts the new latest `user_version`.
- [ ] **Code refresh (fake timers; injectable clock and timers).**
  - After `PAIRING_CODE_TTL_MS` with no pairing, `onIssued` fires with `reason: 'expired'`.
  - The app prints a new `Pairing code:` line, followed by a `(pid N holds link port P)` line.
  - An initialized stdio session and an initialized relayed session each receive a `pairing` notice with the new code.
  - The old code then fails `consume`.
  - At no point are two codes live, or two timers armed.
- [ ] **No refresh after pairing.** After a successful consume, advancing the clock by three TTLs issues no code and arms no timer.
- [ ] **Refused token.**
  - Setup: no code is live.
  - A hello with a revoked token issues exactly one code, and the refusal line contains `Enter pairing code`.
  - A second refused token while that code is live issues none.
  - A wrong-code hello issues none.
  - The `code-attempts` tests pass unchanged.
- [ ] **Code in chat.**
  - Unbound, a call returns the "Not connected to Foundry yet … enter code XXXX-XXXX …" text with the live code.
  - After the code expires, the next unbound call returns a different, fresh code, and the old one fails `consume`.
  - Once the session's pair is connected, neither `gateway_status` nor any other result contains text matching `PAIRING_CODE_PATTERN`.
- [ ] **`gateway_status`.**
  - It is listed in a session that is unbound and in one that is bound.
  - It returns `state: 'not_connected'` with `pairingCode` while unbound, and `state: 'connected'` with no `pairingCode` while connected.
  - `gateway/test/conformance/schemas.test.ts` passes.
- [ ] The `Pairing code:` line format is unchanged. `e2e/lib/gateway.test.ts` passes.
- [ ] `npm run verify` passes.
- [ ] **Manual check (Andrew, Claude Desktop `.mcpb`, macOS).** Start with stale pairings present, including a pre-007 one.
  - A new chat attaches to the connected world with no restart.
  - Switching Foundry worlds re-binds the same chat.
  - With no browser connected, a tool call shows the code in the chat.
  - After 10+ min unpaired, a new `Pairing code:` line appears in `~/Library/Logs/Claude/main.log`.
  - Entering the code from the chat pairs the browser.

## Out of scope
- Local HTTP sessions and their notices (34). 34 depends on this task and must pass `pairingHint` and its own notice target when it adds HTTP sessions.
- Any change to `gateway/src/link/server.ts`, `code-attempts.ts`, the relay protocol under `gateway/src/relay/**`, or `bin/cli.ts` and `config/**`.
- Module-side UI. That includes changing how the pairing prompt reacts to a revoked token.
- A CLI or tool for listing or revoking pairings by hand.
- Showing the code anywhere in Foundry: chat, notifications or documents.
- Audit-trail persistence (35b). 35b's insertion-only edits to `session.ts` and `app.ts` come after this task.
- Docs (`docs/architecture.md` binding section, quick start). The scribe records the new binding rules after merge.
