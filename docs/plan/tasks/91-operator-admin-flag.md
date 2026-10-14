# 91 — Add the operator `--admin` and `--gm` invites and `--demote` to the CLI

**Repo:** .
**Depends on:** 90
**Owns:**
- gateway/src/bin/cli.ts
- gateway/test/bin/admin-cli.test.ts (new; covers `--admin`, `--gm` and `--demote`)
- gateway/test/bin/invite-cli.test.ts
- gateway/test/bin/invite-string-cli.test.ts (only if list or usage output assertions change)

## Goal
Give the operator the only way to make and unmake an admin GM. `--invite <world> <user> --admin`
mints an admin invite that pairs directly into an admin pairing, using the store support from
90. `--invite <world> <user> --gm` mints a non-admin invite for an additional GM user (for
example a "ChatGPT" GM), which pairs directly without a vouch because vouching cannot prove a GM.
A plain `--invite` stays a player invite that needs a vouch. `--demote <world> <user>` clears the
admin flag. `--list-pairings` and `--list-invites` show who is admin and which invites are GM
invites. This is the bootstrap for the vouched pairing flow and for the in-Foundry management app.

## Context
- scratchpad design: `design-gm-management.md` (a) "Bootstrapping the admin GM" and (c) "Blast radius"
- gateway/src/bin/cli.ts:40-60 — usage text for `--invite`, `--revoke-pairing`, `--cancel-invite` and the list commands
- gateway/src/bin/cli.ts:215-250 — `--ttl`/`--origin` parsing and validation for `--invite`
- gateway/src/bin/cli.ts:286-365 — `runOperatorCommand`: write commands in a transaction, list output through `safeText`
- gateway/src/link/invites.ts `createInvite` (its `admin` and `gm` options) and gateway/src/store/store.ts `demotePairing` (both from 90)
- docs/plan/tasks/90-vouched-pairing.md "Decisions … amendment" — why plain invites still need a vouch and why the `gm` flag is operator-stated
- gateway/test/bin/invite-cli.test.ts — the existing CLI test shape

## Acceptance
- [ ] `--invite <world> <user> --admin --origin <origin>` creates an invite with `admin = 1`, `gm = 1` and `created_by` NULL, and prints it exactly as a normal invite prints (one-paste string or bare code). A test redeems it over a link and gets a pairing with `admin = 1` and no `pairingChallenge`.
- [ ] `--invite <world> <user> --gm` creates an invite with `gm = 1`, `admin = 0` and `created_by` NULL, and prints it exactly as a normal invite prints. A test redeems it over a link with no admin connection live and gets a pairing with `admin = 0`, a welcome with `admin: false`, and no `pairingChallenge`.
- [ ] A plain `--invite <world> <user>` (neither flag) creates an invite with `gm = 0` and `admin = 0`. A test redeems it over a link with no admin connection live and gets `reject` `PAIRING_UNCONFIRMED`, with the invite still unused.
- [ ] `--gm` follows the same `--origin` and `--ttl` rules as a plain `--invite` today (no extra restriction; it pairs at today's trust level). `--gm` together with `--admin` is accepted and behaves exactly as `--admin`. `--gm` without `--invite` exits 2. Tested.
- [ ] `--admin` without `--origin` exits 2 with a usage line naming `--origin`. `--admin` without `--invite` exits 2. Tested.
- [ ] An admin invite defaults to a TTL of 1 h (named constant). `--ttl` above 24 h with `--admin` exits 2. Tested at 24 h (accepted) and 25 h (refused).
- [ ] `--demote <world id> <user id>` clears `admin` on that target's active pairing in one transaction, prints how many rows changed, and exits 1 when there was no active admin pairing. It does not revoke the pairing, its grants or its invites (asserted by a test).
- [ ] After `--demote` against a database that a running gateway has open, that connection's next `attest` is refused, because 90 reads the flag at message time. The test uses the in-process gateway and the CLI against the same DB file.
- [ ] `--list-pairings` adds an `admin` column (`admin` or `-`). `--list-invites` adds a `kind` column: `admin` when `admin = 1`, else `gm` when `gm = 1`, else `-`. They still print no code or token: a test seeds known secrets and asserts that they are absent from stdout and stderr.
- [ ] No CLI path sets `admin = 1` on an existing pairing (there is no promote). `--help` text documents `--admin`, `--gm` and `--demote`, and says that `--gm` skips the GM vouch and is only for GM user accounts, and that a plain `--invite` is for players and needs a live admin GM to confirm it.
- [ ] `npm run verify` passes.

## Out of scope
- Store, migration and link server changes (90 owns them; stop and report if one is needed).
- Delegated invites, the management app, and grants (92, 93, 94).
- Promoting an existing pairing. Refused by design.
- `--invite` output reformatting (89's follow-up).
- Docs (scribe).

## Decisions (Andrew, 2026-10-14)
1. Design approved. Pairing for non-admin users is GM-vouched through a server-authored whispered ChatMessage. Admin GM status is set only by the operator CLI (`--invite … --admin`) and is never derived from `hello.isGM`. The management app lives inside Foundry for the admin GM, over its existing link, scoped to its own world. The CLI stays as the operator's break-glass. No web UI for now.
2. Grants view: yes. The admin GM sees each player's authorized apps as metadata only (client name, scopes, created date; never tokens) and can revoke them. The UI tells players that their GM can see this.
3. Verified evidence: Foundry v13 `BaseChatMessage#canCreate` lets a GM author as anyone, so GM targets cannot be proven by vouching. Admin GMs are bootstrapped by the operator only.
- Planner: `--admin` requires `--origin` and a short TTL, because the admin code is the one remaining leaked-code residual per world (design (a)).

## Decisions (Andrew, 2026-10-14, amendment)
4. A GM account other than the root GM (for example a "ChatGPT" GM user) is paired through an operator invite that is not admin. Vouching never covers GM targets. The operator states the target is a GM with `--gm`; that invite pairs directly at today's trust level. Only `--admin` sets the admin flag, and only admin pairings get the management capabilities of 92–94.
- Planner: a plain `--invite` targeting a player still needs a GM vouch, so a leaked player code fails without the player's own Foundry session (see 90's amendment). The CLI cannot check whether the target is a GM, so `--gm` is the operator's statement and the help text warns against using it for players.
- Planner: `--gm` keeps today's `--origin`/`--ttl` rules rather than `--admin`'s stricter ones, because Andrew set it at today's trust level. Tightening it is a separate decision.

## Notes for the scribe
- README/server docs: the operator onboarding order is to mint the GM's admin invite first, then players pair through the GM. Additional GM users (for example a "ChatGPT" GM) are paired with `--invite … --gm`. Document `--demote` and `--revoke-pairing` as the break-glass.
- Threat map T21: `--demote` is a second operator control.
