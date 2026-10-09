# 36 — Add the OAuth consent page and token revocation from Foundry

**Repo:** .
**Depends on:** 35, 18
**Owns:**
- gateway/src/oauth/consent/**
- gateway/test/oauth/consent/**
- protocol/src/link/messages.ts (insertions only)
- module/src/apps/agents/** (OAuth tokens section only)
- templates/agents/** (OAuth tokens section only)
- lang/en.json (insertions under `AGENT_GATEWAY.Tokens.*` only)

## Goal
Show a consent page where the human picks the world, the Foundry user and the
scopes for a remote client, and let them see and revoke those grants from inside
Foundry's agents app.

## Context
- docs/plan/specs/2026-10-09-agent-gateway.md:103-104 — consent page (world, Foundry user, scopes); revocable from inside Foundry
- docs/plan/specs/2026-10-09-agent-gateway.md:108-109 — gateway serves only the consent and status pages
- gateway/src/oauth/** (35); module/src/apps/agents/** (18)

## Acceptance
- [ ] Consent page lists connected (world, user) pairs and scope checkboxes; approval requires the user to enter a one-time code shown in that Foundry user's client (proves control of the Foundry session); CSRF-protected form
- [ ] Granted tokens bind to that (world, user); link messages `listGrants` / `grants` / `revokeGrant` let the agents app show client name, scopes, last used, and revoke
- [ ] Revocation invalidates access and refresh tokens immediately (test)
- [ ] Page is plain server-rendered HTML with no external assets
- [ ] Manual check: MCP Inspector OAuth flow through the consent page against foundry.local v14; screenshots in PR

## Out of scope
- Client-specific setup guides (43)
