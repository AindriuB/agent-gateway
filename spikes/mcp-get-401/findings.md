# Spike 156: why does ChatGPT get 401 on `GET /mcp`?

## Status of the evidence (read this first)

The acceptance asks for counts from the deployed gateway log and the Caddy access log. This spike
ran in a worktree with no access to either log, and task 110's recorded sample holds only the
status totals (388 of 718 `GET /mcp` were 401; client `codex-mcp-client`). It does not say whether
those requests carried an `Authorization` header. So the log-derived counts below are **not
measured**; they are listed as the questions the operator's Mac session must answer (see "Sample
to gather"). Everything else (code paths, spec comparison, behaviour pins) is established from the
source and from `gateway/test/http/mcp-get-401.test.ts`.

## Which branch answers a 401 (gateway/src/http/server.ts)

`GET /mcp` reaches the auth block at server.ts:319-341. Per status:

| Request | Branch | Status |
|---|---|---|
| No `Authorization` header | `offered` false (319); `authenticate` returns undefined (326); not recorded as a failure; discovery limiter `hit` (331) | 401 with `WWW-Authenticate` (338-341), or 429 `too many requests` when the discovery limiter (120 per 60 s per client) is spent |
| Header present, token unknown, malformed, wrong audience | `authenticate` undefined (326), `failedAuth.record` | 401 with the same challenge |
| Header present, token expired (`expiresAt <= now`, oauth/server.ts:211) | same as above | 401, same challenge |
| Header present, but the client already has 10 failures in 60 s | 322-324 | 429 `too many failed attempts` (never 401) |
| Valid token | passes | not 401 |

Consequence: the three 401 causes (no token, expired token, unknown token) produce the **same
bytes**. Neither the response nor the current logs separate them. Access tokens live 1 hour
(`ACCESS_TOKEN_TTL_MS`, oauth/server.ts:17); refresh tokens 30 days. Revocation is read per
request (oauth/server.ts:208), so a revoked grant also gives this 401.

The 429 count in 110 (28 on GET) is consistent with the failed-auth limiter, not only
`PUBLIC_CLIENT_RPS`: a client that sends a stale bearer repeatedly turns 401s into 429s after ten.

## Ranked candidates

1. **Expired access token on a long-lived stream's reconnect (most likely).** An SSE GET is
   authenticated only when it opens. The client holds sessions for minutes to hours and reconnects
   its GET; after the 1 h TTL, the old bearer is refused with a bare 401. For: median GET duration
   0 s and 388 refusals imply many short retries, which fits a client retrying with a token it
   believes valid; the gateway never says the token is expired. Against: 110's sample window was
   1h45m, so only some of it can be explained by a single TTL boundary, and the volume (54 percent
   of GETs) is high for one expiry per grant. Would predict: 401s carry an `Authorization` header,
   cluster after a token's issue time plus 60 min, and stop after a `/token` refresh.
2. **The client opens the SSE GET without a bearer.** `codex-mcp-client` may send the standalone
   GET before attaching credentials, or on a transport object that dropped them. For: the volume
   and the 0 s median fit a probe-and-retry pattern; 401 without `Authorization` is legitimate
   discovery here. Against: nothing in the code distinguishes it, so this is unproven either way.
   Would predict: 401s without `Authorization`, no `/token` call afterward.
3. **The client keeps using a token after a failed refresh or a revoked grant.** For: revocation
   and the 429 failed-auth tail fit. Against: fewer grants are revoked than 388 would need.
4. **Gateway wrongly refuses a good token.** Unlikely: `authenticate` checks only existence,
   expiry, audience (oauth/server.ts:209-211). An audience mismatch is possible if the client
   registered against a different resource URL, and would look like candidate 1 in the logs. The
   pinning test shows a freshly issued token is accepted.

## Is the reply correct per spec?

- MCP Authorization (2025-06-18), "Authorization Server Location" / "Protected Resource Metadata":
  an MCP server "MUST use the HTTP header `WWW-Authenticate` when returning a 401 Unauthorized to
  indicate the location of the resource server metadata URL". The gateway does so (server.ts:338).
- MCP Streamable HTTP, "Listening for Messages from the Server": the client MAY issue a GET; the
  server "MUST either return `Content-Type: text/event-stream` ... or else return HTTP 405". 401 is
  the generic authorization answer, covered by the Authorization section, which says the same
  requirements apply to every HTTP request ("Authorization MUST be included in every HTTP request
  from client to server"). So 401 on an unauthenticated GET is correct.
- RFC 6750 section 3: when a request carried a token that was invalid or expired, the server
  SHOULD include `error="invalid_token"` (with optional `error_description`); a request with no
  credentials "SHOULD NOT include an error code". The gateway sends the bare challenge in both
  cases. This is a SHOULD gap, not a violation, but it matters: a client cannot tell "go
  discover" from "your token expired, refresh it", so a client that treats a bare challenge as
  "start OAuth discovery again" may loop through 401s instead of using its refresh token.
  This is the strongest reason candidate 1 produces many 401s.

## Recommendation

**Add the diagnostic first, then change the reply.** Do not change behaviour blind.

1. *Diagnostic (small, no risk):* on the 401 path in `gateway/src/http/server.ts` (around
   lines 336-341) log one debug line per refusal with only `method`, `hasAuth` (boolean),
   `reason` (`none` | `unknown` | `expired` | `audience` | `revoked`), `hasSession`
   (whether `Mcp-Session-Id` was sent) and the client name. To produce `reason`, `authenticate`
   in oauth/server.ts:207 needs to return the reason; a redacted token is never logged. This
   needs a new task owning both files.
2. *Gateway change, once the sample confirms candidate 1:* send
   `Bearer error="invalid_token", resource_metadata="..."` when a token was offered and rejected,
   keeping the bare challenge for no credentials. Files: server.ts (338-341), oauth/server.ts
   (`authenticate`). Risk: low; clients that ignore the error code are unaffected, and the
   existing oauth tests that match `resource_metadata=` still hold. Do not lengthen the access
   TTL as a workaround.
3. If the sample shows candidate 2 (no header), the answer is no change: 401 plus the challenge
   is the correct discovery reply, and the load is bounded by the discovery limiter.

## Sample to gather (read-only, by the operator's Mac session)

For the same window as 110 (record only whether `Authorization` was present, never its value),
for each 401 `GET /mcp` by `codex-mcp-client`:

- count with an `Authorization` header and count without;
- count that sent `Mcp-Session-Id`, and whether a POST on that session returned 200 within 5 s
  before or after;
- time since the same client's last `/token` call and since its last `initialize`;
- whether a 404 on the same session occurred within 60 s before;
- number of `/token` refresh grants versus 401s in the same window.

The Caddy access log has the header presence and timing if `request>headers` is logged with the
value redacted; the gateway log has `/token`. If Caddy does not record header presence, the
diagnostic in recommendation 1 is the only way to tell "no token" from "bad token".

## Pinned behaviour

`gateway/test/http/mcp-get-401.test.ts` pins: no header gives 401 plus
`Bearer resource_metadata=`; an expired token gives the identical bare challenge (no
`invalid_token`); an unknown token gives the same; a valid token is not refused. If the
recommended change is made, the second and third tests are the ones that flip.
