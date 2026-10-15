# 101 — Retry the conformance inspector calls on the gateway's per-client 429

**Repo:** .
**Depends on:** none
**Status:** Planned 2026-10-15. Found during the 0.3.0 release attempt on the Mac test bed: `npm run test:conformance` (release gate 3) fails there and passes on Linux. The cause was confirmed at 144d24a with temporary instrumentation (since reverted). With `sleep 1.1` between the two OAuth inspector calls, the run passed twice in a row on the Mac. This blocks cutting 0.3.0. When done, the scribe records PLAN, HISTORY and the index, and archives this file in `docs/plan/done/`, as for 99 and 100.
**Owns:**
- scripts/conformance.sh (only `inspect_http`, `inspect_oauth` and the calls that use them; sourcing the new helper)
- scripts/lib/inspector-retry.sh (new: the retry helper)
- scripts/test/conformance-retry.test.mjs (new)

## Goal
`scripts/conformance.sh` passes reliably on fast machines. Today the OAuth phase can trip the public gateway's per-client rate limit, because the inspector calls land in a single one-second window. The script retries an inspector call when, and only when, the gateway refused it with its 429 `too many requests`. The gateway limiter stays exactly as it is.

## Context
- gateway/src/http/limits.ts:4: `PUBLIC_CLIENT_RPS = 10`. limits.ts:79-102: `RateWindows` is a fixed 1 s window per client key that starts at the first request, so a request made 1 s or more after the window opened gets a fresh window.
- gateway/src/http/server.ts:336-339: on a public-mode gateway, authenticated `/mcp` requests over the limit get `429` with plain-text body `too many requests` and `retry-after: 1`. They are refused before any handler runs, so a refused `tools/call` never executed. server.ts:340-342: the global `rateLimited()` returns the same body.
- scripts/conformance.sh:126-133: `inspect_oauth` runs `npx @modelcontextprotocol/inspector@2.10.1 --cli` twice. `tools/list` sends 5 `/mcp` requests and `tools/call` sends 6, all from 127.0.0.1. On the Mac, npx starts in about 0.6 s, so the 11th request is refused. The inspector then reports `Error POSTing to endpoint: too many requests` and exits non-zero. Under `set -euo pipefail` (conformance.sh:7), that aborts the script.
- scripts/conformance.sh:84-91: `inspect_http` (local `--http` mode) has the same shape. The per-client limiter does not apply there (it is not public), but the global limiter could, so it uses the same helper.
- scripts/conformance.sh:19-31: `cleanup` dumps `gateway.log` on failure. Both functions currently append the inspector's stderr to `$work/gateway.log`. Keep that, so a real failure still shows the inspector's error.
- package.json:23: `test:scripts` is `node --test scripts/test/*.test.mjs`. scripts/test/release.test.mjs shows the house pattern: stub commands on a temp `PATH`, run the script with `spawnSync`, then assert on its output.

## Decisions
- **Retry, not a fixed pause.** A `sleep 1.1` between the calls encodes today's request count: a third inspector call, or an inspector upgrade that sends more requests per call, would trip the limit again. A retry on the 429 signature costs nothing when no 429 happens, so Linux runs are not slowed. It also covers the `inspect_http` path and any call added later.
- **The helper.** `scripts/lib/inspector-retry.sh` defines one bash function, for example `retry_429 <log> <cmd...>`. It runs the command with stdout captured and stderr captured to a per-attempt temp file. When the command succeeds, it prints the captured stdout and appends the stderr to `<log>`. When the command fails, it checks the attempt's stdout and stderr for the literal `too many requests`. If the text is there and attempts remain, it appends one line `conformance: 429 from gateway, retrying in <s>s (attempt <n>/<max>)` to `<log>` and to stderr, sleeps, and tries again. Otherwise it appends the stderr to `<log>`, prints the stdout, and returns the command's exit status.
- **Limits.** At most 4 attempts in total. The backoff is `CONFORMANCE_429_BACKOFF` seconds, default `1.1`, the same before each retry. The env override exists only so the test runs fast. The default must be at least 1.1.
- **Only the 429 signature.** A non-zero exit without `too many requests` in its output is returned at once, with no retry. A zero exit is never retried, whatever its output says. After the last attempt, the 429 failure is returned like any other failure.
- **Wiring.** conformance.sh sources the helper by a path relative to the repo root. The script already `cd`s there at :8. `inspect_http` and `inspect_oauth` call through `retry_429 "$work/gateway.log" npx ...`. Each `"$(...)"` caller and its `grep` check stay as they are. The stdio `inspect` (:47-53) is not changed: it starts its own gateway and goes through no HTTP limiter.

## Amendment 1
Amended 2026-10-15 on an implementer finding. One inspector call sends 5-6 `/mcp` requests inside a single 1 s window. Any `PUBLIC_CLIENT_RPS` of 5 or less therefore makes every attempt fail, and on Linux a value of 6-7 never trips at all, because npx startup spans the window. On Linux, no limit value produces a pass-after-retry, so the original mutation criterion ("still passes, with at least one `retrying` line") could not be met. The criterion now requires only that the retry attempt lines appear against the real inspector output, and a final failure of the mutated run is acceptable.

