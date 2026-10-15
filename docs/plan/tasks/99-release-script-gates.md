# 99 — Fix the release script's conformance line check and give the v13 e2e gate its own environment

**Repo:** .
**Depends on:** none
**Status:** Planned 2026-10-15. Found during the 0.3.0 release attempt on the Mac test bed, which stopped at `verify` for an unrelated test hang. Both bugs would stop or mislead every release, so this lands before the next attempt. Andrew decided (2026-10-15) to set up v13 on the Mac rather than release with `--allow-missing-v13`.
**Owns:**
- scripts/release.mjs (only the `test:conformance` output check, the two e2e gates and the code that resolves and prints their environment; the summary's `v13 e2e:` line may gain the URL)
- scripts/test/release.test.mjs (updates to the `OK` constant, the npm stub and the conformance test; new tests for the two behaviours below)
- docs/releasing.md (only the step 3 gate description lines about conformance and the two e2e gates)
- docs/testing.md (only the "Testing v13 separately" section)

## Goal
`scripts/release.mjs` accepts the conformance line that `scripts/conformance.sh` actually prints since task 40 added the oauth mode. It also runs the v13 e2e gate against the v13 URL and a v13-only state directory, so v13 never reuses v14's pairings and browser profiles. `docs/testing.md` gives the exact one-time v13 setup for a release machine, so the gate can pass instead of being skipped.

## Context
- scripts/release.mjs:79-81: the conformance check is `/^conformance: ok \(inspector [^)\s,]+, stdio, http\)$/m`.
- scripts/conformance.sh:136: prints `conformance: ok (inspector $INSPECTOR_VERSION, stdio, http, oauth)`. Task 40 added the oauth mode, but release.mjs was outside 40's Owns and nobody updated the check, so every release fails this gate.
- scripts/release.mjs:82-93: both e2e gates call `run('npm', ...)` with the same inherited environment. The v13 SKIP / `--allow-missing-v13` handling is at 89-92, and the summary line is at 209.
- e2e/lib/config.ts:39-57 (`e2ePaths`): the state dir is `AGENT_GATEWAY_E2E_STATE_DIR` from the **process environment only**. test.env does not affect it. An empty value is a ConfigError, and the default is `~/.config/agent-gateway/e2e`. `test.env` is always `~/.config/agent-gateway/test.env`, whatever the state dir.
- e2e/lib/config.ts:66-78 (`parseEnvFile`): `KEY=value` lines; `#` comments, blank lines, an `export ` prefix and matching quotes are tolerated. The release script must parse test.env the same way. It is plain `.mjs` and cannot import the TS, so write a small local copy.
- e2e/lib/config.ts:88-96, 148: `AGENT_GATEWAY_E2E_V13_URL` and `FOUNDRY_URL` are read from the environment first, then test.env. An empty value counts as unset, and trailing slashes are stripped. `FOUNDRY_URL` defaults to `https://foundry.local`.
- e2e/lib/target.ts: `--foundry v13` swaps in the v13 URL, or prints `V13_SKIP_MESSAGE` and exits 0 when the URL is unset.
- docs/testing.md:76-78: says v13 needs `AGENT_GATEWAY_E2E_V13_URL` and a separate `AGENT_GATEWAY_E2E_STATE_DIR` (for example `~/.config/agent-gateway/e2e-v13`) for setup, seed and runs. docs/testing.md:36-41 covers setup/seed commands, `--only`, `--player2`, the fresh-world order, and the rule that pairing codes are typed only by a human.
- docs/releasing.md:19-22: already documents the `, oauth` line, so only the e2e lines change there.
- scripts/test/release.test.mjs:39-56 (npm stub), 104 (`OK`), 106-118 (`release()` sets `HOME` to a temp dir, so test.env lookups in tests never touch the real home), 150-158 (conformance test), 188-200 (gate order test, which filters log lines starting `npm run`).
- v13 test bed (Andrew, 2026-10-15): `https://foundry13.local`, Foundry 13.351, pf2e 7.12.2, world `test-world`.

## Decisions
- **Require `, oauth`.** The check becomes `/^conformance: ok \(inspector [^)\s,]+, stdio, http, oauth\)$/m`. The old line without `, oauth` is rejected: it means the oauth mode did not run, and passing it would hide the very regression this gate is for. The same reasoning made the current check reject a line without `http`.
- **Where the script gets v13's settings.** It resolves `AGENT_GATEWAY_E2E_V13_URL` and a new `AGENT_GATEWAY_E2E_V13_STATE_DIR` from the environment first, then from `~/.config/agent-gateway/test.env` (`os.homedir()`), with the harness's precedence rules: environment wins, an empty value counts as unset, trailing slashes are stripped from the URL. `AGENT_GATEWAY_E2E_V13_STATE_DIR` defaults to `~/.config/agent-gateway/e2e-v13`. A leading `~/` is expanded against the home directory. A value that is still relative after expansion stops the release before any gate, with `AGENT_GATEWAY_E2E_V13_STATE_DIR must be an absolute path`. Recommended because a release machine then needs only two lines in test.env and no shell exports. The new key is read only by the release script; the harness keeps reading only `AGENT_GATEWAY_E2E_STATE_DIR`.
- **What each gate receives.** The v13 gate runs with the inherited environment plus `AGENT_GATEWAY_E2E_STATE_DIR=<v13 state dir>`, plus `AGENT_GATEWAY_E2E_V13_URL=<resolved URL>` when one was resolved. The v14 gate runs with the inherited environment unchanged, so an operator's own `AGENT_GATEWAY_E2E_STATE_DIR` still applies to v14, and otherwise the harness default does. The v14 state dir is either the inherited `AGENT_GATEWAY_E2E_STATE_DIR` or `~/.config/agent-gateway/e2e`. If it resolves to the same path as the v13 state dir (`path.resolve` equality), the release stops before any gate with `v14 and v13 e2e state directories are the same: <dir>`.
- **No URL means SKIP, as today.** When no v13 URL is resolved, the script still runs the v13 gate. The harness prints `V13_SKIP_MESSAGE`, and the existing abort / `--allow-missing-v13` behaviour applies unchanged. The script does not check that the v13 state directory exists: the harness already fails with `run npm run test:e2e:setup`.
- **Print what each gate used.** Before each e2e gate, print one line: `e2e v14: url <FOUNDRY_URL or https://foundry.local>, state <dir>` and `e2e v13: url <url or "not set">, state <dir>`. The v14 URL comes from the environment, then test.env, then the default. Print URLs and paths only, never a password or any other test.env value. The summary's `v13 e2e:` line also names the URL when the gate passed.
- **No change to the e2e harness.** Everything above is plumbing in the release script, so `e2e/**` and `scripts/e2e.sh` are untouched.

## Acceptance
- [ ] On current `main`, `node --test scripts/test/release.test.mjs` fails the new tests in the next three items. With the change, `npm run test:scripts` passes.
- [ ] A test runs the release with `CONFORMANCE_OUT='conformance: ok (inspector 2.10.1, stdio, http, oauth)'` and checks that the conformance gate passes and both e2e gates run. Another test with `'conformance: ok (inspector 2.10.1, stdio, http)'` checks that the release exits non-zero with `gate failed: test:conformance` on stderr and no `gh release` in the stub log. The `OK` constant in release.test.mjs carries `, oauth`, and the existing `stdio`-only rejection test still passes.
- [ ] The npm stub appends one line per e2e call that does not start with `npm run`, for example `env <args>: STATE_DIR=<value or -> V13_URL=<value or ->`. A test with `HOME/.config/agent-gateway/test.env` containing `AGENT_GATEWAY_E2E_V13_URL=https://foundry13.local/` and no state-dir keys checks that the v13 call saw `STATE_DIR=<HOME>/.config/agent-gateway/e2e-v13` and `V13_URL=https://foundry13.local`, and that the v14 call saw `STATE_DIR=-`.
- [ ] A test with `AGENT_GATEWAY_E2E_V13_STATE_DIR=<tmp>/v13` in the environment and a different value in test.env checks that the v13 call saw the environment value.
- [ ] A test with `AGENT_GATEWAY_E2E_STATE_DIR` and `AGENT_GATEWAY_E2E_V13_STATE_DIR` set to the same path checks that the release exits non-zero with `state directories are the same` on stderr and no `npm run test:e2e` in the stub log.
- [ ] A test checks that stdout has `e2e v14: url https://foundry.local, state <HOME>/.config/agent-gateway/e2e` and `e2e v13: url https://foundry13.local, state <HOME>/.config/agent-gateway/e2e-v13`. With `FOUNDRY_GM_PASSWORD=sekret` in test.env, it checks that `sekret` appears nowhere in stdout or stderr.
- [ ] The existing gate-order, v13 SKIP / `--allow-missing-v13` and unrelated-SKIP tests pass unchanged, apart from the `OK` constant.
- [ ] `docs/releasing.md` step 3 says the v13 gate uses `AGENT_GATEWAY_E2E_V13_URL` and `AGENT_GATEWAY_E2E_V13_STATE_DIR` (default `~/.config/agent-gateway/e2e-v13`), read from the environment or test.env, and that the script prints each gate's URL and state dir. The conformance line text is unchanged.
- [ ] `docs/testing.md` "Testing v13 separately" has a numbered one-time setup for a release machine using `https://foundry13.local` (Foundry 13.351, pf2e 7.12.2, world `test-world`):
  1. Add `AGENT_GATEWAY_E2E_V13_URL=https://foundry13.local` to test.env.
  2. Pair the GM: `FOUNDRY_URL=https://foundry13.local AGENT_GATEWAY_E2E_STATE_DIR=~/.config/agent-gateway/e2e-v13 npm run test:e2e:setup -- --only dev-gm`. Pairing codes are typed by a human.
  3. Seed with the same two variables, with Andrew's consent.
  4. Pair the players with `--only` and `--player2`, using the world's exact user names.
  5. Run `AGENT_GATEWAY_E2E_STATE_DIR=~/.config/agent-gateway/e2e-v13 npm run test:e2e -- --foundry v13`.
  6. Note that the release script sets the state dir for v13 itself.

  The section also names `AGENT_GATEWAY_E2E_V13_STATE_DIR` as a release-script-only key.
- [ ] `git diff --stat main` touches only the four Owns paths.

## Out of scope
- The e2e harness (`e2e/**`, `scripts/e2e.sh`), including teaching it `AGENT_GATEWAY_E2E_V13_STATE_DIR` or `--foundry` for setup/seed.
- `scripts/conformance.sh` and its output format.
- The other release gates, artefacts, the Quench gate and the remote-OAuth gate (41), and the "Quench and remote OAuth conformance are not gates yet" sentence in docs/releasing.md.
- The test hang that stopped `verify` during the 0.3.0 attempt.
- Doing the v13 setup on the Mac, which needs Andrew to type the pairing codes and consent to the seed.
- The test.env key table in docs/testing.md outside "Testing v13 separately".

Orchestrator scope note (implementation): accepted. scripts/test/docker-release.test.mjs (~:41) has its own npm stub that echoes the old conformance line `conformance: ok (inspector 2.10.1, stdio, http)`, so the new `, oauth` requirement breaks two of its tests. Add `, oauth` to that stub's echo, and change nothing else in that file. The change is forced by decision (a).

## Review round 1 — findings
Reviewed HEAD: d0a1403 (code review CLEAN; regex and v13-env fixes mutation-proven).

- [P3] scripts/release.mjs:117-120: the `e2e v14: url …, state …` line prints before the `== gate: e2e v14 ==` header, while v13's prints after its own. Print each gate's line after its header, for example from `gate()`.
  route: implementer
- [P3] scripts/release.mjs:68-69: e2e URLs are printed as given, so a URL with userinfo (`https://user:pw@host`) would print its credentials in the e2e lines and the v13 summary. This is the same class task 96 removed. Strip any userinfo (and query) from every URL the script prints; show only scheme://host[:port]/path. Add a test with a credentialed URL in test.env and in env, asserting neither the user nor the password appears in the output.
  route: implementer

## Review round 2 — findings
Reviewed HEAD: 8d27df2. Round 1 log order is FIXED. The credentials fix covers both gate lines but not the summary.

- [P2] scripts/release.mjs:266: the summary still prints the raw v13 URL (`passed (${v13Url})`), so credentials, query and fragment leak on any run past the draft prompt. Print `shown(v13Url)` there. Change the credentialed-URL test (scripts/test/release.test.mjs ~:300) so the run reaches the summary (answer `yes`, or add a second run that does), and assert none of the user, password, query or fragment appears anywhere in stdout. It must fail on 8d27df2. Also check that no other printed line uses a raw URL.
  route: implementer
