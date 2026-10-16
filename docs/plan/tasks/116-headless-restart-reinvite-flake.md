# 116 — Diagnose and fix the headless restart re-invite flake

**Repo:** .
**Depends on:** none
**Owns:**
- gateway/src/headless/**
- gateway/test/headless/**

## Goal
`gateway/test/headless/app.test.ts` "restart with the same profile > reconnects with the stored
token and mints no invite" fails now and then. On the second boot, with the same state and
profile, the runner minted and typed a second invite instead of waiting for the stored-token
reconnect. Find the race, reproduce it, and fix it in the right place. Fix the product code if a
real headless agent restarting under load could also re-pair needlessly. Fix only the test or
harness if the race exists only in the harness. This is a diagnose-first task: the hypothesis
below is a lead, not a conclusion.

## Context
- Evidence: CI run 38940675607 (PR #180, plan-only files) failed at app.test.ts:227,
  `expect(launcher.typedCodes).toHaveLength(1)`, with
  `['V29W-VP4Y-8X4F', '9GJH-PZ5H-4YYB']`. The same test passed on `main` CI four times the
  same day.
- gateway/test/headless/app.test.ts:203-235 — the test. Both boots share `state`, `launcher`
  and `linkPort`.
- gateway/test/headless/app.test.ts:64-74 — the `boot` helper sets `linkGraceMs: 50` (also
  :280-291 in a second helper). **Leading hypothesis:** the stored-token reconnect goes over real
  sockets (fake page → gateway link WS → pairing-token handshake → registry), and under CI load
  it takes longer than 50 ms. The runner then gives up and mints an invite.
- gateway/src/headless/runner.ts:13-14 — `LINK_GRACE_MS = 15_000`, the production default.
- gateway/src/headless/runner.ts:359 — the poll path calls `ensureLinked()` when not linked.
- gateway/src/headless/runner.ts:455-479 — `waitLinked` polls `isLinked` in steps of
  `min(250, ms)`. `ensureLinked` mints once the grace window has elapsed.
- gateway/src/app.ts:593-596 — `isLinked`: the registry has an open connection for
  [world, user]. Read-only context; app.ts is not owned here.
- gateway/test/headless/fake-browser.ts:19-52 — the fake module stores its token per profile.
  :127-129: it connects with the stored token inside `waitForGameReady`, before `ensureLinked`
  starts its clock.
- Questions to settle with evidence: Does the grace window start only after the page is
  game-ready (runner.ts:441 vs :359)? In production, can a stored-token reconnect take longer
  than 15 s, for example after a slow Foundry ready? Could a link that is closing or not yet
  registered make `isLinked` false while a token connect is in flight? If so, that is a
  product race regardless of the grace length.
- Memory guard: run loops sequentially and kill only your own PIDs. Never `pkill` by name,
  because other sessions build on this host.

## Acceptance
- [ ] The root cause is named in the PR/commit body with `file:line` citations. The body states
      "product race" or "harness artifact" and gives the evidence for that verdict: timings,
      a trace, or a reasoned argument from the code.
- [ ] Before the fix, a reproduction loop runs only this test (for example
      `npx vitest run --project gateway gateway/test/headless/app.test.ts -t "reconnects with the stored token"`
      in a shell loop, or `--repeat`) at least 200 times under CPU load, such as a parallel
      `stress-ng`/busy loop that you start and kill by its own PID. The failure rate is recorded
      as k/N in the commit body. If the failure cannot be reproduced at N >= 200, raise the load
      and record that too.
- [ ] After the fix, the same loop under the same load reaches 0 failures in N, with N >= 200
      and stated in the commit body.
- [ ] If the verdict is "product race": the runner change has a unit test in
      gateway/test/headless/runner.test.ts that fails on the old code. A slow stored-token
      reconnect, inside the production grace window, must not mint an invite.
- [ ] If the verdict is "harness artifact": `LINK_GRACE_MS` and the runner's mint logic are
      unchanged. Only files under gateway/test/headless/** change.
- [ ] The test still asserts exactly one typed code across both boots, no "minted an invite" on
      the second boot, and one active pairing for U. Do not weaken these assertions.
- [ ] `npx vitest run --project gateway gateway/test/headless` passes.
- [ ] `npm run verify` passes.

## Out of scope
- gateway/src/app.ts and the link registry. If the fix needs them, stop and report.
- Other flaky tests seen in the same CI runs.
- Changing `PAIR_WAIT_MS`, `REPLACED_PAUSE_MS` or the poll cadence, unless they turn out to be
  the root cause.
- CI workflow changes (task 145 owns PR CI).
