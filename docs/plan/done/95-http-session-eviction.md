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

## Amendment 1 (Andrew, 2026-10-14)

Local mode skips the per-principal cap (step 1), because every local client shares the principal key `local`. Local mode keeps only the global 16-session cap. At that cap it evicts the least-recently-active idle local session, with the same in-flight protection, instead of refusing. Public mode is unchanged: 4 per principal, 16 per client, 64 global, 10 min idle.
Reason: a fifth local MCP client (for example Claude Desktop plus four Claude Code windows) would otherwise silently evict another live local client.

## Review round 1 — findings

Reviewed HEAD: b3c263a. The first P2 (local mode) is settled by Amendment 1. Routed to the implementer:
- P2: a test for the client-cap eviction path;
- P3: check that every step can be satisfied before evicting anything;
- P3: count a request as in flight before `parseBody`;
- P3: tests for LRU ordering and for the pending-per-principal count.
The NOTEs are not adopted, except the session-server leak when `connect`/`handleRequest` throws: close the server and unsubscribe its hub handlers on that path.

VERDICT: FIX

FINDINGS (most severe first)
- [P2] gateway/src/http/server.ts:424-426 (admit, step 1) — In local mode every client has the principal key `local` (server.ts:159). The per-principal cap of 4 therefore applies to all local clients together, and the local `maxSessions` of 16 can never be reached. When a fifth local MCP client initializes, it silently closes the session of the least-recently-active other local client, even if that client is still live.
  route: orchestrator — the code follows the Decisions as written: step 1 has no mode guard, Principal = `local`, and "Local mode still uses 30 min and 16". The spec contradicts itself. Its stated reason for the cap of 4 ("two Claude Code windows" per grant) assumes one grant per client, but in local mode all clients share one key. Fixing it means choosing a design: skip step 1 in local mode, use a different local principal key, or accept the cap of 4. That is the planner's call.
  input: local mode, default limits. Five clients (for example Claude Desktop and four Claude Code windows) each initialize with the static bearer. → The fifth gets 200. The first client's next POST gets 404 "Session not found", and the log shows `principal=local reason=principal-cap`. On main, all five coexist (cap 16).
- [P2] gateway/test/http/session-eviction.test.ts and gateway/test/http/public.test.ts:228 — No test ever reaches the client-cap eviction path (step 2 succeeding). Disabling it, or removing its client-key filter, leaves the whole suite green. The updated public.test.ts per-client case claims "same principal → 200 with eviction", but that 200 comes from the principal-cap step.
  route: implementer — add a case: 3 other principals × 4 sessions plus principal Q × 1 on IP X, and principal P × 3 on IP X. P initializes from X and expects 200, `reason=client-cap`, and P's oldest X session now 404. Add a second case where P's only idle session is on another IP and expect 503.
  proof: mutation `if (!evictOne(..client-cap)) return false` → `return false`: 40/40 tests still pass. Mutation deleting `if (client !== undefined && e.clientKey !== client) continue;` (server.ts:442): 40/40 pass. With that filter gone, step 2 evicts a session under a different client key, so the client count does not drop and the client key ends up above 16.
- [P3] gateway/src/http/server.ts:425-428 — Step 1 evicts before step 2 can refuse, so the requester loses a session and still gets 503.
  route: implementer — check that every step can be satisfied before evicting anything. The spec's step order and per-step limits stay the same.
  input: principal A holds 4 idle sessions from IP X. IP Y holds 16 sessions of 4 other principals. A initializes from Y. → A's oldest X session is closed (one `principal-cap` log line), then the request gets 503 'too many sessions'.
- [P3] gateway/src/http/server.ts:351-360 — `inFlight` is incremented only after `await this.parseBody`. A POST whose body is still arriving can therefore be evicted, which goes against "a session with a request in flight is never evicted".
  route: implementer — increment before `parseBody` (try/finally around both).
  input: principal a has 4 sessions. 3 have held tools/calls in flight. On the 4th, a POST sends its headers and the first 5 body bytes, then the rest 300 ms later. Meanwhile a new initialize arrives. → initialize 200 with `reason=principal-cap`. The slow POST gets 404 `-32001 Session not found` (proved in a scratch copy). It does not hang.
