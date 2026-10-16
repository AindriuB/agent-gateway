# 106 — Show "not paired in this browser" outside the pairing window

**Repo:** .
**Depends on:** none
**Status:** BLOCKED on decision. Do not fan out until Andrew answers "Open decisions" and the
answer is written into this file.
**Owns:**
- module/src/link/status-indicator.ts
- module/test/link/status-indicator.test.ts
- lang/en.json — insertions under `AGENT_GATEWAY.Link.Indicator.*` only (a shared insertion-only file).

## Goal
Task 105 explains an unpaired browser inside the pairing window, but a player has to think of
opening that window. The Players-list indicator is hidden for a non-GM who has no credential in
this browser, so a player who paired on another machine sees nothing at all. Decide who should see
a hint outside the pairing window, then show it.

## Context
- module/src/link/status-indicator.ts:7-34 — `indicatorState`; `inUse === false` returns `hidden`
  (doc comment at `:9-10`: a non-GM with no stored credential sees nothing).
- module/src/link/status-indicator.ts:52-60 — `IndicatorDeps` (`hasStoredToken`, `isGM`).
- lang/en.json:121-128 — the existing `Link.Indicator` strings, including `needsPairingToast`.
- module/src/link/gateway-url.ts — `readGatewayResolution` says whether the world has a default
  gateway URL (`inherited`), the signal that "this world uses Agent Gateway".

## Open decisions
1. **Who sees an unpaired hint outside the pairing window?**
   - A. Nobody (keep today's behaviour; 105's pairing-window text is enough).
   - B. Any user, when the world has a default gateway URL set by the GM and this browser has no
     credential for this user: a muted "Agent Gateway: not paired in this browser" in the Players
     list. Players who never use AI see it too.
   - C. As B, but only for users who have paired from any browser before. The module cannot know
     this without asking the gateway, which needs a new unauthenticated link message (a protocol
     change and a probing surface).
   - D. As B, but the player can dismiss it per browser (a client setting).
   - **Recommendation: D.** B's signal is local and needs no protocol change, and the dismissal
     answers the "players who never use AI" objection. C leaks whether a user is paired to anyone
     holding the world URL.
2. **Toast on login?** Whether to also show a one-time toast, as `needsPairingToast` does for a
   lost pairing. **Recommendation: no**; the indicator is enough, and toasts at login are noisy.

## Acceptance (to be finalised with the decision)
- [ ] `indicatorState` returns a new `notPairedHere` state exactly under the decided conditions,
      and `hidden` otherwise (table-driven test over isGM × world default set × credential present ×
      dismissed).
- [ ] The rendered element uses a new `AGENT_GATEWAY.Link.Indicator.notPairedHere` string and the
      same element and class pattern as the other states.
- [ ] The existing states' mappings are unchanged (existing tests pass unmodified).
- [ ] `npm run verify` passes.

## Out of scope
- The pairing window (task 105) and module/src/link/client.ts.
- Any gateway or protocol change (rules out option C unless Andrew picks it; if he does, re-plan).
