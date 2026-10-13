# 35 — Add the OAuth 2.1 authorization server for remote clients

**Repo:** .
**Depends on:** 34
**Status:** MVP B (after A). B order 4.
**Owns:**
- gateway/src/oauth/**
- gateway/test/oauth/**
- gateway/src/store/** (new migration only)
- gateway/src/http/** (mount OAuth routes and token check only)
- gateway/src/config/** (`--public-url` only)

## Goal
Let cloud-hosted MCP clients (ChatGPT, Gemini app, claude.ai) connect through a
user-run tunnel: OAuth 2.1 with PKCE and dynamic client registration,
short-lived access tokens stored hashed, and scopes that form permission layer 1.

## Context
- docs/plan/specs/2026-10-09-agent-gateway.md:48-66 — tunnelled mode, OAuth 2.1, PKCE, DCR
- docs/plan/specs/2026-10-09-agent-gateway.md:103-104 — consent, short-lived tokens, revocable
- docs/plan/specs/2026-10-09-agent-gateway.md:120-122 — token scopes are the outermost permission layer

## Acceptance
- [ ] `--public-url <https url>` enables OAuth; serves `/.well-known/oauth-authorization-server` and `/.well-known/oauth-protected-resource` per the MCP authorization spec, with issuer equal to the public URL
- [ ] DCR at `/register`; authorization code flow with S256 PKCE only (`plain` rejected); refresh tokens rotate
- [ ] Access tokens expire in 1 hour (named constant); tokens and client secrets stored as hashes (test inspects the DB)
- [ ] Scopes `read`, `write`, `destructive`, `code`; a call whose category is outside the token's scopes returns `FORBIDDEN` before reaching the module; `tools/list` omits them
- [ ] Authorization endpoint delegates to a consent step interface (placeholder auto-deny in this PR; real page is 36)
- [ ] Conformance test with an MCP SDK OAuth client against a local instance
- [ ] `npm run verify` passes

## Out of scope
- Consent page UI and in-Foundry revocation (67)
- Tunnel setup (documented in 43)

## MVP split (2026-10-13)
The consent step stays the auto-deny placeholder named in the Acceptance list. 67 (MVP B, next after this task) replaces it with the real consent page and adds self-service grant revocation, so remote clients can authorize in MVP B once 67 lands.