- [P3] gateway/test/http/session-eviction.test.ts — Two guards are untested: least-recently-active ordering, and counting pending initializes per principal.
  route: implementer — add one case where the principal touches its oldest session, then opens a fifth session, and assert that the second-oldest session is the one that now 404s.
  proof: flipping `e.lastActive < pick[1].lastActive` to `>` (evict the most recently active session): 40/40 pass. Deleting the `pendingByPrincipal.set(...)` increment: 40/40 pass.
- [NOTE] server.ts:356 — Not counting GET as in flight (a scope you asked about). The mutation shows this is required: if GET counts, http.test.ts "replaces the requester own idle session at the cap" fails, because SDK clients (`connect()`) keep a standalone GET SSE stream open, so no SDK session could ever be evicted. The cost is that a client like Claude Code whose only open request is its GET stream can be evicted. That happens only by the same principal (in public mode, the same grant) opening a session beyond 4, and the victim is that principal's least-recently-active session. When evicted, the SSE stream is closed. SDK 1.32.1 `StreamableHTTPClientTransport` does not re-initialize on 404 (no 404 handling in client/streamableHttp.js). Whether Claude Code itself reconnects is unverified. In public mode this is acceptable. In local mode it compounds the first P2.
- [NOTE] server.ts:446-450 — Keys other than `oauth:*` and `local` log as `principal=other` rather than "the part before the first colon". Production only produces oauth or local. This is safer than echoing an arbitrary prefix.
- [NOTE] server.ts:389-399 — These are pre-existing patterns, now extended to the per-principal count. Between `onsessioninitialized` and the `finally`, a new session is counted both in `sessions` and in `pendingByPrincipal`, so concurrent initializes from one principal can cause one extra eviction. If `server.connect` or `transport.handleRequest` throws, the session server is never closed and its hub handlers leak.

Checks that came out clean (the scopes you asked about):
- Cross-principal: `evictOne` filters on exact `principalKey`. The client key only narrows the candidate set and never widens it. `oauth:<grantId>` comes from the server-issued grant, and shared egress IPs cannot reach another grant's sessions. The mutation that drops the principal filter fails 5 tests.
- Hub teardown: one listener per (emitter, event). Unsubscribe is idempotent (`handlers.delete` returns false on the second call). The shared listener is removed when the last handler leaves. DELETE, evict, sweep and transport close all go through `server.onclose`. Throw propagation matches the old per-listener behaviour. Mutations that drop `emitter.off` or the `inFlight` decrement are caught.
- Caps: 4, 16 and 64 interact as the spec orders. Public mode uses 64 and 10 min, and local mode uses 16 and 30 min (app.ts:712-713). `rg "setMaxListeners\((0|Infinity)" gateway/src` finds nothing.
- Log line: built only from fixed literals, an enum reason and a number. It cannot contain a grant, session id, IP or client key.
- The in-flight guard mutation (`|| e.inFlight > 0` removed) fails 1 test.
- ESLint and Prettier are clean on all changed files.
- Flake: gateway/test/bin/invite-cli.test.ts is a pre-existing load flake. Machine load average was 40-70, from other agents' suites. I ran it alone 3 times each, interleaved, on an origin/main build and on this branch. main failed 2 of 3 (`Test timed out in 5000ms`) and the branch failed 0 of 3. In earlier branch-only runs it failed 1 and then 7 as load rose. The diff touches no CLI, store or link code. The full fast suite (`npm test`, which you asked for) ran once on a scratch copy of the branch: 247 files and 4713 tests passed.

SCOPE: clean (every changed path is in Owns. app.ts also gains two import names, which the options-block change needs)

All runs used throwaway copies in the scratchpad, now deleted. The worktree at /Users/Andrew/workspace/foundry-modules/agent-gateway/.claude/worktrees/task-95 was not modified.
