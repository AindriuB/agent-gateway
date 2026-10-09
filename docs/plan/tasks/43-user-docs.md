# 43 — Write user documentation, security model and privacy statement

**Repo:** .
**Depends on:** 29, 32, 33, 36, 38, 41
**Owns:**
- README.md
- docs/guides/**
- docs/security.md
- docs/privacy.md
- .github/FUNDING.yml

## Goal
Make the five-minute promise real on paper: a README quick start, per-client
setup guides, a headless and server-mode guide, the security model and a privacy
statement that says exactly what data goes where, ready for the Foundry listing.

## Context
- docs/plan/specs/2026-10-09-agent-gateway.md:7-21 — outcome, five-minute setup, donations
- docs/plan/specs/2026-10-09-agent-gateway.md:197-201 — submission checklist and docs list
- docs/security.md (29), docs/server-mode.md (42), docs/compatibility.md (40)

## Acceptance
- [ ] README quick start: install module from manifest URL, `npx foundry-agent-gateway`, pair, connect Claude Desktop; plus Ko-fi and GitHub Sponsors links and the MIT licence
- [ ] Guides in `docs/guides/`: Claude Desktop (stdio and `.mcpb`), Claude Code, ChatGPT with a tunnel, Gemini CLI, Gemini app, headless agents; each lists exact config snippets
- [ ] `docs/security.md`: the five permission layers, approval flow, code confirmation, audit and undo, offline event reading caveat, token storage, what a malicious agent can and cannot do
- [ ] `docs/privacy.md`: what leaves the Foundry client (to the gateway only), what the gateway stores (no world data), that the product ships no model and sends nothing to any AI vendor itself
- [ ] Every command in the docs was run once by the implementer; PR lists them

## Out of scope
- Foundry listing text and submission (manual, Andrew)
