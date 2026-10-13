# 34 — Add local Streamable HTTP transport with bearer auth and defences

**Repo:** .
**Depends on:** 13, 69, 70, 71
**Status:** Done on branch `claude/task-34` (2026-10-13); manual Claude Code check pending Andrew
**Owns:**
- gateway/src/http/**
- gateway/src/status/**
- gateway/test/http/**
- gateway/src/app.ts
- gateway/src/bin/cli.ts
- gateway/src/config/** (HTTP options only)
- scripts/conformance.sh (add the local HTTP mode; the stdio mode is unchanged)
- gateway/test/conformance/** (insertions only: HTTP helpers)
- docs/compatibility.md (the Local HTTP column for Claude Code only)
- gateway/src/store/** and gateway/test/store/** (added; approved by Andrew for migration 009 and the store accessors)

## Goal
Serve MCP over Streamable HTTP on `127.0.0.1` with a bearer token, for desktop
and CLI clients that prefer HTTP. Add request size limits, a coarse
self-protection rate limit and a minimal status page. Andrew moved this into
MVP A on 2026-10-13, alongside 69's socket relay. It ships local and loopback
only, and everything remote stays in MVP B.

## Context
- docs/plan/specs/2026-10-09-agent-gateway.md:48-56: local reach mode
- docs/plan/specs/2026-10-09-agent-gateway.md:103-109: auth, defences, status page only
- gateway/src/mcp/** (05, 20)
- docs/plan/tasks/69-secondary-relay-to-primary.md: 69 already creates one session server per relayed connection in `app.ts`. Build the HTTP sessions the same way, and keep relaying working. 69 also owns `app.ts` and `cli.ts`, hence the dependency.
- docs/plan/tasks/40-mcp-conformance.md "MVP split": the HTTP conformance mode moved here from 40; 40 keeps OAuth
- scripts/conformance.sh (63): the stdio mode to mirror; it uses a temp `HOME` and a non-default port
- docs/conventions.md#ports: local HTTP `7421`

## Acceptance
- [ ] `--http` serves MCP Streamable HTTP at `/mcp` on `127.0.0.1:7421` (`--http-port` overrides the port). Any other bind address is refused with exit 2. In MVP A no OAuth exception exists; 35 adds it.
- [ ] Only the link-port holder (69's primary) serves HTTP. A secondary started with `--http` logs one line saying HTTP is served by the primary, and relays as in 69. A secondary that takes over as primary starts HTTP if it was itself started with `--http`.
- [ ] A bearer token is generated on first run, stored hashed in the store and printed once on stderr. Requests without a token, or with a wrong one, get 401, and the comparison is constant-time.
- [ ] Bodies over `MAX_REQUEST_BYTES` get 413, and more than `SELF_PROTECT_RPS` per token gets 429. Both constants live in config.
- [ ] Each HTTP MCP session (`Mcp-Session-Id`) gets its own `createSessionServer` and so its own `sessionId`:
  - A test shows two HTTP sessions reach the fake module with distinct `sessionId`s.
  - Concurrent HTTP sessions are capped by `MAX_HTTP_SESSIONS`; the next `initialize` gets 503.
  - Idle sessions close after `HTTP_SESSION_IDLE_MS`, and their `onclose` cleanup runs (`LinkRegistry` listener counts return to baseline in a test).
- [ ] `GET /status` returns an HTML page with the version, connected worlds/users and uptime. It contains no secrets; the test greps the output for the token. Any world or user name shown is HTML-escaped (test with `<script>` in a user name).
- [ ] An MCP SDK client test over HTTP lists and calls a fixture tool.
- [ ] `scripts/conformance.sh` runs the stdio mode and then the HTTP mode by default. The HTTP mode runs the pinned Inspector `--cli` against `http://127.0.0.1:<non-default port>/mcp` with the bearer header, for `tools/list` and one `tools/call` round trip. The script prints `conformance: ok (inspector <v>, stdio, http)`, exits non-zero if either mode fails, and still leaves `~/.foundry-agent-gateway` untouched.
- [ ] `docs/compatibility.md`: the Claude Code / Local HTTP cell reads "MVP A", with a checklist line. Every other cell is unchanged.
- [ ] 69's relay tests and `gateway/test/bin/link-conflict.test.ts` pass unchanged.
- [ ] `npm run verify` passes.

## Out of scope
- OAuth, the public URL, non-loopback binds and the consent page (35, 67). In A these stay refused, not stubbed.
- The OAuth conformance mode and the remote matrix rows (40)
- User docs for `--http` (65)
- The relay transport itself (69)

## Decisions (Andrew)
- (a) The token hash lives in the SQLite store (migration 009, `gateway_settings`), not a file.
- (b) `--http-rotate-token` is a one-shot CLI that writes the store, prints the token after the commit and exits. It refuses if the db's user_version differs from the binary's; it never migrates. The primary reads the hash on every request, so rotation takes effect with no restart.
- (c) On a takeover whose HTTP listen fails, the instance keeps the link and relay, logs "HTTP off ... retrying", and retries on a single timer with 5-60 s backoff. First start still exits 1 on a port conflict.

## Review
Five rounds, final APPROVE at d849927.
- Round 1: the token was persisted before listen, so it was lost on EADDRINUSE. Fixed by committing after listen.
- Round 2: a commit versus rotate race printed a dead token. Fixed with `INSERT OR IGNORE` plus `changes > 0`. Also taken: rotate must not migrate, and a takeover-path test.
- Round 3: approved. The failed-takeover behaviour went to Andrew, giving decision (c).
- Round 4: a stop() race left an orphaned HTTP server and re-armed the timer. Fixed with a synchronous `httpGen` generation counter.
- Round 5: approved.

## Known gaps, not fixed
- The generation is captured after `startPrimary`'s earlier awaits, so an embedder calling stop() during startup could still race. The CLI is unaffected because stop is followed by process.exit.
- The guard on timer entry and the "HTTP still off" reason-change log have no tests; EACCES cannot be produced portably.
- `gateway_status` does not show whether HTTP is on or off (mcp/** is outside Owns).
- The secondary's HTTP log line is neutral; the relay handshake does not report HTTP state (relay/** is outside Owns).

## Manual check
PENDING (Andrew): run `foundry-agent-gateway --http` and connect Claude Code over HTTP with the bearer token.
