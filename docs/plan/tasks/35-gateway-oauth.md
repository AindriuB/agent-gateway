# 35 — Add the OAuth 2.1 authorization server for remote clients

**Repo:** .
**Depends on:** 34, 74
**Status:** MVP B wave 2, alongside 42. Rewritten 2026-10-14 in the MVP B re-plan. It builds on 34's HTTP server and 74's public-URL settings, limits and per-session selector seam.
**Owns:**
- gateway/src/oauth/** (new)
- gateway/test/oauth/** (new)
- gateway/src/store/migrations/010-oauth.ts (new)
- gateway/src/store/migrations/index.ts (insertion only: one import and one array entry)
- gateway/src/store/store.ts (insertions only: one `oauth` repository field and its construction, as `events` and `queue` are built; and widening `onPairingRevoked` listeners to receive the revoked `PairingRow`, with the oauth repository subscribed inside `openStore`)
- gateway/src/http/server.ts (mount the OAuth routes, and the OAuth branch of the authenticator and `/status` check only)
- gateway/src/app.ts (build the OAuth server and authenticator when `publicUrl` is set, and the principal's scopes in `sessionOptions` only)
- gateway/src/mcp/session.ts (scope filtering only)
- gateway/test/http/oauth-*.test.ts (new)
- gateway/test/mcp/scopes.test.ts (new)
- gateway/package.json and package-lock.json (dependency insertions only, if any; prefer none)

## Goal
Let cloud-hosted MCP clients (claude.ai, ChatGPT, the Gemini app) reach a gateway behind a public URL. Implement OAuth 2.1: authorization code with S256 PKCE, dynamic client registration, short-lived access tokens stored hashed, rotating refresh tokens, and audience binding to the public URL. Each token is bound to one (world, user) grant and a set of scopes. Scopes are permission layer 1. The consent step stays an auto-deny placeholder until 67.

## Context
- docs/plan/specs/2026-10-09-agent-gateway.md:79-87 (reach modes), :89-92 (OAuth 2.1, PKCE, DCR), :200-202 (consent, short-lived, revocable), :213-214 (SQLite holds OAuth clients and hashed tokens), :221-223 (token scopes are the outermost layer).
- Andrew, 2026-10-14: with `--public-url` set, the static bearer is off and remote clients use OAuth only. 74 enforces that; this task adds the OAuth path.
- 74 provides `config.publicUrl`; the `HttpServerOptions.authenticate` hook and `HttpPrincipal { key, selector? }`; `createSession({ principal })` with `exactId` selectors; per-client keys and bounded buckets in gateway/src/http/**; and the minimal `/status` for unauthenticated requests.
- gateway/src/http/server.ts (main at 1a54559; 74 reshapes it): :186-190 the `/mcp` route and the bearer check `this.o.token.verify` (:187). The OAuth check sits next to it, as another branch of 74's `authenticate`. :168-185 `/status`.
- gateway/src/http/token.ts:1-41: the hashing and `timingSafeEqual` pattern to copy for OAuth tokens.
- gateway/src/store/store.ts:29-48 the `Store` interface with `events` and `queue` repositories; gateway/src/events/repository.ts:1-30 is the repository shape. gateway/src/store/migrations/009-gateway-settings.ts is 34's `gateway_settings` table. Reuse it for any single-row OAuth setting rather than a new table.
- Where tool categories come from:
  - Core tools: `ToolDefinition.category` (protocol/src/tools/define.ts:15), one of `read | write | destructive | code`.
  - Pack tools: the category the module announces in `toolset` frames, which is validated against the same four values at protocol/src/link/messages.ts:100-101. The module's registry refuses packs without a valid category (spec :128-130).
  - In the gateway: `coreDefinition` (gateway/src/mcp/session.ts:130-136); `moduleVisibleFor` and `visibleFor` (:137-219) build the list; `listed` (:226-234) is `tools/list`. The call path is :295-410: the gateway event tools at :310-338, the offline queue at :339-403 (it enqueues a write **before** the visibility check at :406-410), and the module call after :404.
  - Gateway tools: `events_poll` and `events_history` are `read` (protocol/src/tools/events-poll.ts:7, events-history.ts:7), and `approval_status` is `read` (approval-status.ts:14).
- RFC 8414 (server metadata), RFC 9728 (protected-resource metadata), RFC 7591 (DCR), RFC 7636 (PKCE), RFC 8707 (resource indicators), OAuth 2.1 draft (refresh rotation, exact redirect match). The MCP authorization spec requires clients to send `resource`.

## Decisions
Defaults: follow them unless the PR shows a reason not to.
- (a) **Migration 010** (`010-oauth.ts`) holds four tables:
  - `oauth_clients`: id, client-secret hash or null, name, redirect URIs as JSON, created_at, last_used_at;
  - `oauth_grants`: id, client_id, world_id, user_id, scopes, created_at, last_used_at, revoked_at;
  - `oauth_codes`: code hash, grant_id, redirect_uri, code_challenge, resource, expires_at, used_at;
  - `oauth_tokens`: token hash, kind (`access` or `refresh`), grant_id, family id, audience, expires_at, revoked_at, replaced_by.

  67 lists and revokes `oauth_grants` and adds no migration. Decision (h) of 74 reserves 011 for 68 and 012 for 38.
- (b) **Redirect URIs.** At registration each URI must be `https:`, or `http:` with host `127.0.0.1`, `[::1]` or `localhost`. No fragment, at most 5 per client, at most 512 characters each. `/authorize` and `/token` compare by exact string equality with a registered URI: no prefix match, and no port wildcard for loopback.
- (c) **Audience.** The canonical resource is `<publicUrl>/mcp`. A `resource` parameter at `/authorize` or `/token` that is present and not equal to it gets `invalid_target`. An absent one is bound to it. Access tokens carry the audience, and `/mcp` accepts only tokens whose audience is the canonical resource.
- (d) **Lifetimes.** Named constants: access token 1 h (`ACCESS_TOKEN_TTL_MS`), authorization code 60 s, refresh token 30 days. Refresh rotates on every use. Presenting a rotated-out refresh token, or a used authorization code a second time, revokes every token in that family.
- (e) **Abuse limits.** Named constants, keyed by 74's client key:
  - `/register` 5 per hour per client;
  - `/token` 30 per minute per client;
  - `/authorize` 30 per minute per client;
  - `MAX_OAUTH_CLIENTS` 200 registered clients in total. When full, registration first deletes clients older than 24 h that have no grant. If none can be deleted, it answers 503 with `{"error":"temporarily_unavailable"}`.

  `client_name` is stored only after trimming to 100 printable characters.
- (f) **Scopes** are `read`, `write`, `destructive` and `code`, with `read` the default when none is asked. The principal carries the grant's scopes, and app.ts passes them to `createSessionServer` as `allowedCategories`. The filter applies before the event tools, before the offline queue and before the module call. `gateway_status` is always listed.
- (h) **Grants die with their pairing.** `onPairingRevoked` listeners (store.ts:34, :105-110, :126-130) receive the revoked `PairingRow`; the existing listeners (events/buffer.ts:60, offline-queue/service.ts:46) ignore it. `openStore` subscribes the oauth repository, so revoking a pairing revokes every grant for that row's (world, user) and their access and refresh tokens. This happens in whichever process revokes: the gateway, or a one-shot CLI such as 68's `--revoke-pairing`. 68's invite replacement and 67's flows rely on it.
- (g) **Consent step interface.** `ConsentStep.decide(request) → Promise<{ approve: { worldId, userId, scopes } } | { deny: string }>`. This PR ships `AutoDenyConsent`, which redirects with `error=access_denied`. Tests inject an approving step. 67 replaces the default.

## Acceptance
Metadata and registration:
- [ ] With `--public-url https://gw.example.com`, `GET /.well-known/oauth-authorization-server` returns RFC 8414 metadata with `issuer` `https://gw.example.com` and `authorization_endpoint`, `token_endpoint` and `registration_endpoint` under it, `code_challenge_methods_supported: ["S256"]` and `scopes_supported` listing the four scopes. `GET /.well-known/oauth-protected-resource` returns `resource: "https://gw.example.com/mcp"` and `authorization_servers: ["https://gw.example.com"]`. Without `--public-url`, both return 404.
- [ ] A 401 from `/mcp` carries `WWW-Authenticate: Bearer resource_metadata="https://gw.example.com/.well-known/oauth-protected-resource"`.
- [ ] `/register` accepts `token_endpoint_auth_method` `none` and `client_secret_post`. It refuses (400 `invalid_redirect_uri`): an `http:` non-loopback URI, a URI with a fragment, more than 5 URIs, and a URI over 512 characters. Client secrets are stored only as hashes.

Flow:
- [ ] `/authorize` refuses: a missing `code_challenge`; `code_challenge_method=plain`; a `redirect_uri` not exactly registered (for example a registered one plus a trailing `/`); and `response_type` other than `code`. A redirect URI that does not match gets an error page, never a redirect to it.
- [ ] `resource=https://evil.example/mcp` gets `invalid_target`; an absent `resource` yields a token whose audience is `https://gw.example.com/mcp`. A token whose stored audience differs is refused at `/mcp` with 401 (test edits the row).
- [ ] An authorization code is single use and expires after 60 s (injectable clock). Its second use returns `invalid_grant` and revokes the access token the first use issued.
- [ ] Refresh returns a new refresh token. The old one then fails, and presenting it again revokes the whole family, so the newest access token gets 401.
- [ ] After `ACCESS_TOKEN_TTL_MS` an access token gets 401.
- [ ] A test opens the SQLite file after a full flow and finds no access token, refresh token, code or client secret in clear text: the column values are 64-character hex hashes.
- [ ] With the default `AutoDenyConsent`, `/authorize` redirects to the registered URI with `error=access_denied` and the original `state`.

Binding and scopes (through 74's seam):
- [ ] A token granted for (w1,u1) creates an HTTP session bound to (w1,u1) with `exactId`. With FakeModules for (w1,u1) and (w1,u2), `world_info` reaches u1. With only u2 connected it returns `WORLD_OFFLINE`, and u2's FakeModule receives no call frame.
- [ ] Revoking the grant (a direct store call in the test) makes the next request on an open session get 401.
- [ ] `store.revokePairing(id)` for a (w1,u1) pairing revokes every (w1,u1) grant and its tokens; a (w1,u2) grant is untouched; the (w1,u1) access token then gets 401 (test). The existing event and queue revocation tests pass unchanged.
- [ ] A `read`-only token: `tools/list` omits every `write`, `destructive` and `code` tool (core and a FakeModule-announced pack tool) and still lists `gateway_status`. Calling a `write` tool returns `FORBIDDEN` while the world is connected, and also while it is offline: no row is added to the offline queue (test inspects the queue table), and the FakeModule receives no frame.
- [ ] A token with `read write` can call a `write` tool and not a `destructive` one.

Static bearer and status:
- [ ] With `--public-url`, the static bearer is never accepted (74's test still passes). `GET /status` with a valid OAuth access token shows the connected worlds visible to that grant's (world, user) only; without one it shows only the version and uptime.

Limits:
- [ ] The sixth `/register` from one client key within an hour gets 429, and another key still registers. The same pattern holds for `/token` (31st per minute) and `/authorize` (31st per minute).
- [ ] With `MAX_OAUTH_CLIENTS` lowered in the test, registration prunes clients older than 24 h with no grant, and returns 503 `temporarily_unavailable` when none can be pruned.

End to end:
- [ ] A test drives the MCP SDK client's OAuth support (`@modelcontextprotocol/sdk/client/auth.js` with `StreamableHTTPClientTransport`) against a gateway started with `--public-url http://127.0.0.1:<free port>` (74 allows loopback `http:`), an approving test consent step and a FakeModule, through registration, authorization, token, `tools/list` and one `tools/call`.
- [ ] `npm run verify` passes, and `git diff --stat main` lists only files in Owns.

## Out of scope
- The consent page, consent codes and grant revocation in Foundry (67).
- The OAuth mode of `scripts/conformance.sh` and the remote rows of docs/compatibility.md (40).
- Host and Origin allowlists, client keys, the static-bearer switch-off and the pairing-code hiding (74).
- Token introspection and the RFC 7009 revocation endpoint.
- Docker and Caddy (42), and client setup guides (43).
- Audit-trail entries for OAuth events (35b).
