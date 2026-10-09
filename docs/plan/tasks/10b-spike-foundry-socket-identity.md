# 10b — Spike: find out whether Foundry module sockets attest the sender's user id

**Repo:** .
**Depends on:** none
**Owns:**
- docs/spikes/foundry-socket-identity.md

## Goal
This is a spike: the deliverable is an answer and a recommendation, with no
product code. In server mode one gateway serves many players. A player holding a pairing code
can claim another user's id (for example the GM's) in `hello`. Find out what
Foundry itself can prove about who a user is, so that task 36 can make the
paired user's own Foundry client confirm a pairing. The result decides the
identity design in 36.

## Context
- gateway/src/link/server.ts:180-200 — first pairing trusts the `hello` world/user ids; a stored token is bound to them on reconnect
- gateway/src/link/registry.ts:101-125 — connections keyed by (worldId, userId); a new connection for the same key silently replaces the old one
- docs/plan/tasks/36-consent-and-revocation.md — the consumer of this answer
- /home/andrew/homelab/FOUNDRY.md — the v14 instance at https://foundry.local, world `test-world`
- docs/plan/PLAN.md "Testing topology and prerequisites" — browser work runs in the Mac test-bed session; credentials in `~/.config/agent-gateway/test.env`
- Prerequisite: a Player-role test user in `test-world` (`FOUNDRY_PLAYER_USER` / `FOUNDRY_PLAYER_PASSWORD`, the same user task 12 needs; Andrew creates it)

## Acceptance
- [ ] `docs/spikes/foundry-socket-identity.md` exists, under about 150 lines, and opens with a one-paragraph answer: does a client receiving a `game.socket` message on channel `module.agent-gateway` get a server-attested sender user id that a modified client cannot forge? Yes, no, or "only under condition X"
- [ ] The doc records the experiment on foundry.local v14 with the Foundry build number: two browsers (GM `dev-gm` and the Player user) and what the receiving handler's arguments contain. It also records a forgery attempt in which the Player client edits the payload or calls the lower-level socket emit to impersonate the GM, and what the GM client then saw
- [ ] The doc lists what the GM client can verify about another connected user (for example `game.users` `active` state, role, and whether a document change by a user is server-attributed via `userId` in hook options or `modifiedBy`), each marked verified-live or from-source with a file/line or doc link
- [ ] The doc evaluates at least these candidate proofs for task 36 and recommends one: (a) socket sender attestation; (b) a server-permission-checked write that only the claimed user (or a GM) can make, such as a flag on their own User document carrying a gateway nonce, observed by the gateway's link connection; (c) a one-time code shown only in the claimed user's client and entered back elsewhere. For each it states what a malicious Player can and cannot defeat
- [ ] v13 is re-run if the v13 instance exists by the time of the spike; otherwise the doc says "v13 pending" and names what to re-check
- [ ] `git diff --stat` touches only `docs/spikes/foundry-socket-identity.md`; any throwaway console snippets are pasted into the doc, not committed as files

## Out of scope
- Changing pairing, the link server or the module (36)
- Isolation tests and routing (11)
- Creating the Player test user (Andrew, homelab)
