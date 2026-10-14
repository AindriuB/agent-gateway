# 95 — Evict a principal's own stale HTTP sessions instead of refusing new ones

**Repo:** .
**Depends on:** none
**Owns:**
- gateway/src/http/server.ts
- gateway/src/http/limits.ts (session-limit constants only)
- gateway/src/config/index.ts (the HTTP session constants next to `MAX_HTTP_SESSIONS` only)
- gateway/src/app.ts (the `new HttpServer({...})` options block only: session cap, idle timeout, log hook)
- gateway/src/mcp/session.ts (the shared-emitter subscribe/unsubscribe block, about :540-582, only)
- gateway/src/mcp/session-hub.ts (new, only if the fan-out option below is chosen)
- gateway/test/http/session-eviction.test.ts (new)
- gateway/test/mcp/session-listeners.test.ts (new)
- gateway/test/http/public.test.ts (the "caps sessions per client key in public mode" case only)
- gateway/test/http/http.test.ts (the `maxSessions: 2` case near :163 only)

## Goal
gw.aindriub.app (0.1.1) fails after about 5 ChatGPT tool calls. The ChatGPT connector (UA
`openai-mcp/1.0.0 (Codex)`, source IPs rotating within 9.129.58.0/24) sends a fresh `initialize`
for every call and never sends DELETE. Abandoned sessions fill `MAX_HTTP_SESSIONS_PER_CLIENT` (4)
or `MAX_HTTP_SESSIONS` (16) and stay there for the 30-minute idle timeout, so every later
initialize gets 503 'too many sessions', which ChatGPT shows as -32603. Fix it this way. When a
new initialize would exceed a cap, close the least-recently-active idle session that belongs to the
same principal, then admit the new one. Refuse only when the cap is full of other principals'
sessions. Session open and close must also leave the shared emitters' listener counts where they
started, which ends the MaxListenersExceededWarning on `LinkRegistry`, `ToolsetStore` and
`EventBuffer`.

## Decisions (fixed by this task; implement as written)
- **Principal = `HttpPrincipal.key`.** This is `oauth:<grantId>` in public mode
  (`gateway/src/oauth/server.ts:209`) and `local` for the static bearer
  (`gateway/src/http/server.ts:~150`). A grant is the unit a Foundry user consented to and can
  revoke. Keying by grant instead of (world, user) means a user's ChatGPT grant can never close the
  same user's live Claude session.
- **Only the requesting principal's own sessions are ever eviction candidates.** The client key
  decides which cap binds. It never widens the candidate set. OpenAI egress IPs are shared by many
  ChatGPT users, so evicting "by client key" would let one tenant close another tenant's sessions.
- **A session with a request in flight is never evicted.** Track a per-entry in-flight counter
  around `transport.handleRequest`. If every candidate is in flight, answer 503.
- **Admission order** (pending initializes count toward each total, as they do today):
  1. If the principal's sessions are at or over `MAX_HTTP_SESSIONS_PER_PRINCIPAL`, evict that
     principal's least-recently-active idle session (any client key).
  2. In public mode, if the client key's sessions are at or over `MAX_HTTP_SESSIONS_PER_CLIENT`,
     evict the principal's least-recently-active idle session *under that client key*. If there is
     none, answer 503 'too many sessions'.
  3. If the total is at or over `maxSessions`, evict the principal's least-recently-active idle
     session. If there is none, answer 503 'too many sessions'.
  Each step evicts at most one session, so one initialize closes at most three.
- **Numbers.**
  - `MAX_HTTP_SESSIONS_PER_PRINCIPAL = 4` (new, `limits.ts`). This allows a few concurrent
    long-lived sessions per grant, for example two Claude Code windows. With eviction it no longer
    has to cover clients that never close sessions.
  - `MAX_HTTP_SESSIONS_PER_CLIENT = 16` (was 4). It becomes the outer flood bound per IP or /64.
    It must allow several principals behind one shared egress IP (4 principals at full quota). It
    no longer limits a single client, because the per-principal cap and eviction do that.
  - `MAX_HTTP_SESSIONS_PUBLIC = 64` (new, `config/index.ts`). Public mode uses it for `maxSessions`.
    That is 16 principals at full quota, enough for the MVP B friend test, and each session is one
    `McpServer` plus O(1) listeners. `MAX_HTTP_SESSIONS = 16` stays as the local-mode cap.
  - `PUBLIC_HTTP_SESSION_IDLE_MS = 10 * 60_000` (new, `config/index.ts`), used for `idleMs` in
    public mode. Local mode keeps `HTTP_SESSION_IDLE_MS` (30 min). Why 10 minutes: an abandoned
    public session holds a slot and a session server until the sweep runs. Clients that never
    DELETE are the norm on the public path. Streamable HTTP clients must re-initialize on 404, so
    expiring a session that is truly idle costs one handshake. 10 minutes is still well above the
    gap between calls in an active chat. `deps.httpLimits` overrides still win, so tests can
    shorten it.
- **Eviction log.** Write exactly one line per evicted session through a new optional
  `HttpServerOptions.log?: (line: string) => void` hook, which `app.ts` wires to the existing
  logger at info level. Use this format:
  `http session evicted: principal=<kind> reason=<principal-cap|client-cap|global-cap> idle_ms=<n>`.
  `<kind>` is the part of the principal key before the first `:` (`oauth`, `local`). The line never
  contains a grant id, token, session id, IP or client key.
