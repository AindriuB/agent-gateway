# 43 — Write the remote, server-mode and headless user documentation

**Repo:** .
**Depends on:** 65, 35, 37, 38, 40, 42, 67, 68, 74
**Status:** MVP B wave 4, last. Amended 2026-10-14 in the MVP B re-plan: the items 65 already did are removed; the existing docs/security.md sections are edited, not created; README.md:34 is flipped at the end.
**Owns:**
- README.md
- docs/guides/** (new guides; the Claude Desktop and Claude Code guides only where they link a new guide)
- docs/security.md (edits to existing sections, plus new sections where named below)
- docs/privacy.md (the remote and server-mode additions only)
- .github/FUNDING.yml (new)

## Goal
Document what MVP B adds, for someone who has never seen the project: remote clients through a public URL with OAuth, the server-mode Compose stack behind a reverse proxy, and headless agents. Update the security model and privacy statement for remote and server mode. Then remove "local only" from the README, because after this task it is no longer true.

## Context
- docs/plan/specs/2026-10-09-agent-gateway.md:79-87 (reach modes), :302-304 (the docs list).
- 65 (done) wrote the README quick start, docs/guides/claude-desktop.md, docs/guides/claude-code.md, docs/privacy.md and the base security model. These stay and are not rewritten.
- README.md:32-34 "What this release does not do": :34 says the release is local only, with no remote clients, OAuth, public URLs, ChatGPT or Gemini connectors, headless agents or Docker images.
- docs/security.md (existing sections to edit):
  - :41 "Local HTTP transport — task 34";
  - :44-55 "The permission model in this release" (:55 says OAuth scopes are not in this release);
  - :57 "Pairing, code confirmation and token storage";
  - :65 "HTTP bearer token";
  - :69 "Relay between gateway instances";
  - :73-78 "Multi-user isolation" (:78 is local mode's trust assumption);
  - :80 "What a malicious agent can and cannot do";
  - :84 "Tool packs".
- docs/privacy.md:1-26: what leaves the client, what the gateway writes, the AI client, tool packs.
- docs/server-mode.md and gateway/docker/README.md (42); docs/compatibility.md (40).
- Settings and behaviour to describe:
  - 74: `--public-url`, the bind addresses, `--trust-proxy`, the static bearer is off in public mode, the pairing code only in the operator log, and the minimal `/status`;
  - 35: the scopes;
  - 67: consent and revoking a grant;
  - 68: operator invites in server mode (`--invite`, `--revoke-pairing`, `--cancel-invite`, `--list-invites`, `--list-pairings`, and the pairing app's "Copy my ids" line);
  - 37 and 38: headless agents.
- docs/spikes/foundry-socket-identity.md (10b): what Foundry can and cannot prove about identity.

## Acceptance
- [ ] Guides in `docs/guides/`, each with exact config snippets and the commands the implementer ran:
  - `claude-ai.md`;
  - `chatgpt.md`, through the public URL;
  - `gemini-cli.md`;
  - `gemini-app.md`;
  - `reverse-proxy.md`: Caddy as in 42, nginx with `proxy_set_header Host $host` and WebSocket upgrade headers for `/link`, why `X-Forwarded-For` is trusted only with `--trust-proxy` from a loopback peer, and why the gateway itself never does TLS;
  - `headless.md`: a dedicated agent user, `headless add`, the GM's headless toggle, the owner, and explicit binding with `--world`/`--user`.
- [ ] docs/security.md edits:
  - "The permission model": token scopes become layer 1, and the line at :55 goes;
  - "Pairing, code confirmation and token storage": codes only in the operator log with a public URL, and server-mode operator invites (68): single use, bound to one world and user, with a 24 h TTL by default;
  - "HTTP bearer token": off with a public URL;
  - "Multi-user isolation": in server mode only the operator decides who pairs as whom, through invites bound to an exact (world, user); re-pairing needs a new invite, which revokes the old pairing and its OAuth grants; the operator revokes with `--revoke-pairing`, and a running gateway closes the connection within seconds; Foundry cannot prove identity to the gateway, so the invite is the trust root and must be sent privately; OAuth sessions are bound to the grant's (world, user), and headless identities are reachable only by explicit binding;
  - "What a malicious agent can and cannot do": remote clients.

  A new "Remote access and OAuth" section covers PKCE, exact redirect URIs, audience binding, token lifetimes, revocation from Foundry, CSRF and anti-framing on the consent page, and the per-client limits.
- [ ] docs/privacy.md adds what a public gateway exposes (the version and uptime on `/status`), what the OAuth tables store (hashes, client names, grants), and what a headless agent's profile directory holds.
- [ ] README: the five-minute local quick start stays first. A short "Remote and server mode" section links the new guides, and Ko-fi and GitHub Sponsors links are added. `.github/FUNDING.yml` lists both.
- [ ] Last commit of the PR: README.md:32-36 "What this release does not do" no longer says local only. It lists only what is still missing at that point (for example, native installers), and keeps the macOS-verified / Windows-untested line if still true.
- [ ] If 35b has landed, docs/security.md and docs/privacy.md link `docs/audit-trail.md` and cover verbose mode (off by default, refused in remote and server mode). If it has not, this item moves with 35b.
- [ ] Every command in the new docs was run once by the implementer, and the PR lists them.

## Out of scope
- Rewriting the 65 quick start or the Claude Desktop and Claude Code guides.
- Foundry listing text and submission (manual, Andrew).
- Native installers, tunnels, `share` mode, and TLS in the gateway (not planned in MVP B).
- docs/server-mode.md and gateway/docker/README.md, which are 42's; this task only links them.

## History
- 2026-10-13 MVP split: depends was `29, 32, 33, 36, 38, 41, 20f, 35b`. 65 took the README quick start, the Claude guides, the privacy statement and the base security model.
- 2026-10-14 re-plan: those items were removed; the existing security sections are edited in place; README.md:34 is flipped at the end.
