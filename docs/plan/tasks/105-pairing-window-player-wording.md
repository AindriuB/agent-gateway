# 105 — Pairing window: say "this browser isn't paired" and stop steering players to the operator

**Repo:** .
**Depends on:** none
**Status:** Ready.
**Owns:**
- module/src/apps/pairing/**
- templates/pairing/pairing.hbs
- module/test/apps/pairing-ids.test.ts
- module/test/apps/pairing-unpaired.test.ts (new)
- lang/en.json — insertions and edits to `AGENT_GATEWAY.Pairing.*` keys only, excluding `AGENT_GATEWAY.Pairing.Vouch.*` (task 107 owns those). This is a shared insertion-only file (docs/conventions.md, "Shared insertion-only files"): touch no other area's lines.

## Goal
Pairing is per browser. A player who paired on another computer opens Foundry here and the
module never connects, with nothing in the pairing window saying why. The "Copy my ids" block and
its hint ("send these two ids to the operator") are aimed at operator invites, and they confuse
players, whose GM invites them from Manage access. Make the pairing window say plainly when this
browser has no pairing for this user, and reword the ids block so a player is pointed at their GM.

## Context
- module/src/link/client.ts:524-544 — `start()` is a no-op when this user has no credential in this
  browser (or sets `PAIRING_REQUIRED` only when someone else's credential is present). That no-op
  state is what the player sees today.
- module/src/apps/pairing/index.ts:33-59 — `describeState`. A bare `disconnected` with no reason
  falls through to `Link.state.disconnected`.
- module/src/apps/pairing/index.ts:142-154 — context; `paired` comes from
  `getLinkClient().hasCurrentGatewayToken()` (read it, do not change the client).
- module/src/apps/pairing/index.ts:61-64 and module/src/link/gateway-url.ts:77 — `currentGateway()`/`readGatewayResolution` tell you
  whether an address (own or the world default) is set.
- templates/pairing/pairing.hbs:14-19 — the ids block; lang/en.json:179-185 — the `CopyIds` strings.
- docs/guides/headless.md:13 and gateway/docker/README.md:111 rely on "Copy my ids" for operator
  invites (headless agents, GM invites), so the ids must stay reachable.

## Acceptance
- [ ] When a gateway address is set (own or world default), the current user has no credential for
      it in this browser, and the link state is `disconnected` with no reason, the status line
      reads a new `AGENT_GATEWAY.Pairing.Unpaired.*` string. It says this browser is not paired for
      this user, that pairing is per browser so a pairing made on another computer does not carry
      over, and what to do (paste an invite from your GM here). Covered for server and local mode
      (test).
- [ ] With no gateway address set, the status text is unchanged (test).
- [ ] `PAIRING_REQUIRED`, `TOKEN_REJECTED`, `REPLACED` and connected states render exactly as before
      (the existing pairing tests pass unmodified, apart from pairing-ids.test.ts, which this task owns).
- [ ] The ids block is inside a collapsed `<details>` element whose summary names it as for the
      gateway operator. The `copyIds` action, the `data-role="ids"` text and the clipboard
      behaviour are unchanged (pairing-ids.test.ts updated to the new structure and still asserts
      every `CopyIds` key it uses exists).
- [ ] For a non-GM user, the hint shown with the ids says a player is normally invited by their GM
      from Manage access and does not need the ids. For a GM user it keeps the operator wording.
      Both are covered by tests.
- [ ] `AGENT_GATEWAY.Pairing.Server.line` no longer tells players to send their ids "with the button
      below"; it points them at their GM's invite.
- [ ] Every new or changed string is in lang/en.json under `AGENT_GATEWAY.Pairing.*`, and no other
      key in the file changes (diff check).
- [ ] `npm run verify` passes.

## Out of scope
- The Players-list indicator for an unpaired browser (task 106) and module/src/link/** generally.
- Telling the GM about vouching (task 107).
- Removing old-gateway credentials from the UI (an 89 follow-up).
- docs/guides/headless.md and the docker README "Copy my ids" references (task 114 updates them
  after this lands).
