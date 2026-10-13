# 65 — Write the local quick start, security model and privacy statement

**Repo:** .
**Depends on:** 60, 61, 62
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

## Acceptance
- [ ] README quick start: install the module from `https://github.com/AindriuB/agent-gateway/releases/latest/download/module.json`; enable it in a pf2e or dnd5e world (versions from `module.json`); keep a Foundry browser tab logged in as the agent's user open (no headless in this release); run `npx foundry-agent-gateway` or install the `.mcpb`; pair; connect Claude Desktop or Claude Code; MIT licence
- [ ] README has a "Tool packs" section as worded in 43's acceptance, and links the two guides, `docs/security.md` and `docs/privacy.md`
- [ ] README states MVP A is local only: no remote clients, HTTP, ChatGPT, Gemini, headless agents or Docker yet
- [ ] `docs/guides/claude-desktop.md` covers the `.mcpb` install and the `claude_desktop_config.json` `npx` snippet with the file's macOS and Windows paths; `docs/guides/claude-code.md` gives the exact `claude mcp add` command; both cover pairing, "link port in use" (57's message) and "module not connected"
- [ ] `docs/security.md` gains: the permission layers MVP A enforces (role tool sets, world policy, rate limits, approvals, audit and Undo; OAuth scopes listed as remote-mode only, not in this release); code confirmation; where pairing tokens are stored; "Multi-user isolation" per 43's bullet, minus server-mode pairing confirmation, with local mode's trust assumption stated plainly (anyone who can reach the link port with a valid pairing code can claim any user id; local mode assumes only the owner's machine can reach it); what a malicious agent can and cannot do; "Tool packs" per 43's bullet
- [ ] `docs/privacy.md` states: what leaves the Foundry client (to the local gateway only); what the gateway writes to disk, naming the store path and each kind of record (pairing tokens, the offline event buffer with its retention and purge, offline write-queue receipts); that the product ships no model and sends nothing to any AI vendor itself, while the AI client the user connects sends tool results to its vendor; that a pack's data handling is its author's
- [ ] `rg -n -- '--http|--public-url|headless add|docker|audit-trail.md' README.md docs/guides docs/privacy.md` returns nothing
- [ ] Every command in the docs was run once by the implementer against the locally built zip, tarball and `.mcpb`; the PR lists each with its outcome

## Out of scope
- ChatGPT, Gemini, tunnel, headless and server-mode guides (43)
- `.github/FUNDING.yml` and donation links (43; needs Andrew's Ko-fi and Sponsors URLs)
- `docs/releasing.md` (64), `docs/compatibility.md` (63)
- Foundry listing text and submission (Andrew)
- Any code change, including the trust-assumption code comment (36)
