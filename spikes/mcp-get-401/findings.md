# Spike 156: why does ChatGPT get 401 on `GET /mcp`?

## Status of the evidence (read this first)

The acceptance asks for counts from the deployed gateway log and the Caddy access log. This spike
ran in a worktree with no access to either log. The orchestrator later gathered a read-only sample
from the hosted gateway's Caddy access logs (see "Log sample" below); it answers the question of
whether the 401s carried a token. Everything else (code paths, spec comparison, behaviour pins) is
established from the source and from `gateway/test/http/mcp-get-401.test.ts`.

## Log sample (hosted gateway Caddy access logs, last 96 h, gathered 2026-10-19)

Read-only, counts only; no header values were read or printed.

`/mcp` by method and status:

| Method | Status: count |
|---|---|
| GET | 401: 2333, 200: 97, 404: 38, 429: 43, 308: 3, no status (cancelled): 91 |
| POST | 200: 781, 202: 136, 401: 533, 400: 20, 429: 57, 404: 2 |
| DELETE | 200: 108, 401: 4, 404: 1 |

Of the 2333 GET 401s:

- 2331 had NO `Authorization` header; only 2 had one.
- 2327 had no `Mcp-Session-Id`.
- The user agent was `codex-mcp-client` for all 2333.
- For the 2 that carried a header, the time since the same client IP's last successful POST to the
  token endpoint was under 55 min for one and 55-65 min for the other.

**Conclusion.** The 401s are ChatGPT's client opening the GET stream without a bearer token, not
token expiry. This is candidate 2 below, and the earlier "most likely" ranking of candidate 1
(expired token) is superseded: only 2 of 2333 offered a token, so expiry explains at most 2. By
this document's own rule ("if the sample shows no header was sent, make no change"), the
recommendation is no gateway change. At most, optionally make the discovery 401 cheaper or quieter.

## Which branch answers a 401 (gateway/src/http/server.ts)

`GET /mcp` reaches the auth block at server.ts:319-341. Per status:

| Request | Branch | Status |
|---|---|---|
| No `Authorization` header | `offered` false (319); `authenticate` returns undefined (326); not recorded as a failure; discovery limiter `hit` (331) | 401 with `WWW-Authenticate` (337-341), or 429 `too many requests` when the discovery limiter (120 per 60 s per client) is spent |
| Header present, token unknown, malformed, wrong audience | `authenticate` undefined (326), `failedAuth.record` | 401 with the same challenge |
| Header present, token expired (`expiresAt <= now`, oauth/server.ts:211) | same as above | 401, same challenge |
| Header present, but the client already has 10 failures in 60 s | 322-324 | 429 `too many failed attempts` (never 401) |
| Valid token | passes | not 401 |

Consequence: the three 401 causes (no token, expired token, unknown token) produce the **same
bytes**. Neither the response nor the current logs separate them. Access tokens live 1 hour
(`ACCESS_TOKEN_TTL_MS`, oauth/server.ts:17); refresh tokens 30 days. Revocation is read per
request (oauth/server.ts:208), so a revoked grant also gives this 401.

A 429 on `GET /mcp` has three possible sources: the failed-auth limiter (bearer present, 10
failures in 60 s, server.ts:322-324), the discovery limiter (no bearer, server.ts:331-335), and
`PUBLIC_CLIENT_RPS` (authenticated requests only). Which one fired is a hypothesis until the 429
body text is read: `too many failed attempts` is the failed-auth limiter and `too many requests`
is the discovery limiter. The log sample below shows 43 GET 429s; most are plausibly the
discovery limiter, given that almost all GET 401s had no bearer, but the body text is not yet
checked.

## Ranked candidates

1. **Expired access token on a long-lived stream's reconnect (ruled out as the main cause by the log sample: 2 of 2333).** An SSE GET is
   authenticated only when it opens. The client holds sessions for minutes to hours and reconnects
   its GET; after the 1 h TTL, the old bearer is refused with a bare 401. For: median GET duration
   0 s and 388 refusals imply many short retries, which fits a client retrying with a token it
   believes valid; the gateway never says the token is expired. Against: 110's sample window was
   1h45m, so only some of it can be explained by a single TTL boundary, and the volume (54 percent
   of GETs) is high for one expiry per grant. Would predict: 401s carry an `Authorization` header,
   cluster after a token's issue time plus 60 min, and stop after a `/token` refresh.
2. **The client opens the SSE GET without a bearer (confirmed by the log sample: 2331 of 2333).** `codex-mcp-client` may send the standalone
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
  indicate the location of the resource server metadata URL". The gateway does so (server.ts:337).
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

**No gateway change.** The log sample shows the 401s are mostly bearer-less discovery GETs, for
which 401 plus the challenge is the correct reply (recommendation 3). The items below are kept for
the record; 1 and 2 apply only if a future sample shows rejected tokens in volume. Optionally, make
the discovery 401 cheaper or quieter.

1. *Diagnostic (small, no risk):* on the 401 path in `gateway/src/http/server.ts` (around
   lines 336-341) log one debug line per refusal with only `method`, `hasAuth` (boolean),
   `reason` (`none` | `unknown` | `expired` | `audience` | `revoked`), `hasSession`
   (whether `Mcp-Session-Id` was sent) and the client name. To produce `reason`, `authenticate`
   in oauth/server.ts:206 needs to return the reason; a redacted token is never logged. This
   needs a new task owning both files.
2. *Gateway change, once the sample confirms candidate 1:* send
   `Bearer error="invalid_token", resource_metadata="..."` when a token was offered and rejected,
   keeping the bare challenge for no credentials. Files: server.ts (337-341), oauth/server.ts
   (`authenticate`). Risk: low; clients that ignore the error code are unaffected, and the
   existing oauth tests that match `resource_metadata=` still hold. Do not lengthen the access
   TTL as a workaround.
3. If the sample shows candidate 2 (no header), the answer is no change: 401 plus the challenge
   is the correct discovery reply, and the load is bounded by the discovery limiter.

## Sample to gather (remaining, optional)

The main question (header present or not) is answered above. If further detail is wanted, for the
same window as 110 (record only whether `Authorization` was present, never its value),
for each 401 `GET /mcp` by `codex-mcp-client`:

- count with an `Authorization` header and count without;
- count that sent `Mcp-Session-Id`, and whether a POST on that session returned 200 within 5 s
  before or after;
- time since the same client's last `/token` call and since its last `initialize`;
- whether a 404 on the same session occurred within 60 s before;
- number of `/token` refresh grants versus 401s in the same window;
- the 429 response body text (`too many failed attempts` versus `too many requests`), which tells
  the failed-auth limiter, the discovery limiter and `PUBLIC_CLIENT_RPS` apart.

The Caddy access log has the header presence and timing if `request>headers` is logged with the
value redacted; the gateway log has `/token`. If Caddy does not record header presence, the
diagnostic in recommendation 1 is the only way to tell "no token" from "bad token".

## Pinned behaviour

`gateway/test/http/mcp-get-401.test.ts` pins: no header gives 401 plus
`Bearer resource_metadata=`; an expired token gives the identical bare challenge (no
`invalid_token`); an unknown token gives the same; a valid token is not refused. If the
recommended change is made, the second and third tests are the ones that flip.
