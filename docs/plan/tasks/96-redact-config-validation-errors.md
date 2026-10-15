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
