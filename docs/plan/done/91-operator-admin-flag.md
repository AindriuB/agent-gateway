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
It carries the same `--origin` requirement and short TTL as `--admin`.
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
- [ ] `--invite <world> <user> --gm --origin <origin>` creates an invite with `gm = 1`, `admin = 0` and `created_by` NULL, and prints it exactly as a normal invite prints. A test redeems it over a link with no admin connection live and gets a pairing with `admin = 0`, a welcome with `admin: false`, and no `pairingChallenge`.
- [ ] A plain `--invite <world> <user>` (neither flag) creates an invite with `gm = 0` and `admin = 0`. A test redeems it over a link with no admin connection live and gets `reject` `PAIRING_UNCONFIRMED`, with the invite still unused.
- [ ] `--gm` together with `--admin` is accepted and behaves exactly as `--admin`. Tested.
- [ ] `--admin` without `--origin` exits 2 with a usage line naming `--origin`, and so does `--gm` without `--origin`. `--admin` without `--invite` exits 2, and so does `--gm` without `--invite`. Each case is tested separately for both flags.
- [ ] An admin or GM invite defaults to a TTL of 1 h, and `--ttl` above 24 h exits 2. Both limits come from one pair of named constants shared by `--admin` and `--gm`. Tested for each flag: no `--ttl` gives a 1 h expiry, 24 h is accepted, and 25 h is refused. A plain `--invite` keeps today's TTL default and limit (asserted unchanged).
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
- Andrew (2026-10-14): `--gm` invites follow the same rules as `--admin`: `--origin` is required, the default TTL is 1 h, and the cap is 24 h. Reason: a leaked `--gm` code pairs with no vouch, so it is the same per-target leaked-code residual as an admin code and gets the same short exposure window.

## Notes for the scribe
- README/server docs: the operator onboarding order is to mint the GM's admin invite first, then players pair through the GM. Additional GM users (for example a "ChatGPT" GM) are paired with `--invite … --gm`. Document `--demote` and `--revoke-pairing` as the break-glass.
- Threat map T21: `--demote` is a second operator control.

## Review round 1 — findings

Reviewed HEAD: 48e7f74. All findings are tests only and routed to the implementer (the two P2s, plus the P3 as optional).

VERDICT: FIX

The code in `gateway/src/bin/cli.ts` handles every guard you listed correctly, and lint and Prettier pass. Two tests in `admin-cli.test.ts` pass even with the guard they cover removed: demote target scoping, and the `--admin`/`--gm` without `--invite` checks. That is two P2s.

FINDINGS
- [P2] gateway/test/bin/admin-cli.test.ts:177-179 — Nothing tests that `--demote` only touches the named world and user. The `nobody` case runs after gm1 is already demoted, so there is no admin left for a broken filter to hit.
  route: implementer
  input: change cli.ts:382 to `p.worldId === cmd.worldId && p.admin` (drop the user check), or drop the world check. Then `--invite w1 gm1 --admin --origin O`, redeem it, and run `--demote w1 nobody`  →  gm1 loses admin and the command exits 0. The test cannot see this.
  proof: both mutants (user check removed, world check removed) SURVIVED, 16/16 pass. Fix: run `--demote w1 nobody` (and a same user in another world, e.g. `w2 gm1`) before the real demote, and assert gm1 is still `admin: true` and the exit code is 1.
- [P2] gateway/test/bin/admin-cli.test.ts:83-84 and :216 — The "`--admin`/`--gm` without `--invite` exits 2" checks only look at the exit code, and that exit 2 comes from a different check: the "Unexpected argument" positional guard at cli.ts:494. The new guards at cli.ts:256-257 are never exercised.
  route: implementer
  input: delete cli.ts:256 or :257. Then running `foundry-agent-gateway --admin` with no positionals ignores the flag and starts the gateway, and the test does not notice.
  proof: removing :256 SURVIVED (16/16); removing :257 SURVIVED (16/16). Fix: assert stderr contains `${flag} goes with --invite`, and add the no-positionals case.
- [P3] gateway/test/bin/admin-cli.test.ts:255 — The secrets check seeds the pairing `tokenHash` values but not the invites' `codeHash`, so `--list-invites` could print the code hash and the test would still pass.
  route: implementer
  proof: adding `${i.codeHash}` to the list-invites line (cli.ts:412) SURVIVED. Fix: add `hashInviteCode(code)` for a, g and p to `secrets`.
- [NOTE] cli.ts:379-385 — Running the demote outside `s.transaction` is not something a test can see: each pairing is a single UPDATE, and the target normally has only one. The code does wrap it in one transaction, as the acceptance asks.
- [NOTE] cli.ts:382 — `&& p.admin` adds nothing, because the demote SQL already filters on `AND admin = 1` (store.ts:231). Removing it changes nothing, so its surviving mutation is not a test gap.
- [NOTE] If `--ttl` is given twice, the last value wins (node `parseArgs`, same as before this branch). The cap still holds: `--ttl 1h --ttl 30h` exits 2, and `--ttl 30h --ttl 1h` gives a 1 h invite.

Mutations that the test file caught (scratch copy, branch rebuilt each time, only `admin-cli.test.ts` run):
- `--origin` requirement removed, or required for `--admin` only.
- Default TTL as 24 h for `--gm` or for both flags.
- The 24 h cap removed, changed to `>=`, or applied to `--admin` only.
- `--gm` setting admin.
- A plain invite getting gm=1.
- Allowing `--admin`/`--gm` with a non-invite command.
- `--demote` revoking grants, cancelling invites, or exiting 0 when nothing changed.
- `--list-pairings` printing the token hash.
- Swapped kind order in `--list-invites`.

Argument parsing, run directly against the built CLI (the guards behave correctly, and these are not test results):
- Exit 2: `--ttl -1h` (parseArgs "ambiguous"), `--ttl=-1h`, `0h`, `1.5h`, `1441m`, `--origin=`.
- Exit 2: `--list-invites --admin`, `--list-invites --gm`, `--list-pairings --gm`, `--demote w1 u1 --gm`, `--demote … --origin`, `--invite --demote w1 u1`, `--gm --origin O`.
- Accepted: `1440m` and `1d` (exactly 24 h), and `--admin --admin`.

Setup caveat: the main checkout's `protocol/dist` is stale. It is from before task 90 and has no `attest`. Against it, the "refuses the next attest" test times out. With protocol rebuilt in the scratch copy, the file passes 16/16. This only matters for anyone running tests against main's node_modules without rebuilding.

SCOPE: clean (the branch changes only gateway/src/bin/cli.ts and gateway/test/bin/admin-cli.test.ts)

Scratch copy: /private/tmp/claude-501/-Users-Andrew-workspace-foundry-modules-agent-gateway/2ea49aeb-bebb-47e8-84ee-7042e90a8488/scratchpad/t91; mutation scripts are in the same scratchpad (mut.py, mut2.py, probe.sh).
