# 34 — Add local Streamable HTTP transport with bearer auth and defences

**Repo:** .
**Depends on:** 13, 69
**Status:** MVP B (after A). B order 1.
**Owns:**
- gateway/src/http/**
- gateway/src/status/**
- gateway/test/http/**
- gateway/src/app.ts
- gateway/src/bin/cli.ts
- gateway/src/config/** (HTTP options only)

## Goal
Serve MCP over Streamable HTTP on `127.0.0.1` with a bearer token for desktop
and CLI clients that prefer HTTP, plus the request size limits, a coarse
self-protection rate limit and a minimal status page.

## Context
- docs/plan/specs/2026-10-09-agent-gateway.md:48-56 — local reach mode
- docs/plan/specs/2026-10-09-agent-gateway.md:103-109 — auth, defences, status page only
- gateway/src/mcp/** (05, 20)
- docs/plan/tasks/69-secondary-relay-to-primary.md — 69 already serves one session server per relayed connection from `app.ts`; build the HTTP sessions the same way, and keep relaying working (69 also owns `app.ts` and `cli.ts`, hence the dependency)

## Acceptance
- [ ] `--http` serves MCP Streamable HTTP at `/mcp` on `127.0.0.1:<default HTTP port>`; any other bind address is refused unless OAuth is configured (35)
- [ ] Bearer token generated on first run, stored hashed in the store, printed once on stderr; requests without or with a wrong token get 401
- [ ] Bodies over `MAX_REQUEST_BYTES` get 413; more than `SELF_PROTECT_RPS` per token gets 429 (both constants in config)
- [ ] `GET /status` returns an HTML page with version, connected worlds/users, uptime; no secrets (test greps output for the token)
- [ ] MCP SDK client test over HTTP lists and calls a fixture tool
- [ ] `npm run verify` passes

## Out of scope
- OAuth, public URL, consent page (35, 36)
