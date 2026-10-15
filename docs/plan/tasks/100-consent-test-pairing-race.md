# 100 — Pair sequentially in the headless consent tests and make a lost pairing race fail fast

**Repo:** .
**Depends on:** none
**Status:** Planned 2026-10-15. Root cause found on the Mac test bed (Node 24.19, macOS). The 0.3.0 release stopped at `verify` because two tests in `gateway/test/oauth/consent/headless.test.ts` hit the 5000 ms timeout. They pass in about 50-180 ms on Linux. Pairing sequentially was verified on the Mac and then reverted: 5 full-file runs out of 5 passed 10/10.
**Owns:**
- gateway/test/oauth/consent/headless.test.ts (only the two concurrent `Promise.all(... pairModule ...)` pairings at ~:152 and ~:168)
- gateway/test/link/helpers.ts (only `TestClient.next`, plus whatever close/reject bookkeeping in `TestClient` it needs)
- gateway/test/routing/harness.ts (only `pairModule`'s handling of a `reject` frame)
- gateway/test/link/test-client.test.ts (new: the fail-fast tests)

## Goal
The two headless consent tests pair their modules one at a time, so they no longer race for the single live pairing code. The test harness also stops turning a lost pairing race into a 5 s hang. `TestClient.next(type)` rejects with a clear error once the socket is closed and no buffered message matches, and `pairModule` throws when the gateway answers its hello with `reject`. A future race then fails fast and names its cause.

## Context
- gateway/src/link/pairing-codes.ts:36-90: `PairingCodes` holds at most one live single-use code. `issue()`/`generate()` return the same live code until a hello spends it. Concurrent `pairModule` calls can therefore send the same code: the first pairs, the others get `{"type":"reject","code":"PAIRING_INVALID"}` and are closed.
- gateway/test/oauth/consent/headless.test.ts:147-161 ("sends nothing for no owner, an offline owner, or the flag agent, and no code works") and :163-190 ("answers identically for every kind of target, on send and on a wrong code") both pair through `Promise.all([...].map((u) => pairModule(r!.h, u)))`. The rest of each test depends on `mods` keeping the input order.
- gateway/test/link/helpers.ts:43-57: `TestClient` buffers messages, sets `closed` on close, and wakes waiters on both. gateway/test/link/helpers.ts:79-85: `next(type)` loops forever until a matching message is buffered, and ignores `closed`. :87-89: `untilClosed()`.
- gateway/test/routing/harness.ts:72-95: `pairModule` sends a hello with `h.codes.generate()` and awaits `tc.next('welcome')`.
- gateway/test/conformance/fake-module.ts:87: an existing fake already fails with `pairing rejected` on a `reject` frame. Follow that wording.
- Sweep on aa57cad: `grep -rnA3 "Promise.all" gateway/test` finds no other concurrent pairing through `pairModule` or the shared code. `status-pairing-state.test.ts:12,35` uses `Promise.all` for closing clients and connecting MCP transports, not for pairing. The implementer re-runs the sweep (including `Promise.all` spanning several lines and `.map(async` loops over pair helpers) and reports the result in the PR.
- Callers that read a `reject` and then the close: gateway/test/link/invites-app.test.ts:109-113, gateway/test/link/public.test.ts:73, gateway/test/bin/admin-cli.test.ts:138, gateway/test/offline-queue/integration.test.ts:206 call `next()` with no type and expect the buffered `reject`. They must keep working: a buffered match is still returned after close.

## Decisions
- **Sequential pairing, same order.** Replace each `Promise.all(map(pairModule))` with a `for ... of` loop that pushes into an array in the same order. Nothing else in either test changes.
- **`next` after close.** When `closed` is true and no buffered message matches `type`, `next` rejects at once. The error message names the awaited type (or `any`) and the types of the messages still buffered, for example `TestClient.next('welcome'): socket closed; buffered: [reject]`. A buffered match is still returned first, even after close. A `next()` that is already waiting when the close arrives rejects the same way.
- **`pairModule` on reject.** If the gateway answers the hello with `reject`, `pairModule` throws `pairing rejected: <code>` and does not wait for `welcome`. How it waits for either frame (for example a small `nextOf(['welcome','reject'])` on `TestClient`, or checking the buffer after `next` rejects) is up to the implementer, inside the Owns above.
- **Check existing callers first.** Before changing `next`, the implementer greps every `.next(` in `gateway/test` (about 260 calls) for one that awaits a message after the socket has closed and expects it to keep waiting. If one exists, it is listed in the PR and kept working without editing its file. If that cannot be done, stop and report.

## Acceptance
- [ ] `gateway/test/link/test-client.test.ts` has a test that connects two `TestClient`s, sends both a hello with the same `h.codes.generate()` code, and checks that the loser's `next('welcome')` rejects with an error mentioning `closed` and `reject` within 1000 ms (asserted with a measured elapsed time or a `Promise.race` against a 1000 ms timer). On current `main` this test fails by timing out.
- [ ] A test in the same file checks that `pairModule` called with a code that has already been spent rejects with `pairing rejected: PAIRING_INVALID` within 1000 ms. On current `main` this test fails by timing out.
- [ ] A test in the same file checks that `next()` with no type still returns a buffered `reject` after the socket has closed, as invites-app.test.ts:109-113 relies on.
- [ ] `gateway/test/oauth/consent/headless.test.ts` has no `Promise.all` around `pairModule`. `grep -rnE "Promise\.all\(" gateway/test` followed by a check of each hit shows no concurrent pairing through the shared code anywhere in `gateway/test`.
- [ ] `npx vitest run test/oauth/consent` in `gateway/` passes 5 consecutive runs (for example `for i in 1 2 3 4 5; do npx vitest run test/oauth/consent || exit 1; done`).
- [ ] `npm test` in `gateway/` passes.
- [ ] `git diff --stat main` touches only the four Owns paths, and nothing under `gateway/src/`.

## Out of scope
- Product code, including `gateway/src/link/pairing-codes.ts`. One live single-use code is the intended design.
- Any other part of `TestClient` or the routing harness: `reconnectModule`, `untilClosed`, `connect`, timeouts.
- Other tests in headless.test.ts, and other test files that call `next()`. If a caller breaks under the new `next`, report it; do not edit its file.
- The release script and its docs (task 99: `scripts/release.mjs`, `scripts/test/release.test.mjs`, `docs/releasing.md`, `docs/testing.md`).
- Re-running the 0.3.0 release, or vitest timeout settings.
