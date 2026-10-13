# 67 — Add the OAuth consent page and self-service grant revocation

**Repo:** .
**Depends on:** 35
**Status:** MVP B (after A). B order 5, after 35. Split from 36; does not depend on 18.
**Owns:**
- gateway/src/oauth/consent/**
- gateway/test/oauth/consent/**
- gateway/src/oauth/grants/**
- gateway/test/oauth/grants/**
- gateway/src/oauth/** (replace the placeholder consent step with the real one, and add the revoke path; no other change)
- gateway/src/http/** (mount the consent routes only)
- gateway/src/link/grants.ts (new: handles the grant link messages)
- gateway/src/link/server.ts (insertions only: route the grant messages to `grants.ts`)
- protocol/src/link/messages.ts (insertions only)
- module/src/apps/grants/**
- templates/grants/**
- module/test/apps/grants/**
- module/src/link/client.ts (grant and consent-code messages only)
- module/src/settings/index.ts (insertions only: register the grants menu)
- lang/en.json (insertions under `AGENT_GATEWAY.Consent.*` and `AGENT_GATEWAY.Grants.*` only)
- styles/agent-gateway.css (grants section only)

## Goal
Let a remote MCP client (claude.ai, ChatGPT, Gemini app) finish OAuth: a
consent page where the human picks the world, the Foundry user and the scopes,
and proves control of that user's Foundry session. Then let each Foundry user
see and revoke the grants bound to themselves from their own client. Without
this, 35's consent step auto-denies every authorization.

## Context
- docs/plan/tasks/36-consent-and-revocation.md — the original contract; its first five Acceptance items are the source of this task
- docs/plan/tasks/35-gateway-oauth.md — the consent step interface and its auto-deny placeholder
- docs/spikes/foundry-socket-identity.md:106-120 — option (c), a one-time code shown only in the claimed user's client; identity only from server-set arguments
- docs/plan/PLAN.md "Task 18 remains architecture-blocked" — why revoking another user's grants is not here
- docs/conventions.md#shared-insertion-only-files — `protocol/src/link/messages.ts`, `lang/en.json`, `module/src/settings/index.ts`, `styles/agent-gateway.css`

## Acceptance
- [ ] The consent page lists connected (world, user) pairs and scope checkboxes (`read`, `write`, `destructive`, `code`); approving requires a one-time code delivered only to the chosen user's Foundry client (option (c) of the 10b spike); the form is CSRF-protected
- [ ] The code expires after 5 minutes (named constant) and allows at most 5 wrong entries (named constant) before the consent request is void; tests cover expiry, wrong code, lock-out and success
- [ ] Granted tokens bind to that (world, user) and its chosen scopes; a test shows a token granted for one user never reaches another user's connection
- [ ] Link messages `listGrants` / `grants` / `revokeGrant`: a user's client lists only grants bound to its own (world, user), with client name, scopes and last used. The gateway takes the user from the link connection's binding, never from the message payload (test sends a forged user id and gets only its own grants)
- [ ] Revocation invalidates the grant's access and refresh tokens immediately; the next MCP call with either gets 401 (test)
- [ ] The page is plain server-rendered HTML with no external assets; untrusted text (client name from DCR) is escaped (test with a `<script>` client name)
- [ ] A grants app in module settings shows the current user's grants with a Revoke button; `module/test/apps/grants/**` covers list and revoke; strings are localized
- [ ] Manual check: MCP Inspector OAuth flow through the consent page against foundry.local v14 with the gateway's `--public-url` set; screenshots in the PR
- [ ] `npm run verify` passes

## Out of scope
- A GM revoking another user's grants, or revoking while that user is offline (18 and the rest of 36)
- The agents app (18)
- Server-mode pairing confirmation (68)
- Audit-trail entries for consent or revocation (35b)
- Client setup guides (43)
