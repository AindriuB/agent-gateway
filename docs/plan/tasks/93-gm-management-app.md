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
