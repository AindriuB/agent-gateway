# 157 — Tell the vouching GM whether the gateway accepted the pairing

**Repo:** .
**Depends on:** none
**Owns:**
- protocol/src/link/messages.ts (insertion only: one new gateway-to-module message and its union entry)
- protocol/src/link/version.ts (the version constant and its doc comment)
- protocol/test/link/** (new tests; existing files only where they pin `7.2.0`)
- gateway/src/link/server.ts (the `attest` method at :923-970, the hello handling that records the
  module's protocol version, and the `attest` case at :567-578)
- gateway/src/link/registry.ts (insertion only: one field on `LinkConnection` for the module's
  protocol version, if the version is kept there)
- gateway/test/link/attestation.test.ts
- gateway/test/link/attest-result.test.ts (new)
- module/src/link/client.ts (the `attest` method at :473-476 and one new `case` in the message switch)
- module/src/link/vouch.ts
- module/test/link/vouch.test.ts
- module/test/link/client.test.ts (the `7.2.0` pin at :259 and new attest tests)
- module/test/approvals/approval-state.test.ts (only lines that break because of the version bump)
- lang/en.json (insertions under `AGENT_GATEWAY.Pairing.Vouch.*` only)

## Goal
When an admin GM's browser vouches for a player's pairing, it shows "Agent Gateway confirmation sent
for {player}" as soon as the `attest` frame is sent; the GM never learns whether the gateway paired
the player or refused. Add an acknowledgement from the gateway so the notice says what happened,
and keep today's "confirmation sent" wording when no acknowledgement can arrive (an older gateway,
or none in time).

## Context
- docs/plan/done/107-manage-invite-vouch-notices.md:36-61 and :114: the notice, why it says "sent",
  and the follow-up this task closes. HISTORY-INDEX row for 102, 105, 107.
- module/src/link/vouch.ts:51-83: `handleVouchMessage`; the info and warn notices and the message
  delete. The player name comes from the message author, never its content; keep that.
- module/src/link/client.ts:473-476: `attest()` returns true when the frame is sent. :207-208 and
  :787: `gatewayProtocol` from `welcome`; :382 and :957 use `protocolAtLeast` to gate features on
  the gateway's minor version. Follow that pattern.
- gateway/src/link/server.ts:923-970: `attest`. Outcomes today: not admin (FORBIDDEN error frame);
  unknown, expired or other-world nonce (silently ignored); author mismatch, GM author, or redeem
  failure (the redeemer is rejected); redeemer socket gone (ignored); success (`admit`).
- gateway/src/link/server.ts:598: `checkCompat` on `hello.protocolVersion`. A 7.2 module may not
  accept an unknown frame type, so the gateway must only send the new frame to a module whose hello
  said 7.3.0 or later.
- protocol/src/link/version.ts:1-8 and :38: the version history comment and `protocolAtLeast`.
- protocol/src/link/messages.ts:240-256: `PairingChallengeMessage` and `AttestMessage`, the shape
  to follow (strict objects, bounded strings). This file is a shared registry
  (docs/conventions.md, shared files): insert only.
- lang/en.json:160-168: the `Pairing.Vouch` keys.

## Design
- Protocol 7.3.0 adds `attestResult` (gateway to module): `{ type: 'attestResult', nonce, outcome }`,
  `nonce` bounded like `AttestMessage.nonce`, `outcome` one of `'paired' | 'refused'`.
- The gateway sends it to the attesting connection only, only if that module's hello was 7.3.0 or
  later, and only for an attest it acted on: `'paired'` after a successful `admit`; `'refused'` for
  an author mismatch, a GM author, or a redeem failure. Unknown, expired, other-world nonces and a
  gone redeemer stay silent, exactly as today (no new oracle for nonces).
- The module, when the gateway is 7.3.0 or later, waits up to 10 s for an `attestResult` with the
  same nonce. `'paired'`: info "Agent Gateway pairing confirmed for {player}." `'refused'`: warn
  "Agent Gateway did not accept {player}'s pairing. Ask them to request a new invite." Timeout,
  disconnect, or an older gateway: the existing `Vouch.confirmed` ("confirmation sent") info.
  Exactly one notice per vouch in every case. The chat message delete is unchanged.

## Acceptance
- [ ] `PROTOCOL_VERSION` is `7.3.0`, the version comment has a 7.3 line, and `AttestResultMessage`
      is exported and in the link message union. A protocol test parses a valid frame and rejects
      an unknown `outcome` and an over-long nonce.
- [ ] Gateway tests (attest-result.test.ts): a 7.3.0 admin module that attests a valid nonce gets
      one `attestResult` `paired`; an author mismatch and a GM author each get `refused`; an unknown
      nonce gets no frame; a 7.2.0 admin module gets no `attestResult` in any of these cases, and
      its pairing still completes.
- [ ] Module tests (vouch.test.ts): with a 7.3.0 gateway, `paired` shows only the "pairing confirmed"
      info, `refused` shows only the warn, and no reply within 10 s (fake timers) shows only the
      "confirmation sent" info; with a 7.2.0 gateway the "confirmation sent" info shows at once, as
      today. In every case exactly one notification is shown and the player name is the author's.
- [ ] An `attestResult` whose nonce matches no pending vouch is ignored by the module (test).
- [ ] lang/en.json gains `AGENT_GATEWAY.Pairing.Vouch.paired` and `AGENT_GATEWAY.Pairing.Vouch.refused`
      and no other key changes.
- [ ] `npm run verify` passes.

## Out of scope
- Who may vouch, the vouch rate limits, and what `attest` does on the gateway beyond sending the
  new frame.
- The player-side pairing messages (`Vouch.waiting`, `unconfirmed`, `noGm`).
- docs/** and CHANGELOG.md (scribe and release; the PR must say this is protocol 7.3.0 and that
  module and gateway stay compatible in both directions).
- module/src/tools/**, gateway/src/http/**, and the heartbeat code in server.ts (:45-50, :354-390).

## Review round 1 — findings

1. **[P2] The unknown-nonce test can't see a stray frame.** gateway/test/link/attest-result.test.ts:72-77. `flush()` waits for 'pong' through `nextOf`, which skips frames of other types. So an `attestResult` sent for an unknown nonce passes the test. Fix: send a ping, then assert that the *very next* frame is the pong (`a.send(ping)` followed by `expect(await a.next()).toMatchObject({type:'pong'})`, as the 7.2 case at :91-93 does).
2. **[P2] "Exactly one `attestResult`" isn't checked.** In the paired case (:58), the trailing `flush` has the same flaw, and the refused case (:62-70) checks nothing after its frame. Fix: after the expected `attestResult`, use the same ping, then next-frame-is-pong assertion, so any second `attestResult` fails the test.
3. **[P2] The vouch notices don't check the player name.** module/test/link/vouch.test.ts:203-272: the new tests use the default `format: (k) => k`, which drops `{player}`. Fix: use `format = (k, d) => \`F:${k}:${d.player}\`` with an author whose name differs from anything in the message content, and assert the author's name in the paired, refused, timeout, disconnect and 7.2 notices.
