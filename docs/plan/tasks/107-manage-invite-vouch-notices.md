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
- [ ] When the admin GM's browser vouches successfully, that GM gets one
      `ui.notifications.info` naming the player whose pairing was confirmed. The name comes from
      the Foundry user Foundry set as the message author, never from message content (test).
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
