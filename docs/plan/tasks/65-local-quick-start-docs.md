# 65 — Write the local quick start, security model and privacy statement

**Repo:** .
**Depends on:** 60, 61, 62, 69, 70, 34
**Status:** MVP A
**Owns:**
- README.md
- docs/guides/claude-desktop.md
- docs/guides/claude-code.md
- docs/security.md (append new sections only; existing sections unchanged)
- docs/privacy.md

## Goal
The MVP A slice of task 43: enough documentation for a stranger to install the
module and gateway locally and connect Claude Desktop or Claude Code, plus an
honest security model and privacy statement for what MVP A actually ships.
Nothing about remote, HTTP, headless or Docker; those docs stay in 43.

## Context
- docs/plan/tasks/43-user-docs.md — the full contract; README "Tool packs", security "Multi-user isolation" and "Tool packs" bullets are inherited here minus server mode and the audit trail
- docs/plan/specs/2026-10-09-agent-gateway.md "Outcome" (line 13) and "Tool packs" (line 28)
- docs/security.md — existing offline-reading, offline-queue and adapter sections to keep
- docs/spikes/foundry-socket-identity.md (10b) — what Foundry can and cannot prove about identity
- gateway/test/routing/isolation.test.ts — the isolation guarantees to describe
- gateway/src/link/server.ts:180-200 — first pairing trusts the `hello` world/user ids (local-mode trust assumption)
- docs/packs/README.md (20f)
- docs/plan/done/28-gateway-event-buffer.md, 29-offline-event-reading.md, 30-offline-write-queue.md — what the gateway stores
- docs/plan/tasks/69-secondary-relay-to-primary.md "Design" — secondary instances relay to the primary over a user-only local socket (named pipe on Windows) with a per-boot secret in the state dir; the security model must state this, and the Claude Desktop guide must no longer say Foundry tools work in only one Desktop session
- docs/plan/tasks/70-zero-config-pairing-origin-and-role.md "Design": the `.mcpb` has no Foundry URL or role setting. A new pairing from any http(s) origin needs the one-time code. A token works only from the origin it was paired from, so http and https of one host pair separately. Pairings made before 70 need one re-pair. Failed code attempts are rate-limited. The tool tier is the Foundry user's own role. The security model must state these rules and their threat model, and the guides must drop the Foundry URL scheme limit noted in PLAN A2.
- docs/plan/tasks/34-gateway-local-http.md: local Streamable HTTP on `127.0.0.1:7421` with a bearer token (MVP A since Andrew, 2026-10-13); the option for clients that prefer HTTP

## Acceptance
- [ ] README quick start: install the module from `https://github.com/AindriuB/agent-gateway/releases/latest/download/module.json`; enable it in a pf2e or dnd5e world (versions from `module.json`); keep a Foundry browser tab logged in as the agent's user open (no headless in this release); run `npx foundry-agent-gateway` or install the `.mcpb`; pair; connect Claude Desktop or Claude Code; MIT licence
- [ ] README has a "Tool packs" section as worded in 43's acceptance, and links the two guides, `docs/security.md` and `docs/privacy.md`
- [ ] README states MVP A is local only: no remote clients, OAuth, public URLs, ChatGPT, Gemini, headless agents or Docker yet. It also states that the `.mcpb` and `npx` installs are verified on macOS and untested on Windows in this release (Andrew, 2026-10-13).
- [ ] Local HTTP option: `docs/guides/claude-code.md` gives the exact `claude mcp add --transport http` command for `http://127.0.0.1:7421/mcp` with the bearer header, and says how to start the gateway with `--http`. It explains that the token is printed once on first run and stored only hashed, and that HTTP binds to loopback only.
- [ ] `docs/guides/claude-desktop.md` covers the `.mcpb` install and the `claude_desktop_config.json` `npx` snippet with the file's macOS and Windows paths; `docs/guides/claude-code.md` gives the exact `claude mcp add` command; both cover pairing, "link port in use" (57's message) and "module not connected"
- [ ] `docs/security.md` gains: the permission layers MVP A enforces (role tool sets, world policy, rate limits, approvals, audit and Undo; OAuth scopes listed as remote-mode only, not in this release); code confirmation; where pairing tokens are stored; where the HTTP bearer token is stored (hashed) and that HTTP binds to `127.0.0.1` only; the relay socket and per-boot secret from 69; "Multi-user isolation" per 43's bullet, minus server-mode pairing confirmation, with local mode's trust assumption stated plainly (anyone who can reach the link port with a valid pairing code can claim any user id; local mode assumes only the owner's machine can reach it); what a malicious agent can and cannot do; "Tool packs" per 43's bullet
- [ ] `docs/privacy.md` states: what leaves the Foundry client (to the local gateway only); what the gateway writes to disk, naming the store path and each kind of record (pairing tokens, the offline event buffer with its retention and purge, offline write-queue receipts); that the product ships no model and sends nothing to any AI vendor itself, while the AI client the user connects sends tool results to its vendor; that a pack's data handling is its author's
- [ ] `rg -n -- '--public-url|headless add|docker|audit-trail.md' README.md docs/guides docs/privacy.md` returns nothing (`--http` is now allowed: 34 is in MVP A)
- [ ] Every command in the docs was run once by the implementer against the locally built zip, tarball and `.mcpb`; the PR lists each with its outcome

## Out of scope
- ChatGPT, Gemini, tunnel, headless and server-mode guides (43)
- `.github/FUNDING.yml` and donation links (43; needs Andrew's Ko-fi and Sponsors URLs)
- `docs/releasing.md` (64), `docs/compatibility.md` (63)
- Foundry listing text and submission (Andrew)
- Any code change, including the trust-assumption code comment (36)