- **Teardown.** An evicted session is removed from `sessions` and closed with `server.close()`.
  That fires the session server's `onclose` (`gateway/src/mcp/session.ts:572-580`), which must
  remove every listener the session added. Choose one of two fixes for the warning. The preferred
  one is a fan-out: one subscription per shared emitter, held by a small hub, that dispatches to
  the live sessions, so emitter listener counts do not grow with the session count. If you keep
  per-session listeners instead, `setMaxListeners` may only be set to a value derived from the
  session cap constant. Never 0 or Infinity, and never as the only change.

## Context
- gateway/src/http/server.ts:336-404 — the session lookup, the 503 checks at :363-367,
  `onsessioninitialized`, `transport.onclose` and `clientSessions`
- gateway/src/http/server.ts:209-217 — `sweep()`, the existing close path to reuse for eviction
- gateway/src/http/limits.ts:5 — `MAX_HTTP_SESSIONS_PER_CLIENT`
- gateway/src/config/index.ts:203-207 — `MAX_HTTP_SESSIONS`, `HTTP_SESSION_IDLE_MS`
- gateway/src/app.ts:672-712 — the HTTP wiring, including `track()` at :487-499, which also
  wraps `onclose`
- gateway/src/mcp/session.ts:540-582 — the per-session `on`/`off` on registry, toolsets and events
- gateway/src/events/buffer.ts:21, gateway/src/link/registry.ts:105,
  gateway/src/routing/toolsets.ts:15 — the three emitters (read only)
- gateway/test/http/public.test.ts:28-60, :228-240 — the rig, with `authenticate` and
  `x-forwarded-for` under `trustProxy`, and the per-client cap test that this task changes
- docs/conventions.md — test naming and the fast/slow split

## Acceptance
- [ ] `session-eviction.test.ts`: in public mode with `trustProxy`, one principal opens 20
      sessions one after another. It never sends DELETE, and each request's `x-forwarded-for`
      rotates through 9.129.58.1-9.129.58.20. Every initialize returns 200 and every follow-up
      `tools/call` on the new session succeeds. Afterwards `sessionCount` is ≤ 4.
- [ ] The same 20-session run from one fixed IP (no rotation) also gives 20 successes.
- [ ] Principal B opens 2 sessions, then principal A opens 20 from B's IP. All of B's session ids
      still answer a `tools/call` with 200, and no eviction log line is written for B.
- [ ] Global cap, public mode: with `maxSessions: 8`, eight distinct principals each open one
      session. A ninth principal's initialize gets 503 'too many sessions', `sessionCount` stays
      8, and none of the eight sessions is closed.
- [ ] Global cap, own session: when the cap is full and the requester holds one idle session, the
      initialize returns 200, `sessionCount` does not exceed `maxSessions`, and the requester's
      older session id now answers 404.
- [ ] Per-client bound: with 16 sessions from one IP held by 4 other principals, a fifth
      principal's initialize from that IP gets 503. The same principal from a different IP gets 200.
- [ ] A session with a request in flight is not evicted. Hold a `tools/call` open with a tool that
      does not resolve until released. A new initialize that would otherwise evict it gets 503 if
      it is the only candidate, and the held call then completes with 200.
- [ ] Each eviction writes exactly one log line matching
      `/^http session evicted: principal=(oauth|local) reason=(principal-cap|client-cap|global-cap) idle_ms=\d+$/`.
      A test asserts that the line does not contain the grant id, the session id or the IP.
- [ ] `session-listeners.test.ts` uses a real `LinkRegistry`, `ToolsetStore` and `EventBuffer`.
      It records `listenerCount` for `connected`, `disconnected` and `changed` on each, runs 50
      cycles of open → evict, then 50 of open → DELETE, then 50 of open → idle sweep, and asserts
      every count equals its baseline.
- [ ] Opening `MAX_HTTP_SESSIONS_PUBLIC` sessions at once emits no `MaxListenersExceededWarning`.
      The test watches `process.on('warning')`.
- [ ] `rg -n "setMaxListeners\((0|Infinity)" gateway/src` returns nothing.
- [ ] Public mode uses `PUBLIC_HTTP_SESSION_IDLE_MS` (10 min) and `MAX_HTTP_SESSIONS_PUBLIC` (64).
      Local mode still uses 30 min and 16. A test in `session-eviction.test.ts` or by `app.ts`
      inspection, cited in the PR, shows this.
- [ ] The updated `public.test.ts` per-client case and `http.test.ts` `maxSessions: 2` case assert
      the new behaviour: same principal → 200 with eviction; other principals filling the cap → 503.
- [ ] `npm run verify` passes.

## Out of scope
- Tasks 91 and 92 files: `gateway/src/bin/cli.ts` and its tests, protocol messages,
  `gateway/src/link/invite-admin.ts`, `gateway/src/link/server.ts`, `gateway/src/link/invites.ts`,
  `gateway/src/store/store.ts` and `gateway/src/link/revocation.ts`.
- The stdio relay's sessions (`gateway/src/relay/server.ts`), apart from them inheriting the
  `session.ts` teardown.
- The per-client RPS, discovery and failed-auth buckets, and how `clientKey` derives keys
  (`client-key.ts`). Do not key by /24.
- `docs/architecture.md` and `PLAN.md`. The scribe records the new limits.
- Making the limits configurable by flag or env var.
- The ChatGPT plugin (84) and the redeploy to gw.aindriub.app.
