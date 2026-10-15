# 93 — Build the in-Foundry GM management app with Invites and Pairings tabs

**Repo:** .
**Depends on:** 89, 92
**Owns:**
- protocol/src/link/messages.ts (insertions only)
- protocol/test/link/pairing-admin.test.ts (new)
- gateway/src/link/pairing-admin.ts (new)
- gateway/src/link/server.ts (dispatch cases for the new messages only)
- gateway/test/link/pairing-admin.test.ts (new)
- module/src/apps/manage/** (new)
- templates/manage/** (new)
- module/src/link/client.ts (request methods and reply handling for the 92 and 93 messages only)
- module/src/settings/index.ts (one registrar line)
- lang/en.json (insertions only)
- styles/agent-gateway.css (one new section)
- module/test/apps/manage/** (new)
- module/test/link/client.test.ts (insertions only)
- module/test/stubs/** (insertions only)

## Goal
The admin GM manages its own world's agent access from inside Foundry. An Invites tab creates,
lists and cancels player invites through 92's messages. A Pairings tab lists the world's
pairings and revokes them through new link messages. Both are world-scoped by the connection's
binding and gated by the store's admin flag. Non-admin users never see the app.

## Context
- scratchpad design: `design-gm-management.md` (c)
- module/src/apps/grants/index.ts, module/src/apps/grants/model.ts, templates/grants/grants.hbs — the ApplicationV2 window, offline and too-old states, escaping and settings-menu registration to follow
- module/src/link/client.ts:155-195, 511-518 — `grantsRequest` (request id, timeout, pending map) and its reply case
- gateway/src/link/grants.ts — the world-scoped handler shape
- gateway/src/store/store.ts `revokePairing`, `revokePairingsFor`, `listActivePairings` — revoke reuses the CLI's transaction (pairings, grants, unused invites), and the 5 s sweep closes the socket
- gateway/src/link/registry.ts — `get(worldId, userId)` for the connected state
- gateway/src/link/invite-admin.ts (92) — admin check, rate limits and caps to reuse

## Acceptance
- [ ] New strict messages: `listPairings{requestId}`, which replies `pairings{requestId, pairings:[{id, userId, userName, origin, createdAt, admin, connected, self}]}`, and `revokePairing{requestId, pairingId}`, which replies with the updated `pairings`. Neither carries a world id. The protocol test rejects an extra `worldId`.
- [ ] Each passes the stale-connection check and reads the sender's admin flag from the store, as in 92. A non-admin sender (including one whose hello says `isGM: true`) gets `FORBIDDEN`. Tested.
- [ ] `listPairings` returns only active pairings with `world_id = conn.worldId`, with no token hash. `connected` comes from the registry, and `self` marks the sender's own row. A test serializes the reply and asserts that no token or hash appears.
- [ ] `revokePairing` revokes, in one transaction, a pairing of the sender's own world that is either non-admin or the sender's own, together with that user's grants and unused invites. Revoking another admin's pairing gets `FORBIDDEN` with no change. A pairing id from another world gets the same `error` as an unknown id. Tested with two worlds and two admins in one world.
- [ ] The rate limit from 92 counts these messages too. Tested.
- [ ] Module: the app is registered as a settings menu (`restricted: true`). It renders only when the last welcome said `admin: true`. Otherwise it shows a localized "only the admin GM can manage access" state and sends nothing. Tested with stubs.
- [ ] The Invites tab lists invites (user name resolved through `game.users`, falling back to the id, plus expiry and status), creates an invite for a chosen non-GM user with a TTL choice, and cancels one. The created code is shown once in a dialog as `<gateway URL>#<code>` (the module's effective gateway URL), with a copy button. It is not stored and not re-rendered on refresh. Tests assert that the code is absent from the context on the next render and from `console.*`, `ui.notifications.*` and settings.
- [ ] The Pairings tab lists pairings with a revoke action, which is disabled for other admins and asks for confirmation for the sender's own row. Tested.
- [ ] Every interpolated value (user names, origins, client-supplied strings) is escaped. A test renders a pairing whose `userName` is `<img src=x onerror=alert(1)>` and asserts it appears escaped.
- [ ] Offline, an old gateway (protocol major mismatch) and request timeouts each show a localized state. Tested.
- [ ] `npm run verify` passes.

## Out of scope
- The grants-per-user tab (94).
- A cross-world or operator view, and any HTTP or web UI. Refused for now.
- Promoting or demoting admins (CLI, 91).
- A "last seen" column. No such column exists, so do not add a migration.
- Docs (scribe).

## Decisions (Andrew, 2026-10-14)
1. Design approved. Pairing for non-admin users is GM-vouched through a server-authored whispered ChatMessage. Admin GM status is set only by the operator CLI (`--invite … --admin`) and is never derived from `hello.isGM`. The management app lives inside Foundry for the admin GM, over its existing link, scoped to its own world. The CLI stays as the operator's break-glass. No web UI for now.
2. Grants view: yes. The admin GM sees each player's authorized apps as metadata only (client name, scopes, created date; never tokens) and can revoke them. The UI tells players that their GM can see this.
3. Verified evidence: Foundry v13 `BaseChatMessage#canCreate` lets a GM author as anyone, so admin status comes from the operator only, never from the Foundry role.

## Notes for the scribe
- User docs: a GM guide for the management app, covering inviting a player, the vouch prompt in chat, and revoking.
- docs/architecture.md: the link management messages and the admin authz model.

## Amendment 1 (Andrew, 2026-10-15)

1. Split version gate. The Invites tab needs gateway 0.2.0 or later (task 92's messages shipped in 0.2.0). The Pairings tab needs gateway 0.3.0 or later; below that it shows the localized "update the gateway" state and never sends `listPairings` or `revokePairing`, because a 0.2.0 gateway closes the link (1008) on an unknown message. Tasks 93 and 94 ship as 0.3.0. Test both tabs against a 0.2.0 and a 0.3.0 welcome version.
2. Shared rate limit. Invite and pairing messages share 92's single 60-per-minute window per connection, as the acceptance says. Owns widens to export the window (or a shared limiter) from gateway/src/link/invite-admin.ts; no behaviour change there. Test: 60 `listInvites` then one `listPairings` in the same minute gives RATE_LIMITED.

## Review round 1 — findings

Reviewed HEAD: 279e290. Both P2s are settled by Amendment 1. Routed to the implementer: Amendment 1 items 1–2, plus the two P3s (a test for the `revokedAt` guard in `senderIsAdmin`; a test for the per-action re-check in `onCreateInvite`). The NOTEs are not adopted.

VERDICT: FIX

FINDINGS (most severe first)
- [P2] /Users/Andrew/workspace/foundry-modules/agent-gateway/.claude/worktrees/agent-a6c8266ebdbb0e87b/module/src/link/client.ts:134 — `MANAGE_MIN_GATEWAY_VERSION = '0.2.0'` treats the released 0.2.0 gateway as supporting `listPairings` and `revokePairing`, but 0.2.0 shipped without them.
  route: orchestrator — the fix needs a version number that is not decided yet: the next release, whether 0.2.1 or 0.3.0. It also means choosing between one gate for both tabs and a split gate, since Invites (task 92) already works on 0.2.0. The task does not make either choice.
  input: a module built from this branch connected to the deployed 0.2.0 gateway (aindriub.app). The admin GM opens Manage access and clicks the Pairings tab. The client sends `{type:'listPairings',…}`, and the 0.2.0 server's strict parse fails. It runs `ws.close(1008, 'invalid')` (origin/main gateway/src/link/server.ts:414-416).  →  The GM's whole link drops, along with any tool calls in flight. The app then shows "offline" instead of the localized "too old" state. Every later click on the Pairings tab drops the link again.

- [P2] /Users/Andrew/workspace/foundry-modules/agent-gateway/.claude/worktrees/agent-a6c8266ebdbb0e87b/gateway/src/link/pairing-admin.ts:12 — the rate limit is a second WeakMap window of the same size, so the 92 limit does not count these messages. One connection gets 60 invite messages plus 60 pairing messages per minute, not 60 in total.
  route: orchestrator — Acceptance says "The rate limit from 92 counts these messages too". The doc comment on `MAX_INVITE_MESSAGES_PER_WINDOW` in invite-admin.ts says "All three message types together". A shared count needs an export from gateway/src/link/invite-admin.ts, which is outside Owns. Otherwise the acceptance line has to be amended.
  input: one admin connection sends 60 `listInvites` and then 60 `listPairings` within one minute.  →  All 120 are answered. The spec says the 61st should get RATE_LIMITED. The test (gateway/test/link/pairing-admin.test.ts "counts both messages per window") only counts the two pairing messages against each other.
  My judgement: the security impact is small. These are admin-only, per connection and synchronous, and each list is an O(active pairings) scan. Recording a separate same-size window as a Decision is acceptable and the cheapest way to resolve this. The other way is to extend Owns to export the 92 window.

- [P3] /Users/Andrew/workspace/foundry-modules/agent-gateway/.claude/worktrees/agent-a6c8266ebdbb0e87b/gateway/src/link/pairing-admin.ts:19 — no test covers the `row.revokedAt === null` guard in `senderIsAdmin`. It is the only thing that stops a just-revoked admin from acting during the window of up to 5 s before the sweep closes its socket. The server's stale-connection check still passes during that window.
  route: implementer
  input: a test where the admin revokes its own pairing, then sends `revokePairing` for a player before the sweep runs. It should get FORBIDDEN.
  proof: I deleted `row.revokedAt === null &&` in a copy of the branch. pairing-admin.test.ts still passed 10/10.

- [P3] /Users/Andrew/workspace/foundry-modules/agent-gateway/.claude/worktrees/agent-a6c8266ebdbb0e87b/module/src/apps/manage/index.ts:207 — no test covers the per-action re-check in `onCreateInvite` (`if (unavailableReason()) return;`). The test "shows the not-admin state and sends nothing" checks only cancel and revoke.
  route: implementer
  input: call `onCreateInvite` with `isAdmin: false` and a valid player, and assert that `createInvite` is not called.
  proof: I removed the re-check. test/apps/manage still passed 17/17. The re-check in `client.manageRequest` and the gateway check still refuse the request, so the only gap is the test.

- [NOTE] gateway/src/link/pairing-admin.ts:99 — the `target.admin ||` clause is redundant with `otherAdmin`, because pairing replaces earlier rows (invites.ts:117 `revokeActiveFor`). Removing it leaves every test green (I ran this mutation). It is harmless defence in depth.
- [NOTE] module/test/apps/manage/manage.test.ts "keeps hostile names as plain text" — the "render" step uses the test's own escape function in place of Handlebars, so that part proves nothing. Handlebars is not installed in node_modules. What does guard the template is the structural assertion `not.toMatch(/\{\{\{|\{\{&/)` together with the context check that `userName` is passed through as raw text: I checked that a `{{{userName}}}` template would fail it. I consider that an adequate proxy, but it is weaker than the acceptance wording "renders".
- [NOTE] module/src/link/client.ts:768 — no test covers the `pending.expect === msg.type` check. A reply only reaches it if the gateway echoes a request id under the wrong reply type, so this is not a real defect.
- [NOTE] pairing-admin.ts:33 — `listActivePairings()` loads every world's active pairings and then filters, on every message. That is bounded by the operator-issued pairing count and the 60/min limit. The 200-row slice is oldest first, so in a world with more than 200 pairings the newest cannot be revoked from the UI. That is unlikely in practice.

Checked and sound:
- **Gateway scoping.** World scoping uses the binding only, and the protocol test rejects a `worldId` field. Admin status is read from the store row on every message, and a demoted admin is refused (tested). Probing a foreign-world id, an unknown id or an already-revoked id gets the same `INVALID_ARGS` with "no such pairing" (tested). Revoking another admin returns FORBIDDEN and changes nothing.
- **Self-revoke.** It goes through `revokePairingsFor` in one transaction (pairings, the GM's own OAuth grants, invites for that user), then sends the reply on the still-open socket. The sweep closes it, and the following re-render gets FORBIDDEN and shows the not-admin state. Acceptance specifies this behaviour.
- **Module code handling.** The invite code goes only into the DialogV2 content and the copy closure. It is never in the context, `console`, notifications or settings (tested).
- **Escaping.** Every template tag is `{{…}}`, and the dialog content is escaped.
- **Reply routing.** Request ids are `manage-N`, never reset, and checked against the live socket and the request's own socket. An error with an unknown or grants request id is ignored. Pending requests are rejected as OFFLINE on disconnect. A reply cannot resolve another request.
- **Gateway mutation results.** I mutated the cross-world check, the admin guard, the sender admin flag, the world filter, the rate limit, `own`, `self` and `connected`, one at a time. Each mutation failed a test.

SCOPE: clean

## Review round 2 — findings

Reviewed HEAD: 9e8d64a. These were fixed in 46b6e68:
- [STYLE] gateway/test/link/pairing-admin.test.ts — the revoked-admin test was filed under `describe('rate limit')`, with an unused `const p`. Moved under `describe('who may manage pairings')`.
- [P3] gateway/src/link/invite-admin.ts — the `MAX_INVITE_MESSAGES_PER_WINDOW` comment still said three message types. Updated to five.

## Attempt 1 — failed (/verify, acceptance reviewer)

At HEAD 46b6e68 the acceptance review returned CHANGES:
- [DEFECT] templates/manage/manage.hbs:2-4 with module/src/apps/manage/index.ts:102-104. An admin GM on a 0.2.0 gateway clicks the Pairings tab, and `prepareManage('pairings')` returns `unavailable: tooOld`. The template's `{{#if unavailable}}` then hides the whole `<nav class="tabs">`, so the window shows only "update the gateway" with no way back to the Invites tab, which Amendment 1.1 says works on 0.2.0. A TIMEOUT or FORBIDDEN on either tab does the same: it removes the tabs and gives no way to retry.
Fix: a failure specific to one tab keeps the tab nav visible and shows the state inside that tab's panel. Only the whole-app states (not admin, offline, protocol mismatch, gateway below 0.2.0) may replace the nav. Add a retry action for TIMEOUT. Tests:
- on 0.2.0, Pairings shows tooOld with the nav present, and switching to Invites works;
- a TIMEOUT on Invites keeps the nav, and retry re-requests.
Optional: a test for the BUSY path (a fifth concurrent request).
