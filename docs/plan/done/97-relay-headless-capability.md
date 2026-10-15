# 97 — Detect a relay primary too old to run a headless agent

**Repo:** .
**Depends on:** 37
**Status:** Planned 2026-10-15. A follow-up from task 37 Amendment 7 decision 3. 37 has merged (PR #151), so it can start. Decision (b) was settled by Andrew on 2026-10-15: standby with a loud reason, no relay, no takeover attempt.
**Owns:**
- gateway/src/relay/server.ts (the capability field in the handshake replies only)
- gateway/src/relay/upstream.ts (reading the capability from the handshake reply only)
- gateway/src/relay/secondary.ts (the headless caller's handling of a primary without the capability only, in `acquire` and `watchStandby`)
- gateway/src/relay/constants.ts (insertions only: the capability name)
- gateway/test/relay/headless-capability.test.ts (new)

## Goal
A gateway from before task 37 ignores the `headless` field of `RelayConfig`. When a new gateway with
headless settings starts and an old gateway already holds the link port with otherwise matching
settings, the new one relays to it and its agent never starts, with no warning. The new gateway must
detect a primary that does not understand headless settings, and must not silently relay to it.

## Context
- gateway/src/relay/constants.ts:2 `RELAY_VERSION = 1`. Both sides check it with strict equality: gateway/src/relay/server.ts:256 refuses any other value with `RELAY_PROTOCOL`, and gateway/src/relay/upstream.ts:229 fails on a reply with another value ("relay speaks a different protocol version").
- gateway/src/relay/server.ts:247-330 `handshake`: the caller's `config` is compared with `sameConfig` / `sameSessionConfig`; the `startedAt` "newer" rule and the Amendment 6 headless exception are at :290-320. `refuse` (:199) and the ok reply (:353) are the two reply shapes.
- gateway/src/relay/upstream.ts:186-250: the caller's hello (it already sends `config`, including `headless`) and the parsing of the reply. The ok reply today carries nothing but `{relay, ok}`.
- gateway/src/relay/config.ts:73-95 `parseRelayConfig`: a field the peer does not send reads as off. A pre-37 primary's `parseRelayConfig` drops `headless`, so it compares the configs as equal and serves the relay.
- gateway/src/relay/secondary.ts:240-300 `acquire`: what the caller does with each handshake outcome (`ok`, `RELAY_CONFIG_MISMATCH` → standby, `RELAY_CONFIG_STEPDOWN` → take over). `serveStandby` and `watchStandby` (:170-200) re-check the port and relay "if the holder now accepts this configuration".
- docs/plan/done/37-headless-runner.md Amendments 5-7: the current takeover rules for headless callers and primaries.

## Decisions
- (a) **A capability flag, not a version bump.** Bumping `RELAY_VERSION` makes every old/new pair fail with `RELAY_PROTOCOL` in both directions (strict equality on both sides), which breaks old-caller/new-primary compatibility. Instead, a primary that understands headless settings adds a capability marker to both its ok and its refusal replies (e.g. `caps: ["headless"]`; name it in constants.ts). `RELAY_VERSION` stays 1. Old callers ignore the unknown reply field, so nothing changes for them.
- (b) **What a headless caller does with an old primary: standby with a loud reason; it does not relay and does not try to take over.** Decided by Andrew, 2026-10-15. A caller whose own `headless` field is non-empty that gets an ok reply without the capability closes that upstream and goes to standby. The standby reason, shown in the log and `gateway_status`, contains "primary too old, headless agent not running", and goes on to say that the gateway holding the link port does not understand headless settings and that the operator should upgrade or stop it. When the old primary exits, the existing standby port watch (`watchStandby`) takes the port and this gateway becomes primary and starts its agent, with no operator action.
  - Why not take over: an old primary sees the configs as equal and never steps down, and there is no protocol message that makes it, so a takeover would mean fighting for the port.
  - Why not relay with a warning: the headless gateway exists to run its agent, and a log line that the operator may never see is the silent failure this task removes.
- (c) A plain caller (empty `headless`) ignores the capability, whatever the primary's version. It relays to an old primary exactly as today.
- (d) `watchStandby` applies the same check, so a headless standby never relays to a capability-less primary on a later attempt.

## Acceptance
- [ ] Test: a fake old primary (a relay server whose ok reply is `{relay: 1, ok: true}` with no capability, simulating pre-37) and a caller with headless settings: the caller does not attach the upstream, ends in standby, and its standby reason contains "primary too old, headless agent not running".
- [ ] Test: the same headless standby, re-checking the port while the old primary still holds it, stays in standby (it does not relay on a later attempt). When the old primary releases the port, the standby takes over and becomes primary.
- [ ] Test: a plain caller against the same fake old primary relays as today (served, not in standby).
- [ ] Test: an old caller against a new primary (a hello with `relay: 1` and a config without `headless`) is served exactly as before, and the reply it receives still has `relay: 1` and `ok: true`.
- [ ] Test: a new headless caller against a new primary sees the capability and relays or takes over under the 37 rules (the Amendment 5 and 6 takeover tests still pass unchanged).
- [ ] `RELAY_VERSION` is still 1 (`grep -n "RELAY_VERSION = 1" gateway/src/relay/constants.ts`).
- [ ] `npm run verify` passes.

## Out of scope
- Changing `RELAY_VERSION` or the strict version check.
- The takeover rules from 37 Amendments 5 and 6.
- A general capability negotiation for other features.
- Docs (43; the "run the same version on one link port" note is from 37 Amendment 7).

## Amendment 1 (2026-10-15)

Andrew, from code review.

### Decisions

1. **Capabilities go only to an authenticated peer.** Decision (a)'s "both its ok and its refusal replies" narrows: the capability marker goes on the ok reply and on refusals sent after authentication succeeded (e.g. `RELAY_CONFIG_MISMATCH`, `RELAY_CONFIG_STEPDOWN`), and never on the pre-authentication refusals `RELAY_AUTH` and `RELAY_PROTOCOL`. Nothing reads caps from a refusal, so behaviour is unchanged, and an unauthenticated peer learns nothing about the primary. The Acceptance items above do not depend on caps in a refusal, so none changes; the items below pin the narrowing.

### Acceptance (added)
- [ ] Test: a hello with a wrong token gets a `RELAY_AUTH` refusal with no capability field, and a hello with `relay` other than 1 gets a `RELAY_PROTOCOL` refusal with no capability field.
- [ ] Test: an authenticated hello refused with `RELAY_CONFIG_MISMATCH` or `RELAY_CONFIG_STEPDOWN` carries the capability, as does the ok reply.

## Review round 1 — findings
Reviewed HEAD: 79f805e (code review: no bugs; both caller paths correct; the mutation proofs pass).

- [STYLE] gateway/src/relay/server.ts:10: `RELAY_CAP_HEADLESS` is imported after `RELAY_HANDSHAKE_MS`, which breaks the alphabetical order of the import list at :6-13. secondary.ts:10 already has it in order.
  route: implementer
- [P3] Amendment 1 acceptance: add the two tests if they are not already covered.
  - RELAY_AUTH (wrong token) and RELAY_PROTOCOL (relay ≠ 1) refusals carry no capability field.
  - RELAY_CONFIG_MISMATCH and RELAY_CONFIG_STEPDOWN refusals from an authenticated peer carry it, as does the ok reply.
  Put them in gateway/test/relay/headless-capability.test.ts.
  route: implementer

## Review round 2 — findings
Reviewed HEAD: c5a6928. Acceptance review APPROVE. Verify PASS once `npm ci` had run in the worktree (4907/4907 tests; the 3 earlier failures came from a missing node_modules).

- [P3] gateway/src/relay/secondary.ts:209-212: in `watchStandby`, a too-old primary only triggers `continue` and does not set the standby reason again. So a standby that started for another reason, such as a config mismatch, keeps that stale reason after a pre-37 primary takes the port, and the operator is never told the headless agent is not running because the primary is too old. Set the "primary too old, headless agent not running" reason, logging it once, whenever `watchStandby` sees a too-old primary. Add a test: a standby that started with a mismatch, then a fake old primary on the port, ends with the too-old reason.
  route: implementer

## Review round 3 — findings
Reviewed HEAD: a9a9163 (round 2 FIXED; the reviewer judged it CLEAN).

- [P3] gateway/test/relay/headless-capability.test.ts:115-135: the new test's `RelayServer` is closed only inline (`await server.close()` at :135), not through `cleanups`, so a failed assertion leaves it listening. Register it the way the test at :168 does: `cleanups.push(() => server.close())`.
  route: implementer
