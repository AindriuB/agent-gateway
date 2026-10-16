# 107 — Tell the admin GM that a player invite needs them online, and when a vouch happens

**Repo:** .
**Depends on:** none
**Status:** Ready.
**Owns:**
- module/src/apps/manage/**
- templates/manage/manage.hbs
- module/src/link/vouch.ts
- module/test/apps/manage/manage.test.ts
- module/test/link/vouch.test.ts
- lang/en.json — insertions and edits under `AGENT_GATEWAY.Manage.*` and `AGENT_GATEWAY.Pairing.Vouch.*` only (a shared insertion-only file).

## Goal
A player invite created from Manage access only pairs when an admin GM's browser is in the world
with its Agent Gateway link connected, because that browser vouches for the player automatically
(task 90). Nothing tells the GM this. If the GM closes Foundry after sending the invite, the player
gets "No GM is online" and the GM never learns why. Tell the admin GM at invite time, on each open
invite, and when their browser confirms or cannot confirm a player's pairing.

## Context
- module/src/apps/manage/index.ts:291-307 — `onCreateInvite`; `showInviteCode` is at `:193`.
- module/src/apps/manage/model.ts:72-80 — invite rows (`statusKey`, `canCancel` when `unused`).
- templates/manage/manage.hbs:17-45 — the Invites tab.
- module/src/link/vouch.ts:48-70 — the admin-side vouch: returns early when `!client.isAdmin` (`:56`)
  and when `client.attest(...)` fails (`:63`), silently in both cases.
- lang/en.json:160-166 (`Pairing.Vouch.*`) and :273-279 onward (flat `AGENT_GATEWAY.Manage.*` keys).

## Acceptance
- [ ] After an invite is created, the code dialog also shows a new `AGENT_GATEWAY.Manage.*` line. It
      says the player can only finish pairing while this GM is in this world with Agent Gateway
      connected, and names the player (test asserts the localize/format call and the player name).
- [ ] Each `unused` invite row in the Invites tab shows a short "needs you online to confirm" note.
      Used, expired and cancelled rows do not (model test).
- [ ] `Manage.invitesIntro` mentions that this GM must be online when the player pairs.
- [ ] When the admin GM's browser vouches successfully (`attest` returns true), that GM gets one
      `ui.notifications.info` reading "confirmation sent for {player}", not "pairing confirmed for
      {player}" (Amendment 1). The name comes from the Foundry user Foundry set as the message
      author, never from message content (test).
- [ ] When an admin GM's browser receives a vouch request but `attest` returns false (link not
      connected), that GM gets one `ui.notifications.warn` saying the pairing could not be confirmed
      because their Agent Gateway link is not connected (test). A non-admin client still does
      nothing and shows nothing (test).
- [ ] No more than one notification per vouch message, whatever the hook re-entry (test).
- [ ] Every new string is under `AGENT_GATEWAY.Manage.*` or `AGENT_GATEWAY.Pairing.Vouch.*`, and no
      other key in lang/en.json changes.
- [ ] `npm run verify` passes.

## Out of scope
- Holding a player's vouch request on the gateway until an admin GM connects (a protocol and
  gateway change; raise it as a follow-up if Andrew wants it).
- Changing who may vouch, and the gateway's vouch logic (gateway/src/link/attestation.ts).
- The pairing window (task 105) and the Players-list indicator (task 106).
- Docs (task 114 covers the vouch flow in server-mode.md).
- A gateway acknowledgement of `attest`, so that the notice could say the pairing was actually
  confirmed. Possible follow-up; it needs a protocol and gateway change.

## Amendment 1 (2026-10-16, decided by Andrew)
The vouch success notice says "confirmation sent for {player}" instead of "pairing confirmed for
{player}"; the acceptance item and Out of scope are updated to match. Reason: the notice fires when
`attest` is sent (module/src/link/client.ts:443-446), not when the gateway accepts it.

## Amendment 2 (2026-10-16, external PR review)
**Finding (P2, confirmed in code).** The acceptance item at `:40-43` (an admin GM whose link is not
connected gets a warn) is unmet. module/src/link/vouch.ts:60 begins `if (!client.isAdmin) return;`,
but `LinkClient.isAdmin` is `this.admin && this._state.kind === 'connected'`
(module/src/link/client.ts:428-430), and `setState` clears `this.admin` on any non-connected state
(client.ts:1036-1040). So when the admin GM's link is down, `handleVouchMessage` returns before
`attest` and the `notConfirmed` warn never fires. The test stub `{ isAdmin: true, attest: () => false }`
(module/test/link/vouch.test.ts:157, :175) describes a state a real client cannot reach.

**Change.** Separate "should this client be told" from live authorisation.
- `LinkClient` gains a read-only getter `wasAdmin` and the private field it reads. It is true when
  the most recent `welcome` said `admin: true` (set beside client.ts:751), survives disconnect
  (`setState` does not clear it), and is cleared only by a later `welcome` with `admin: false` or by
  unpair / token clear (client.ts:588-592 and any other path that sets the token to null).
  `isAdmin` and the `attest` guard (client.ts:443-446: `isAdmin` and a socket) are unchanged, so only
  a connected admin link can attest.
- `handleVouchMessage` (its `client` parameter widens to `Pick<LinkClient, 'isAdmin' | 'wasAdmin' |
  'attest'>`):
  - connected admin (`isAdmin`): behaves as today;
  - not connected but `wasAdmin`: shows the `notConfirmed` warn once per message (the same
    `handled` WeakSet dedupe), does not call `attest`, and does not delete the message;
  - otherwise (never admin, a non-admin GM, or a player): returns silently, as today.

**Acceptance (replaces the item at `:40-43`; the others stand).**
- [ ] `LinkClient.wasAdmin` exists, is read-only, and is the only addition to
      module/src/link/client.ts besides its backing field and the lines that set and clear it
      (diff check).
- [ ] The stub case at vouch.test.ts:157 is replaced by a test that drives a real `LinkClient`
      through the existing harness in module/test/link/client.test.ts (fake sockets,
      `welcome({ admin: true })` as at `:836`): connect, admin welcome, disconnect, then deliver a
      vouch message. It asserts exactly one `ui.notifications.warn` with
      `AGENT_GATEWAY.Pairing.Vouch.notConfirmed`, no `attest` frame on any socket, and no `delete`
      of the message, including when the same message is delivered twice.
- [ ] A test with a real `LinkClient` that never received an admin welcome (non-admin welcome, and
      never connected) shows no notification and sends no `attest` frame.
- [ ] A test shows `wasAdmin` is false after a later `welcome` with `admin: false` and after
      `unpair()`.
- [ ] The stub at vouch.test.ts:175 is updated to a shape a real client can reach (or folded into
      the test above).
- [ ] `npm run verify` passes.

**Owns additions.**
- module/src/link/client.ts — the `wasAdmin` getter, its backing field, and the set/clear lines only.
- module/test/link/client.test.ts — new tests only, if the real-client cases live there; otherwise
  they go in module/test/link/vouch.test.ts (already owned) and may import the harness.

**Conflict check.** No open task owns module/src/link/client.ts: 109 lists it only as context
(`:854-855`) and puts it out of scope; 111, 113 and 114 own gateway and docs files only; 112 is
blocked on a decision and its provisional Owns do not include it; 106 puts client.ts out of scope.
None owns module/test/link/client.test.ts.

**Out of scope.** Changing `isAdmin`, the `attest` guard, or what the gateway does with `attest`;
queueing the vouch until the link reconnects.
