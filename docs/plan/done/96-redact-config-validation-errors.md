# 96 — Redact secrets from config and CLI validation errors

**Repo:** .
**Depends on:** 37
**Status:** Planned 2026-10-15. A follow-up from task 37's review round 11 and Amendment 5. Start after 37 merges, because both touch gateway/src/config/index.ts.
**Owns:**
- gateway/src/config/index.ts (the error messages of `normalizePublicUrl` and `normalizeLinkUrl` only, plus any other `ConfigError` message the sweep below finds echoing input; no validation logic changes)
- gateway/src/bin/** (validation error messages the sweep finds echoing input only, e.g. `normalizeOrigins` in cli.ts)
- gateway/test/config/exposure.test.ts (the `--public-url` cases only; insertions only)
- gateway/test/config/consent-links.test.ts (insertions only)
- gateway/test/config/redaction.test.ts (new)
- gateway/test/bin/link-conflict.test.ts (the `--allow-origin validation` cases only; insertions only)

## Goal
No config or CLI validation error may echo a value that could carry a secret. Today
`normalizePublicUrl` puts the whole rejected value into its error, including any `user:pass@`, and
`normalizeLinkUrl` puts in its first 80 characters. Both end up on stderr and in logs. Leave the value
out of the message, or show only a redacted form with no userinfo and no query string.

## Context
- gateway/src/config/index.ts:~97 `normalizePublicUrl`: `Invalid --public-url ${value}: ${why}`. This echoes the full value, credentials included, even in the "it must not carry credentials" branch.
- gateway/src/config/index.ts:~145 `normalizeLinkUrl`: `Invalid ${flag} ${value.slice(0, 80)}: ${why}`.
- gateway/src/config/index.ts:~120 `normalizeFoundryUrl`, already fixed in task 37: "value not shown, it may carry a secret". Follow this pattern.
- gateway/src/config/index.ts `readConfigFile`: task 37 Amendment 5 already removes the `JSON.parse` snippet. Do not redo it.
- gateway/src/config/index.ts `loadConfig`: `z.prettifyError(result.error)`. Check whether zod puts received values into the message for any field that could hold a secret.
- gateway/src/bin/cli.ts:~95-112 `normalizeOrigins`: `Invalid --allow-origin value: ${v}` on stderr.
- docs/plan/done/37-headless-runner.md, "Review round 11" [P3] and Amendment 5: the source of this task.

## Decisions
- (a) **Sweep, don't patch spot by spot.** Check every `ConfigError` and every CLI validation error written to stderr in gateway/src/config and gateway/src/bin for echoed input that could carry a secret: URLs (userinfo, query), passwords, tokens and file contents. Fix each one you find. List every site in the PR, with fixed or "no echo, left as is" for each.
- (b) **What may stay in a message:** the flag or key name, the reason, and for URLs at most the scheme and host. Never userinfo, a query string, or a value from a field that holds a secret. A file path the operator gave may stay.
- (c) Messages only. What is accepted and what is refused does not change, and exit codes stay as they are.

## Acceptance
- [ ] `normalizePublicUrl('https://agent:hunter2@gw.example.com')` throws a `ConfigError` whose message contains neither `agent` nor `hunter2` (test). The same holds for an input refused for another reason that also carries credentials, e.g. `http://agent:hunter2@gw.example.com/path` (test).
- [ ] `normalizeLinkUrl` for both `--privacy-url` and `--source-url`, with `http://agent:hunter2@example.org/privacy` (refused: http on a non-loopback host) and `https://agent:hunter2@example.org/privacy` (refused: credentials), throws messages that contain neither `agent` nor `hunter2` (tests).
- [ ] Every other echo site the sweep finds gets a test with a credential-bearing input whose error contains neither the user nor the password. For `--allow-origin` this is an input such as `ftp://agent:hunter2@foundry.local` run through the built CLI, and stderr contains neither (test).
- [ ] The PR lists each `ConfigError` and CLI validation error site in gateway/src/config and gateway/src/bin, with the outcome for each.
- [ ] The existing tests that assert a message names its flag (e.g. exposure.test.ts `toContain('--public-url')`) still pass.
- [ ] `npm run verify` passes.

## Out of scope
- `readConfigFile`'s JSON parse message (task 37 Amendment 5).
- `normalizeFoundryUrl` (already fixed in 37).
- Changing what any validator accepts or refuses, or its exit code.
- Redacting runtime log lines that are not config or CLI validation errors (e.g. `safeText` call sites).
- Docs (43).

## Review round 1 — findings
Reviewed HEAD: 96e4baa (code review CLEAN apart from this item).

- [P3] gateway/test/config/redaction.test.ts:47-60: the "schema errors carry no secret" test never checks that `loadConfig` threw. If an input stopped failing, `msg` would stay `''` and the test would pass vacuously. Assert a `ConfigError` with a non-empty message for each input (`linkPort`, `logLevel` and `httpPort` set to `'hunter2'`), reusing the file's `message()` helper.
  route: implementer

Orchestrator scope notes (round 1):
- Accepted: the edited assertion in gateway/test/bin/link-conflict.test.ts ("exits 2 naming ${bad}", :132,141). Owns says insertions only, but the old assertion required the echoed value, which directly contradicts this task's Goal and Decision (b). It now checks the flag name and the reason hint instead.
- For the record: docs/plan/done/75-consent-page-footer.md:42 quotes the old message format `Invalid --privacy-url <value>: <why>`. It is a historical record, so it is left as it is.

## Review round 2 — findings (external)
Andrew's PR review of #154 at 5212ced (2026-10-15).

- [P3] gateway/src/config/index.ts:313: the `--link-host`/`--http-host` refusal ("Refusing --link-host/--http-host <host>…") echoes the value. Given a credential-bearing URL such as `https://agent:hunter2@foundry.local/?token=x`, it prints the credentials and the query string. Our sweep wrongly treated this site as safe ("a host address, not a secret"). That assumed the input is a valid host, when it is whatever the operator typed. Leave the value out of the message and keep the flag name and the reason. Add regression tests for both flags, asserting the message contains neither `hunter2` nor the query, and still names the flag.
  - Whole class: re-sweep every validation and refusal message in gateway/src/config and gateway/src/bin that interpolates operator input, and drop the assumption that the input has the expected shape. Fix any other site that echoes raw input before it has been validated as safe: agent names already checked against AGENT_NAME and the config file path are fine. List each site and its outcome in the commit message.
  route: implementer
