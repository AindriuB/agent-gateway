# 40 — Add the OAuth conformance mode and the remote client rows

**Repo:** .
**Depends on:** 35, 67
**Status:** MVP B wave 4, after the friend-test milestone. Amended 2026-10-14 in the MVP B re-plan: the stdio and local HTTP items that 63 and 34 already met are removed. What is left is the OAuth mode and the remote rows.
**Owns:**
- scripts/conformance.sh (a new OAuth mode section only; the stdio and HTTP sections stay as they are)
- gateway/test/conformance/** (new files, plus insertions in fake-module.ts so it can answer 67's consent-code message)
- docs/compatibility.md (the OAuth column and the claude.ai, ChatGPT, Gemini CLI and Gemini app rows and checklists only)

## Goal
Automate what can be automated for remote clients. Run MCP Inspector's CLI against a gateway started with `--public-url`, through the OAuth flow with the consent step approved automatically by the fake module. Keep a manual checklist for claude.ai, ChatGPT and the Gemini clients to tick before each release.

## Context
- docs/plan/specs/2026-10-09-agent-gateway.md:89-103 (cross-vendor rules and the compatibility matrix).
- scripts/conformance.sh:1-96: the stdio mode (63) and the local HTTP mode (:67-93, 34). The final line (:96) reports the modes that ran.
- gateway/test/conformance/schemas.test.ts (63): the `inputSchema` checks (`type: object`, `additionalProperties: false`, no `$ref`) and the fixture-pack name checks are already done.
- gateway/test/conformance/fake-module.ts and gateway-wrapper.mjs: the fake module and the gateway launcher the script uses.
- package.json:24 `test:conformance` already exists.
- docs/compatibility.md:11-18 the matrix; :20 onward, the MVP A manual checklists.
- docs/plan/tasks/35-gateway-oauth.md: the endpoints, and `--public-url http://127.0.0.1:<port>` allowed for local tests (74 decision a).
- docs/plan/tasks/67-oauth-consent-and-grants.md: the consent page, its CSRF rules and the consent code sent to the user's Foundry client.

## Acceptance
- [ ] `npm run test:conformance` also runs an OAuth mode. It:
  1. starts the gateway with `--public-url http://127.0.0.1:<free port>` and the fake module;
  2. completes registration, authorization (the fake module receives 67's consent code and the script submits it with the CSRF token) and token exchange;
  3. runs `@modelcontextprotocol/inspector --cli` `tools/list` and one `tools/call` with the access token.

  It exits non-zero on any failure, and the final line names `oauth` among the modes.
- [ ] A static bearer against the OAuth-mode gateway gets 401 in the same run.
- [ ] `docs/compatibility.md` gains the OAuth column for the remote clients, and a per-release manual checklist for claude.ai, ChatGPT, Gemini CLI and the Gemini app (connect through the public URL, consent, one read call, one write held for approval, revoke from Foundry and see 401). The MVP A rows are unchanged.
- [ ] The PR includes a passing run.

## Out of scope
- Per-client setup guides (43).
- The stdio and local HTTP modes, the schema and name checks, and the `test:conformance` script entry (done by 63 and 34).
- Running the script automatically outside `scripts/release.mjs`.

## History
- 2026-10-13 MVP split: depends was `35, 20e`. 63 created the script with the stdio mode, the schema and name checks and the MVP A rows. 34 added the local HTTP mode and the Claude Code / Local HTTP cell.
- 2026-10-14 re-plan: the items 63 and 34 met were deleted. Depends is `35, 67`.

## Review round 1 — findings
Reviewed HEAD: 9f86891.

- [P2] scripts/conformance.sh:113-117: The "static bearer gets 401" check sends a made-up token (64 zeros) that no gateway would ever accept. It never sends the static token that actually exists.
  route: implementer
  input: The OAuth-mode gateway reuses the same `$db`. The HTTP-mode gateway stored its bearer there (app.ts prints "HTTP bearer token (shown once, stored hashed)"). Suppose a regression lets the public-mode gateway still honour that stored static token. The script sends `Bearer 000…0`, which matches no stored hash, so it still gets 401. The check passes, and the acceptance item "A static bearer against the OAuth-mode gateway gets 401" goes unguarded. The fix is to send `Bearer $http_token`, which the HTTP section already captured at :76.
- [P3, optional] gateway/test/conformance/oauth-flow.mjs:63-65 with fake-module.ts:113: The consent code can be read as an empty string.
  route: implementer
  input: `writeFileSync(codeFile, …)` creates the file first and writes the code after. A poll that lands between those two steps sees `existsSync` true, and `readFileSync` returns `''`. Verify then submits `code=` and gets a 400, so the run fails ("consent verify returned 400"). The window is narrow. Fix: write to a temp file and rename it, or poll until the file is non-empty.

Orchestrator scope notes (round 1):
- Accepted as in scope: the intro paragraph in docs/compatibility.md:11-17, the header comment in scripts/conformance.sh:2, and the shared `serve` start line in scripts/conformance.sh:44, which passes the code file and which the OAuth mode needs.
- Residual for task 43: docs/releasing.md:20 still quotes the old final line `conformance: ok (inspector <v>, stdio, http)`. That file is outside 40's Owns.

## Attempt 1 — failed
Verify on 3e365c2 (2026-10-15). The result was FAIL, with KIND environment. The failure is not in the branch, so this does not need another fanout.
- These passed: build, vitest (4776 tests), slow (2227 tests), and `npm run test:conformance` ("conformance: ok (inspector 2.10.1, stdio, http, oauth)", 9 s).
- `npm run test:scripts` failed. The pack-module, build-claude-plugin and ChatGPT plugin package suites assert that the zip succeeds, and every one gets "pack-module: zip is not installed": the host has no `zip` binary. The claude plugin `validate --strict` test also failed in one suite and was skipped in another ("claude CLI not found").
- Reviewer: APPROVE. The "passing run in the PR" item is met by quoting the conformance line above.
- Next: install `zip` on the host (needs sudo), then re-run `npm run test:scripts`.

## Review round 2 — findings (external)
Andrew's PR review of #150 at ce20a63 (2026-10-15; a static review, no tests run).

- [P3] gateway/test/conformance/oauth-flow.mjs:20: the OAuth conformance run bypasses discovery. Hardcoded endpoints and a bearer obtained in advance let the test pass even when the discovery metadata is broken. Start from the MCP endpoint instead:
  - an unauthenticated request must get 401 with a `WWW-Authenticate` header pointing at the protected-resource metadata;
  - fetch that metadata, then the authorization-server metadata it names;
  - validate the required fields (issuer, authorization_endpoint, token_endpoint, registration_endpoint, code_challenge_methods_supported including S256, and the resource matching the MCP URL);
  - use only the advertised endpoints for registration, authorization and token exchange.
  No URL path may be hardcoded except the MCP endpoint.
  route: implementer
  input: the gateway advertises a wrong token_endpoint or registration_endpoint in its metadata →  conformance still passes today.
  test: show it fails on broken metadata (e.g. a mutated metadata route in a scratch copy, or a self-check inside the script). It must pass against the real gateway.

## Review round 3 — findings
Reviewed HEAD: 51ea296 (re-review of the round 2 external fix since b6dc8ae). Round 2 is FIXED. The reviewer checked it with a scratch mutation: `token_endpoint` advertised as `/tokenx` makes the run print "oauth-flow: token returned 404" and exit 1. The real gateway prints "conformance: ok (inspector 2.10.1, stdio, http, oauth)".

- [STYLE] gateway/test/conformance/oauth-flow.mjs:20,38-40,47: the fix adds a double blank line (:20) and four lines longer than 100 columns. Run `prettier --write` on the file; `prettier --check` must pass on it. (`npm run lint` does not glob .mjs, so CI will not catch this.)
  route: implementer
  rule: docs/conventions.md:3, Prettier (.prettierrc, printWidth 100).
- [optional] gateway/test/conformance/oauth-flow.mjs:45: `new URL(meta[k])` throws an uncaught TypeError instead of calling `fail()`. Route it through `fail()` so a malformed endpoint gets the same clear message as the other checks.
  route: implementer

## Review round 4 — findings (external)
Andrew's PR review of #150 at 89f648d (2026-10-15).

- [P3] gateway/test/conformance/oauth-flow.mjs:94: the consent step makes up its own CSRF cookie. The helper ignores `Set-Cookie`, so conformance can pass even when the server sends no cookie, and a real browser would then fail consent with 403. Read the `Set-Cookie` header from the consent page response and `fail()` unless it is present and valid:
  - the name is `__Host-agcsrf-<rid>`;
  - the attributes a `__Host-` cookie requires are present (`Path=/`, no `Domain`; `Secure` per the gateway's rule for its public URL, so check what the gateway actually does over http://127.0.0.1 and validate that);
  - `HttpOnly` and `SameSite` are set if the gateway sets them.
  Replay only the server-issued value. Fix the whole class: no request in the flow may send a header value the script invented in place of one the server issues.
  route: implementer
  input: the gateway stops sending the CSRF Set-Cookie →  conformance still passes today.
  test: show it fails when the cookie is missing or renamed (a scratch mutation is fine; quote it).

## Review round 5 — findings
Reviewed HEAD: d52ae5b. The acceptance review of the round 4 fix gave APPROVE. Round 4 is FIXED. Mutations showing it fails were run by the implementer: no `Secure` gives "CSRF cookie lacks secure", a renamed prefix and a missing Set-Cookie both give "consent page sent no __Host-agcsrf-<rid> Set-Cookie", and each ends "conformance: oauth flow failed".

- [P3] gateway/test/conformance/oauth-flow.mjs:110: the cookie check only confirms `SameSite` is present, not its value, so a gateway that switched to `SameSite=None` would still pass. Require the value the gateway issues, `Strict` (case-insensitive), and fail with a clear message otherwise. Show it fails with a scratch mutation to `SameSite=Lax` or `None` (rebuild gateway/dist, then restore) and quote that in the commit message.
  route: implementer
