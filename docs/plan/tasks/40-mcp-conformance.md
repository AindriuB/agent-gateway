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
