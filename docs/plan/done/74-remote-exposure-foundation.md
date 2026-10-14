# 74 — Lay the remote-exposure foundation: public URL, server mode, host allowlists, per-client limits

**Repo:** .
**Depends on:** 34, 69, 70, 71, 72, 73 (all done)
**Status:** MVP B wave 1, the only task in it. Filed 2026-10-14 from the MVP B re-plan (architect audit plus Andrew's decisions of 2026-10-14). No OAuth here: 35 builds on this. WAL journal mode and the online backup were added the same day, as Andrew agreed.
**Owns:**
- gateway/src/config/index.ts
- gateway/src/bin/cli.ts
- gateway/src/app.ts
- gateway/src/http/** (server.ts, plus new helper files such as `client-key.ts` and `limits.ts`)
- gateway/src/link/server.ts (the Host check, the per-client pending and failed-code buckets, and the pairing-code suppression hooks only)
- gateway/src/link/code-attempts.ts
- gateway/src/link/pairing-codes.ts (a `consumed` reason for `issue` only; T10)
- gateway/src/relay/config.ts
- gateway/src/relay/secondary.ts (the reason text at :268 only)
- gateway/src/mcp/status-tool.ts
- gateway/src/mcp/session.ts (the status listing and the not-connected wording when no pairing code is on offer only)
- gateway/src/routing/binding.ts (the exact-id selector only)
- gateway/src/status/page.ts
- gateway/src/store/store.ts (the journal-mode line in `openStore` only)
- gateway/test/config/**
- gateway/test/http/**
- gateway/test/link/** (new files, plus edits to code-attempts.test.ts and server.test.ts where they assert the old Host or bucket behaviour)
- gateway/test/relay/** (relay config tests: new files, plus edits to tests that build a `RelayConfig` literal)
- gateway/test/mcp/status.test.ts
- gateway/test/routing/exact-selector.test.ts (new)
- gateway/test/store/wal.test.ts and gateway/test/store/backup.test.ts (new)
- gateway/test/app/** and gateway/test/bin/** (new files, plus edits to tests that assert the `--http-host` refusal text)

## Goal
Make it safe to put the gateway behind a reverse proxy on a public host, before any OAuth exists. Add the `--public-url`, `--server-mode`, bind-address and proxy-trust settings; derive Host and Origin allowlists from the public URL; stop handing the pairing code, the static bearer and the connected-user list to anyone on the internet; give each client its own rate and failure buckets so one attacker cannot lock everyone out; and add the seam through which a transport binds an MCP session to a fixed (world, user), which 35 uses for OAuth grants.

## Context
Andrew's decisions, 2026-10-14 (record them in the PR description):
- TLS terminates at a reverse proxy (Caddy or nginx). The gateway stays on 127.0.0.1 behind it and does no TLS itself. 42 ships a Compose file with Caddy.
- With `--public-url` set, the static local HTTP bearer from 34 is OFF. Remote clients use OAuth only (35).
- With `--public-url` set, pairing codes go only to the operator's log and console, never to `gateway_status`, not-connected errors or MCP log notices for any MCP client. `/status` shows only the version and uptime unless the request is authenticated.
- MVP B must be done before the public release; the 0.1.0 draft stays unpublished.
- The SQLite store moves to WAL journal mode, for read concurrency on a VPS, and operators get a backup that is safe while the gateway runs.

Code, verified at origin/main 1a54559:
- gateway/src/config/index.ts:4-8 `ConfigSchema`; :14-18 `ENV_KEYS`; :56-76 `loadConfig` (file, then env, then flags); :79-85 the HTTP limits and `HTTP_BIND_HOST = '127.0.0.1'` (:85).
- gateway/src/bin/cli.ts:17-36 `USAGE`; :116-133 `parseArgs` options; :146-151 refuses any `--http-host` other than 127.0.0.1; :152-155 `--http-rotate-token`; :158-162 `loadConfig` flags; :172-180 `createApp`; :184 `process.stdin.once('end', shutdown)`, which stops a container whose stdin is closed.
- gateway/src/app.ts:
  - :142-143 `relayConfig()`;
  - :148-160 every instance creates an in-process stdio session;
  - :422-431 `linesFor` and `sendNotice`: the pairing code goes out as an MCP `notice` log message to every initialized session (:439 on each new code, :447 on `initialized`);
  - :457-489 the `LinkServer` options (no `host`, no `allowNonLoopback`);
  - :498-515 `sessionOptions`, with `knownIdentities` (:504-509) and `pairingHint` (:511-514);
  - :524-566 `startHttp`: `loadOrCreateToken` (:525), `host: HTTP_BIND_HOST` (:528), `createSession: () => …` (:534), and the token line (:556-562).
- gateway/src/http/server.ts:
  - :40 `LOOPBACK_HOSTS`; :160-166 the Host and Origin checks;
  - :168-185 `/status` renders every connected world, user id and user name to whoever asks;
  - :187-190 the bearer check; :139-143 and :191-194 one global rate window, checked only after a valid token, so failed tokens are never limited;
  - :195-208 an existing session is looked up by `mcp-session-id` alone;
  - :216-218 one global session cap; :221 `createSession()` takes no argument.
- gateway/src/link/server.ts:
  - :55-57 the `host` and `allowNonLoopback` options; :105-109 the bind guard;
  - :141-148 the Host check, skipped entirely when `allowNonLoopback` is set;
  - :155-177 pending-handshake caps per origin (the Origin header is attacker-chosen);
  - :376-379 the failed-code check, one global bucket.
- gateway/src/link/code-attempts.ts:1-29 `CodeAttempts`: 10 failures per 60 s across all origins (Andrew's 70 decision for local mode).
- gateway/src/relay/config.ts:9-14 `RelayConfig`; :16-21 `makeRelayConfig`; :23-41 `parseRelayConfig`; :48-50 `sameSessionConfig`; :58-59 `sameConfig`; :62-76 `describeConfigDiff`. gateway/src/relay/server.ts:288-313 uses them; gateway/src/relay/secondary.ts:268 names only "different allowed origins".
- gateway/src/mcp/status-tool.ts:18 the `gateway_status` description promises the pairing code; :43-46 `statusText` prints it.
- gateway/src/mcp/session.ts:61-64 `pairingClause`; :233 the status listing; :246-259 `notConnected` (code at :247); :283-287 the status result (code at :283).
- gateway/src/routing/binding.ts:4-9 `UserSelector`; :87-89 follow mode is "no user selector"; :226-241 `matching`, where a name match is the fallback after an id match (:237-240).
- gateway/src/status/page.ts:1-5 `StatusView`; :20-36 `renderStatus`.
- gateway/src/store/store.ts:74-84 `openStore`: `busy_timeout = 5000` (:78), then `journal_mode = DELETE` (:79), then migrations (:80). DELETE dates from task 06 (commit 5352816) with no recorded reason.
- gateway/src/bin/cli.ts:60-75 `schemaProblem` opens the db with `{ readOnly: true }` and `busy_timeout = 5000` before `--http-rotate-token` writes through `openStore` (:97-104). A running gateway reads the token hash on every request (gateway/src/http/token.ts:8-12, :31-35).
- Relay secondaries never open the store. app.ts:412-415 opens it only after the link port is held, in `startPrimary` (:493). gateway/test/relay/app.test.ts:18-40 asserts that a secondary's `openStore` is never called. Writers are therefore the primary, plus the one-shot rotate (and `--backup`, which only reads).
- `node:sqlite` exports `backup()` only from Node 22.16 / 23.8. The gateway's engines field allows `>=22.13` (gateway/package.json:13-15). `VACUUM INTO` works on every supported version.
- docs/plan/specs/2026-10-09-agent-gateway.md:79-87 (reach modes), :200-202 (auth), :208-209 (coarse self-protection only; the authoritative limits are in the module).

## Decisions
These are defaults. Follow them unless the PR shows a reason not to, and give that reason in the PR description. Items marked "Andrew" are already decided.
- (a) **Settings.** Each new setting is a `Config` field with a flag and an `ENV_KEYS` entry, so a Compose file needs no command-line arguments (42):

  | Flag | Env | Default | Meaning |
  | --- | --- | --- | --- |
  | `--public-url <url>` | `AGENT_GATEWAY_PUBLIC_URL` | unset | The external origin. `https:` only, except `http:` on a loopback host for local testing (with a warning). No path, query or fragment; a trailing `/` is dropped. Setting it turns HTTP on. |
  | `--server-mode` | `AGENT_GATEWAY_SERVER_MODE` (`1`/`true`) | off | Always-on, many users. No stdio MCP session, stdin end does not stop the process, and HTTP is on. 68 adds operator invites. |
  | `--link-host <addr>` | `AGENT_GATEWAY_LINK_HOST` | `127.0.0.1` | Link bind address. |
  | `--http-host <addr>` | `AGENT_GATEWAY_HTTP_HOST` | `127.0.0.1` | HTTP bind address (replaces the refusal at cli.ts:146-151). |
  | `--trust-proxy` | `AGENT_GATEWAY_TRUST_PROXY` | off | See (c). |
  | `--http` | `AGENT_GATEWAY_HTTP` | off | Existing flag; env added. |
  | `--allow-origin` | `AGENT_GATEWAY_ALLOW_ORIGIN` (comma-separated) | none | Existing flag; env added. |

  A non-loopback `--link-host` or `--http-host` is refused (exit 2, naming the flag) unless `--public-url` is set. When it is accepted, the gateway logs once that TLS must be terminated by a reverse proxy in front of it. The recommended deployment (42) does not use it: Caddy shares the gateway's network namespace and the gateway stays on 127.0.0.1 (Andrew).
- (b) **Host and Origin allowlists.** Allowed Host values are the loopback names (today's set) plus the public URL's host, with its port when the URL has a non-default one. The HTTP server applies this to `Host` and, when present, `Origin` (an `Origin` must be a loopback origin or exactly the public origin). The link server applies it to `Host` always: the check no longer switches off with `allowNonLoopback` (link/server.ts:142). Without `--public-url` behaviour is unchanged.
- (c) **X-Forwarded-\*.** Not trusted by default. `X-Forwarded-Host` and `X-Forwarded-Proto` are never read: the proxy must forward the original `Host` (Caddy does by default; nginx needs `proxy_set_header Host $host`, which 43 documents). With `--trust-proxy`, and only when the TCP peer is a loopback address, the client key for the limits in (e) is the right-most `X-Forwarded-For` entry. Otherwise the client key is the TCP peer address. Without `--trust-proxy` behind a proxy every client shares one key, and the global backstops still hold.
  - **Client key normalization (F7).**
    - An IPv4-mapped IPv6 address (`::ffff:a.b.c.d`) is keyed as the IPv4 address, so `::ffff:127.0.0.1` counts as loopback, both for the `--trust-proxy` peer check and for the Host and bind rules.
    - Any other IPv6 address is keyed by its /64 prefix (one subscriber usually holds a whole /64, so per-address buckets would be free to rotate).
    - `::1` is loopback.
    - A malformed `X-Forwarded-For` entry falls back to the TCP peer's key.
  - **Shared-bucket warning.** With `--public-url` set and `--trust-proxy` off, startup logs one warning: "--trust-proxy is off: if a reverse proxy is in front, every client shares one rate-limit bucket".
- (d) **What a public gateway hides.** With `--public-url` set:
  - `pairingHint` is not passed to sessions (app.ts:511-514), so `gateway_status` and not-connected errors carry no code. Their text says to ask the gateway operator for a pairing code. The `gateway_status` description (status-tool.ts:18) no longer promises a code.
  - `sendNotice` is off (app.ts:428-431, :439, :447). The operator lines from `writeStatus` (:438, :466-474) stay.
  - `/status` renders only the version and uptime unless the request carries credentials that the HTTP authenticator accepts (see (f)). Until 35 lands nothing is accepted, so it is always minimal.
  - The static bearer is off: no token is loaded or created (app.ts:525), a static token on `/mcp` gets 401, and startup logs one line: "HTTP bearer token is off because --public-url is set; remote clients sign in with OAuth". A stored hash from earlier local runs is ignored, not deleted. `--http-rotate-token` together with `--public-url` (flag or env) exits 2 with a message that names both.
  - **Code supply (T10).** Today a consumed code is not replaced until something asks (pairing-codes.ts, `consume` at :94, `issue` at :57), and with `--public-url` nothing asks, because the MCP hint is off. So with `--public-url`, a successful code pairing calls `issue('consumed')` (through a `LinkServer` `onCodePaired` hook wired in app.ts). The new code goes only to the operator log. In server mode, 68 later turns the shared code off and uses invites instead.
- (e) **Per-client limits.** Client key as in (c). Every map is bounded (named cap, oldest evicted), so memory does not grow with the number of attackers.
  - HTTP, every mode: failed authentication is counted per client key, and a client at `MAX_FAILED_AUTH_PER_CLIENT` (10 per 60 s) gets 429 with `retry-after` before the token is checked. This fixes failed tokens never being limited (server.ts:187-194).
  - HTTP, public mode: the request rate (`PUBLIC_CLIENT_RPS`, 10) and the session cap (`MAX_HTTP_SESSIONS_PER_CLIENT`, 4) are per client key. The global window (`SELF_PROTECT_RPS`, config/index.ts:81) and `MAX_HTTP_SESSIONS` (:82) stay as backstops. Local mode keeps today's numbers.
  - Link, public mode: failed pairing codes are counted per client key (`MAX_FAILED_CODE_ATTEMPTS_PER_CLIENT`, 5 per 60 s). The global `CodeAttempts` stays as a backstop at `MAX_FAILED_CODE_ATTEMPTS_PUBLIC` (**300 per 60 s**), so one attacker cannot lock everyone out.
    - The reasoning is guess space against the window. 300 per minute is 432,000 guesses a day. In public non-server mode the one shared code has 8 characters from a 31-letter alphabet (31^8 ≈ 8.5 × 10^11) and lives 10 min, so 3,000 guesses per code give about 3.5 × 10^-9 per code, or about 5 × 10^-7 a day.
    - Server mode uses 68's 12-character invites (31^12 ≈ 7.9 × 10^17): even 100 live 24 h invites give about 5.5 × 10^-11 a day.
    - Against that, a backstop of 60 per minute would let a dozen /64 prefixes at 5 per minute lock everyone out. At 300 it takes 60. Local mode keeps 10 per 60 s globally (Andrew, task 70). Pre-hello sockets are also capped per client key (`MAX_PENDING_PER_CLIENT`, 4), next to the per-origin cap.
- (f) **The per-session selector seam.** `HttpServerOptions` gains an `authenticate(req): HttpPrincipal | undefined` hook. In local mode it wraps today's `token.verify`, and in public mode nothing is accepted until 35 adds OAuth. An `HttpPrincipal` is `{ key: string; selector?: { worldId: string; userId: string } }`. `createSession` becomes `createSession(ctx: { principal: HttpPrincipal })`. app.ts builds the session with `selector: { world, user, exactId: true }` from `ctx.principal.selector` when one is set, else `deps.selector` as today. Each HTTP session remembers the principal key that created it. A request whose principal key differs is answered like an unknown session (404), so a session id never works with another credential. `UserSelector` gains `exactId?: boolean`: when set, `matching` (binding.ts:226-241) never falls back to a name match.
- (g) **Relay config.** `RelayConfig` gains `publicUrl` (`''` when unset) and `serverMode`. Both are session-affecting: they decide what a relayed session may see, like `allowOrigins`, so they join `sameSessionConfig`. `linkHost`, `httpHost` and `trustProxy` join `sameConfig` as session-neutral, like `httpPort`. `parseRelayConfig` reads a missing field as off or `''`, so an older peer still parses. `describeConfigDiff` names each field. The secondary's reason text (secondary.ts:268) says "different session settings" and lists them through `describeConfigDiff`.
- (h) **Migration numbers (MVP B).** `gateway/src/store/migrations/index.ts` is a positional array: a migration's number must equal its position when it merges. Reserved, in merge order: **010 for 35** (OAuth clients, codes, tokens and grants; wave 2), **011 for 68** (the `invites` table for operator invites; wave 3), **012 for 38** (headless agents; wave 4). 38 moved from 011 to 012 on 2026-10-14 because 68 lands first. 67 needs no migration, because its grants live in 010. If 67 or any other task finds it needs one, it stops and reports before writing it. 74 adds no migration.

- (i) **WAL.** `openStore` sets `PRAGMA journal_mode = WAL` instead of DELETE, keeps `busy_timeout = 5000` first, and checks the mode the pragma returns. If it is not `wal`, for example on a filesystem without shared memory, it logs one warning and carries on in the returned mode. WAL is persistent in the file. An older binary that sets DELETE converts the file back, and this one converts it again, so a downgrade still works. The `-wal` and `-shm` files sit next to the db in the 0700 state dir.
  - Rotate: the read-only schema check (cli.ts:64) must still work against a WAL db, both while a gateway holds it and when none does. The rotated hash must be visible to the running gateway's next request.
  - Secondaries: unchanged. They never open the db.
  - A step-down (72) closes the store, which checkpoints. The new primary opens it with no data lost.
- (j) **Online backup.** `foundry-agent-gateway --backup <path>` is a one-shot command like `--http-rotate-token`.
  - It opens the db read-only after the same schema check (cli.ts:60-75), so it never migrates, and refuses `:memory:`.
  - It writes a consistent copy with `VACUUM INTO '<path>'`. This works on every supported Node, and in WAL it does not block the running gateway's writes.
  - The target is created with mode 0600. An existing target is refused (exit 1, naming it), and nothing is partly written on failure.
  - It prints the path and size and exits 0.

  42's operator README documents it (`docker compose exec gateway … --backup /data/backups/<date>.db`), with stopping the stack and copying `/data` as the alternative. `sqlite3 .backup` also works, but the image does not ship the `sqlite3` binary.

## Acceptance
Settings:
- [ ] Every setting in decision (a) loads from its flag, its env key and the 0600 config file, with the existing precedence. `gateway/test/config/**` covers each, including `AGENT_GATEWAY_ALLOW_ORIGIN` with two comma-separated origins and `AGENT_GATEWAY_SERVER_MODE=1`.
- [ ] `--public-url` is refused (exit 2, with the reason) for: a non-URL; `http:` on a non-loopback host; a path other than `/`; a query or fragment. `https://gw.example.com/` normalizes to `https://gw.example.com`.
- [ ] `--http-host 0.0.0.0` without `--public-url` exits 2 naming the flag. With `--public-url` it binds, and stderr has one line saying TLS must be terminated by a reverse proxy. The same holds for `--link-host`, and app.ts passes `host` and `allowNonLoopback` to `LinkServer`.
- [ ] `--server-mode` with stdin closed: the process stays up, serves `GET /status` over HTTP, has no stdio MCP session, and exits 0 on SIGTERM (a `gateway/test/bin/**` test).
- [ ] `--help` lists every new flag.

Host, Origin and proxy:
- [ ] HTTP with `--public-url https://gw.example.com`: `Host: gw.example.com` gets past the Host check; `Host: evil.example` gets 403; `Origin: https://gw.example.com` passes and `Origin: https://evil.example` gets 403. Without `--public-url`, the existing loopback tests pass unchanged.
- [ ] Link with `--public-url` and `allowNonLoopback`: an upgrade with `Host: gw.example.com` is accepted, and one with `Host: evil.example` is refused with `host header is not loopback` (the reason text may be renamed). The Host check runs even when `allowNonLoopback` is set.
- [ ] Without `--trust-proxy`, a request with `X-Forwarded-For: 203.0.113.9` from 127.0.0.1 is keyed as 127.0.0.1. With `--trust-proxy`, the same request is keyed as 203.0.113.9. From a non-loopback peer the header is ignored either way. `X-Forwarded-Host` never changes the Host decision (test).
- [ ] Client keys: `2001:db8:1:2::a` and `2001:db8:1:2::b` share one key, and `2001:db8:1:3::a` gets another; `::ffff:203.0.113.9` and `203.0.113.9` share one key; a peer of `::ffff:127.0.0.1` with `--trust-proxy` is treated as loopback and its `X-Forwarded-For` is used (tests).
- [ ] With `--public-url` and no `--trust-proxy`, stderr has the shared-bucket warning exactly once; with `--trust-proxy` it does not (test).

Hiding:
- [ ] With `--public-url`: `gateway_status` while not connected has no `pairingCode` or `codeExpiresInMin`, and its text matches `/operator/`; a tool call while not connected returns `WORLD_OFFLINE` with no code; no MCP `notifications/message` with logger `pairing` is sent to an HTTP or stdio session; the code still appears on stderr. Without `--public-url` the existing status tests pass unchanged.
- [ ] With `--public-url`, unauthenticated `GET /status` returns 200 with the version and uptime, and the body contains no world id, user id or user name of a connected FakeModule (test). Local mode still lists them.
- [ ] With `--public-url`, after a FakeModule pairs with the live code, a new code line appears on stderr within 1 s, and it pairs a second FakeModule; no MCP session receives either code (T10, test).
- [ ] With `--public-url`, a POST to `/mcp` carrying the token from the store gets 401. The startup log has the "bearer token is off" line and no `HTTP bearer token (shown once` line. `--http-rotate-token` with `AGENT_GATEWAY_PUBLIC_URL` set exits 2.

Limits:
- [ ] Eleven requests with a wrong bearer from one client key within 60 s: the 11th gets 429 with `retry-after`, and a request from a second client key still gets 401, not 429 (tests use an injectable clock).
- [ ] Public mode: a client key at `MAX_HTTP_SESSIONS_PER_CLIENT` gets 503 on a new `initialize` while another key can still open one. A key over `PUBLIC_CLIENT_RPS` gets 429 while another key is served.
- [ ] Public mode, link: after 5 wrong codes from one client key, that key gets `RATE_LIMITED` and a valid code from another key still pairs (the valid code is not spent by the limited key). After 300 failures in 60 s across keys, every key gets `RATE_LIMITED`. Local mode keeps the 10-per-60 s global rule (the existing code-attempts tests pass).
- [ ] Every per-client map has a named cap, and a test inserts cap + 100 keys and asserts the size never exceeds the cap.

Seam:
- [ ] A test authenticator returns `{ key: 'a', selector: { worldId: 'w1', userId: 'u1' } }`. With FakeModules for (w1,u1) and (w1,u2) connected, the HTTP session's `world_info` reaches u1 only. With only u2 connected it gets `WORLD_OFFLINE`, never u2's connection.
- [ ] The same session id sent with a principal whose key is `'b'` gets 404 `unknown session`.
- [ ] With `exactId: true`, a user whose recorded name equals the selector's user id string is not matched (gateway/test/routing/exact-selector.test.ts).

Relay:
- [ ] Two instances that differ only in `publicUrl` (or only in `serverMode`) are not served by each other's relay, and the newer one makes the older step down. Two that differ only in `trustProxy` are served. `parseRelayConfig` of a config object without the new fields returns them as off or `''` (tests under gateway/test/relay/).

Store:
- [ ] gateway/test/store/wal.test.ts:
  - after `openStore`, `PRAGMA journal_mode` returns `wal`;
  - a second read-only connection reads a committed pairing while the first holds an open write transaction, without `SQLITE_BUSY`;
  - the `--http-rotate-token` path (schema check plus write) succeeds against a WAL db that a running `openStore` holds, and that store's `getHttpTokenHash()` returns the new hash at once;
  - the schema check also succeeds when no other connection is open and the `-wal`/`-shm` files are absent;
  - a db file created in DELETE mode by the current main code opens in WAL with its rows intact.
- [ ] The existing gateway/test/relay/app.test.ts "never opens the db in a secondary" test still passes unchanged.
- [ ] gateway/test/store/backup.test.ts:
  - `--backup <tmp>/b.db` while a gateway process holds the db produces a file that `openStore` opens, with the same pairings and `gateway_settings` rows;
  - the file mode is 0600 (skipped on win32);
  - an existing target exits 1 and is left unchanged;
  - a db behind the current schema exits 1 with the "start the gateway once" message and is not migrated;
  - `:memory:` exits 2.
- [ ] `--help` lists `--backup`.

Overall:
- [ ] `npm run verify` passes.
- [ ] `git diff --stat main` lists only files in Owns.
- [ ] No test binds 7420 or 7421 or touches ~/.foundry-agent-gateway.

## Out of scope
- OAuth, its endpoints and the authenticator that accepts OAuth tokens (35).
- Server-mode operator invites (68). In 74, `--server-mode` only changes process lifetime, stdio and HTTP.
- The Dockerfile, Compose file and Caddyfile (42).
- Doing TLS in the gateway.
- Any migration (decision h). WAL is a pragma, not a migration.
- Scheduled or automatic backups, and restore tooling. Restore is "stop the stack, replace the file", which 42's README documents.
- Docs: README, guides, docs/security.md (43). Adding the new env keys to docs is scribe or 43 work.
- Changing the local-mode limits that 34 and 70 set.
- Headless agents (37, 38).

## Outcome

Done 2026-10-14 on branch `claude/task-74` (HEAD 51a12cd, based on main 3619598). Tester PASS at 40b1d33: verify twice (4161 fast, 2227 slow), the 8 new test files 3/3 each, scripts, mcpb and conformance (stdio and http), and the real gateway untouched. Reviewer APPROVE at 40b1d33. The reviewer ran 18 mutations; 16 were killed and 2 survived: the failed-auth ordering with a valid credential at the limit, and `MAX_PENDING_PER_CLIENT` masked by the per-origin cap. Follow-up 51a12cd killed both (checked by running against the mutants), added a startup warning for an `http:` public URL on loopback, and made public mode fail closed: a principal without a selector gets 403 at initialize and `createSession` throws, with no fallback to `deps.selector` or follow mode. Verify then passed at 4164 + 2227, and the 3 changed files passed 30/30.

Threat-map rows closed by 74 (also marked in `docs/plan/mvp-b-threats.md`): T10 (consumed-code re-issue to the operator log), T11 (per-client keys, IPv6 /64 keying, global backstop; the distributed-flood residual stays accepted), T14 (OAuth binds by id; the selector is exact-id), T22 (right-most X-Forwarded-For from a loopback peer only). Rows that depend on later tasks (T7, T8, T19, T20, T21) are unchanged.

Deviations accepted by review:
- `HttpServerOptions.token` stays as a back-compat option, alongside a new `authenticate` hook.
- Public `/status` does not record auth failures.
- Config booleans accept 1/true/yes/on; `ConfigError.exitCode` is 2 for refused and 1 for bad.
- HTTP is switched on automatically in public or server mode.
- `localhost` counts as non-loopback for bind checks, so it fails closed.
- `openStore` takes a `warn` parameter.
- `||` fallbacks cover partial test configs.
- Server mode exits instead of degrading on EADDRINUSE or a database lock.
- Commit 859f7b1 repeats b3e3805's message (cosmetic; it only edits `test/http/cli.test.ts`).
- Peer relay strings are truncated to 300 characters and sanitised.

Notes for task 35: public `/status` calls `authenticate` with no failure count or rate limit, so 35 must add both once OAuth authenticates it. Every OAuth principal must carry a selector, because 74 now fails closed without one.

### Review round 2 (external, PR #120)

P2, routed to the implementer (in spec, :91-94): the link Host check refused `[::1]:<port>`, so `--link-host ::1` could not pair. Fixed in 4966628 by accepting `[::1]:<bound port>` only; HTTP already accepted it, and a test now pins that. Verify passes (4166 + 2227 tests). A code-reviewer re-review of 71d73d5..HEAD came back CLEAN with no drift, and a mutation proof showed the new link test fails without the fix.
