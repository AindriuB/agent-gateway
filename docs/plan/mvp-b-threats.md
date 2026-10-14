# MVP B threat map

From the architect's review of task 68 on 2026-10-14. Andrew chose operator invites (Model I) after it: the operator mints a single-use invite for an exact world and user, and a code holder pairs only as that target. There are no observers, no bootstrap rule, no pairing prompts and no role sync. The earlier approval to accept the first GM pairing of a world is withdrawn (T1). GM-attested self-onboarding is deferred to a future task.

"68 (x)" means decision (x) in that task file. "Acc" means one of its acceptance items.

| Threat | Sev | Handling |
| --- | --- | --- |
| T1 Forged hello `isGM` roots a world | H | Removed by Model I. Bootstrap is withdrawn; a code holder pairs only as the invite's exact target (68 c). |
| T2 Bootstrap re-opens after revocation | M | Removed by Model I. No bootstrap exists (68 a). |
| T3 World-id spoof | M | Closed. The hello must equal the world id the operator invited (68 b, c), so a spoof can only pair as an invited identity. |
| T4 Confirmation protocol gaps | H | Removed by Model I. No confirmation protocol (68 a). |
| T5 Surprise claim prompt | M-H | Removed by Model I. No pending claims or prompts. |
| T6 Replacement by social engineering | M | Closed. Replacement needs an operator invite for that exact user (68 d). |
| T7 Old token and grants survive replacement | M | Closed. Replacement revokes the old rows in the redeem transaction (68 d), and 35 (h) revokes the grants. |
| T8 Revoked connection stays live | M | Closed. A sweep closes revoked connections (68 e), within 5 s. |
| T9 Lockout after losing storage | M | Closed. A new invite re-pairs; a headless agent mints its own (37 c, 38). |
| T10 No code left for the next player | M | Implemented (74). Closed. Server mode uses per-person invites; public non-server mode re-issues a consumed code to the operator log (74 d). |
| T11 Pairing denial of service | M | Implemented (74). Closed by 74 (c, e) per-client keys, IPv6 /64 keying and a global backstop; 42 requires `--trust-proxy`. Accepted residual: a distributed flood above 300 failed codes a minute blocks new pairings, including a headless runner with no stored token. Paired clients are unaffected, and it is a denial of service, not a compromise. |
| T12 Concurrent claims | M | Removed or closed. An invite is single use with one winner per transaction (68 c). |
| T13 Pending lifecycle and restart | L-M | Removed or closed. The open-socket guard leaves an invite unused (68 c); database invites survive a restart. |
| T14 Name lookalikes | L-M | Implemented (74). Closed. The name is display only, sanitised and capped (68 f); OAuth binds by id (74 f); 67 refuses an ambiguous name. |
| T15 Unbounded hello fields | L | Closed. Caps on ids, name and code, and sanitised output (68 f). |
| T16 Role sync and CLI overwrite | L | Removed by Model I. No role sync or promote/demote CLIs. |
| T17 Link frame flood | L | Accepted residual for MVP B. Pre-existing and not 68's: toolset and event frames have no per-connection cap. Only an invited user can send them, and `--revoke-pairing` stops them. A per-connection frame budget is a Go public prerequisite, not yet filed. |
| T18 Origin binding between players | L | Accepted residual. Origin separates sites, not players on one origin; identity comes from the invite, and `--origin` can pin one. |
| T19 Grants for unconfirmed identities | covered | Closed. A grant needs a consent code over the user's own paired link (67), and 35 (h) ties grants to the pairing. |
| T20 Headless provisioned codes | covered | Closed. Exact world, user and origin match, single use (37 c, 68 i). Residual as T11. |
| T21 No operator revoke | M | Closed. `--revoke-pairing` revokes the pairings, their grants and every unused invite for that target. `--cancel-invite` cancels unused invites only. `--list-pairings` and `--list-invites` show status (68 e). |
| T22 Spoofed X-Forwarded-For | L | Implemented (74). Closed. Right-most entry from a loopback peer only, with `::ffff:127.0.0.1` and /64 keying (74 c). |

## Other accepted residuals

- Foundry cannot prove identity to the gateway, so the invite code is the trust root. An invite leaked before use can be redeemed by its holder, but only as its exact target. Mitigations are single use, a 24 h default TTL, `--list-invites` to spot it, and `--cancel-invite` or `--revoke-pairing` to cancel it before it is used. Both cancel every unused database invite for the target. Once redeemed, `--revoke-pairing` removes the resulting pairing.
- A revoked live connection can keep acting for up to 5 s (`REVOCATION_SWEEP_MS`). OAuth tokens are cut at once.
- In-memory headless invites are accepted in local mode too; they die with the process and the runner mints again (37 c, 68 i).