The pass-after-retry proof is the Mac release re-run (release gate 3), where the original failure reproduced. That is a verification step outside this task: the orchestrator runs it after merge, as already stated under Out of scope.

## Acceptance
- [ ] `scripts/test/conformance-retry.test.mjs` sources `scripts/lib/inspector-retry.sh` in `bash -c` with `CONFORMANCE_429_BACKOFF=0`. It runs `retry_429` against a stub command that counts its calls in a temp file, and checks each of these:
  - (a) The stub fails twice with `Error POSTing to endpoint: too many requests` on stderr, then succeeds and prints `ok`. Then `retry_429` exits 0, prints `ok`, the stub ran 3 times, and the log has two `retrying` lines.
  - (b) The stub always fails with `too many requests`. Then `retry_429` exits non-zero and the stub ran exactly 4 times.
  - (c) The stub fails with `Error POSTing to endpoint: unauthorized`. Then `retry_429` exits non-zero, the stub ran exactly once, and the log contains `unauthorized`.
  - (d) The stub exits 0 and prints `too many requests` on stdout. Then the stub ran exactly once.
- [ ] On current `main` the new test file fails because the helper does not exist. With the change, `npm run test:scripts` passes. The 20 "zip is not installed" failures known on homelab (PLAN item 40) count as pre-existing, if `zip` is still missing there; any other failure does not.
- [ ] `rg -n 'retry_429' scripts/conformance.sh` shows the `source` line and exactly two call sites, inside `inspect_http` and `inspect_oauth`.
- [ ] `grep -n 'CONFORMANCE_429_BACKOFF:-1.1' scripts/lib/inspector-retry.sh` matches, so the default backoff is 1.1 s.
- [ ] After `npm run build`, `npm run test:conformance` passes on homelab and prints `conformance: ok (inspector 2.10.1, stdio, http, oauth)`.
- [ ] Mutation check (reworded by Amendment 1), run once and reported in the PR, then reverted: with `PUBLIC_CLIENT_RPS` temporarily lowered in `gateway/src/http/limits.ts` (for example to `3`) and the gateway rebuilt, `npm run test:conformance` shows the helper's attempt lines `(attempt 2/4)`, `(attempt 3/4)` and `(attempt 4/4)` against the real inspector output. This proves the 429 signature is matched on the real stream. A final failure of that mutated run is acceptable. Afterwards `limits.ts` is restored (`git diff main -- gateway/src/` is empty) and `dist` is rebuilt with `npm run build`.
- [ ] `bash -n scripts/conformance.sh scripts/lib/inspector-retry.sh` passes. If `shellcheck` is installed, it reports nothing new on either file.
- [ ] `git diff --stat main` touches only the three Owns paths, and nothing under `gateway/src/`.

## Out of scope
- Anything under `gateway/src/`, including `PUBLIC_CLIENT_RPS`, `RateWindows` and the 429 responses. The limiter is intentional.
- The stdio `inspect` function, the OAuth flow client (`gateway/test/conformance/oauth-flow.mjs`), the fake module, and the inspector version pin.
- The conformance output line, and `scripts/release.mjs` and its tests (task 99).
- Docs. Neither `docs/testing.md` nor `docs/releasing.md` describes the conformance phases. `docs/compatibility.md` does, but it is not changed here. The scribe may add a sentence about the retry to it when recording.
- Re-running the 0.3.0 release, or running conformance on the Mac. The orchestrator does that after merge.
- The pre-existing e2e-unit hygiene failure on `scripts/conformance.sh` (PLAN item A7d).

## Review round 1 — findings

Reviewed HEAD: see `git log main..HEAD` at round start.

- [STYLE] scripts/test/conformance-retry.test.mjs:22: the `writeFileSync(stub, ...)` line is longer than Prettier's `printWidth: 100`, so `prettier --check` flags the file. Run `prettier --write` on it. (route: implementer; rule: docs/conventions.md Prettier, .prettierrc printWidth 100)
- [STYLE] scripts/test/conformance-retry.test.mjs:18: the test uses `spawnSync('mkdir', ['-p', dir])`. Use `mkdirSync(dir, { recursive: true })` from `node:fs`, as scripts/test/release.test.mjs:79-82 does. (route: implementer)
- [NOTE, optional, no change needed] scripts/lib/inspector-retry.sh:11-19: a retry re-runs the whole inspector call. This is harmless for demo-echo and is the contract the task's Decisions chose.

## Attempt 1 — failed

Verify at 9428f00: tester PASS (verify, test:scripts 117/0/3, test:conformance ok, prettier clean). Reviewer returned REQUEST CHANGES:
- scripts/conformance.sh:86: `shellcheck scripts/conformance.sh` reports a new SC1091 finding (info, "Not following: scripts/lib/inspector-retry.sh"). That breaks the "shellcheck reports nothing new" criterion. Fix: add `# shellcheck source=scripts/lib/inspector-retry.sh` on the line above the source line, and check that shellcheck on conformance.sh reports 0 findings, the same as main. (Run it from the repo root or add `-x` as needed so the directive resolves.)
