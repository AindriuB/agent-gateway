# 35b — Add a metadata-only, hash-chained gateway audit trail of MCP calls and auth events

**Repo:** .
**Depends on:** 34, 35
**Status:** Deferred beyond B. Lands after 71: 71 takes migration 008 (this task takes the next free number) and edits `session.ts` and `app.ts`, which this task then only inserts into.
**Owns:**
- gateway/src/audit/**
- gateway/test/audit/**
- docs/audit-trail.md
- gateway/src/store/migrations/NNN-audit-trail.ts (new file; next free number at merge)
- gateway/src/store/migrations/index.ts (insertions only: one import, one array entry)
- gateway/src/mcp/session.ts (insertions only: an optional `audit` and `client` option, and one record call at each return point of the call handler; no change to existing logic, messages or order)
- gateway/src/link/server.ts (insertions only: one audit call in the `invalid()` path of `handshake`)
- gateway/src/http/** (insertions only: audit calls where the bearer or OAuth access token is rejected, and where the transport identity is passed to the session)
- gateway/src/oauth/** (insertions only: audit calls where an authorization code is exchanged for a first token, and where tokens are revoked if 35 has such a path)
- gateway/src/config/** (audit options only: insertions into `ConfigSchema` and `ENV_KEYS`)
- gateway/src/app.ts (insertions only: create the audit writer, pass it in, flush on stop)
- gateway/src/bin/cli.ts (insertions only: dispatch of the `audit` subcommand and its usage lines)

`gateway/src/mcp/session.ts`, `gateway/src/link/server.ts` and `gateway/src/config/**` are also edited by
other tasks (36 edits `link/**` and `config/**`). This task only inserts lines there. It never reorders,
reformats or deletes existing lines, so a rebase onto 36 is mechanical.

## Goal
Give the gateway operator their own record of what each AI client asked for: one metadata-only
entry per MCP tool call (including calls the gateway itself refused) and per auth event. Entries
are kept in the existing SQLite store with bounded retention, linked in a hash chain so an edit or
deletion is visible, and readable through a read-only `foundry-agent-gateway audit` subcommand.

The trail is **not a security boundary and not the authoritative record**. The module enforces
policy (13, 14), and the module's in-world audit journal (19) is authoritative for world changes
and supports undo. This trail records requests only. By default it stores no argument values, no
results and no document content, which keeps the spec's "never world data" rule for gateway
storage. That rule matters most in server mode, where the gateway operator may not be the GM.

## Context
- docs/plan/specs/2026-10-09-agent-gateway.md:114-115 — storage holds OAuth clients, hashed tokens, event buffer, headless config; "Never world data"
- docs/plan/specs/2026-10-09-agent-gateway.md:81-83 and docs/plan/done/19-audit-log-undo.md — the module's in-world audit; this trail is distinct from it
- docs/plan/done/28-gateway-event-buffer.md — the gateway's other bounded SQLite table; follow its bounding approach
- gateway/src/mcp/session.ts:47 — `sessionId` is already a per-session `randomUUID()` and is passed to `registry.call`; reuse it as the audit session id
- gateway/src/mcp/session.ts:91-137 — the call handler and every return point: `UNKNOWN_TOOL` (twice), ambiguity (returned as `INVALID_ARGS`), `WORLD_OFFLINE`, schema `INVALID_ARGS`, success, `LinkCallError` codes, `INTERNAL`. 35 adds `FORBIDDEN` for scope refusals.
- gateway/src/link/server.ts:174-200 — `invalid()` is reached on a bad pairing code (`hello.auth.kind === 'pairingCode'`) or a rejected stored token
- gateway/src/store/store.ts:56-60, gateway/src/store/migrate.ts, gateway/src/store/migrations/index.ts — `DatabaseSync`, `PRAGMA user_version` migrations, insertion-only registry
- gateway/src/routing/sanitize.ts — `safeText` for everything printed to the terminal
- gateway/src/config/index.ts — `ConfigSchema` and `ENV_KEYS` pattern
- docs/conventions.md#shared-insertion-only-files — migrations are one new file per task, renumbered at merge

## Design constraints (decided; implement as stated)
- **Entry fields.** `seq` (integer, strictly increasing), `ts` (ms epoch), `kind` (`call` | `auth` | `dropped` | `purge`), `session_id`, `transport` (`stdio` | `http-local` | `oauth`), `client_id` (OAuth client id, else null), `world_id`, `user_id` (bound pair, null when unbound or ambiguous), `tool` (client-supplied name, capped at 128 characters), `result` (`ok`, an `ErrorCode`, `UNKNOWN_TOOL` or `AMBIGUOUS`), `origin` (`gateway` when the gateway refused, `module` when the module returned the code), `latency_ms`, `args_bytes` (UTF-8 length of the canonical args JSON), `args_hash` (SHA-256 hex of the canonical args JSON), `event` (for `auth`: `pairing_failed` | `token_rejected` | `oauth_grant` | `oauth_revoke`), `count` (for coalesced auth failures and `dropped`), `args_json` (verbose mode only, else null), `prev_hash`, `hash`.
- **Canonical args.** JSON with object keys sorted recursively, no whitespace, of the arguments as received (before zod parsing, so refused calls hash too). Implement it once in `gateway/src/audit/canonical.ts` and export it, so a later task can compute the same hash in the module's audit entry. Changing the module is out of scope. `docs/audit-trail.md` must state that a hash of low-entropy args (for example `{"formula":"1d20"}`) can be guessed by brute force, so the hash proves a match; it does not hide the value.
- **Hash chain.** `hash = SHA-256(prev_hash || canonical JSON of the row's other columns)`. Chain anchor in an `audit_meta` row: genesis is 64 zeros; a purge records the `seq` and `hash` of the last deleted row as the new anchor and writes a `purge` entry that is itself chained. Verify walks from the anchor and reports the first `seq` whose `prev_hash` or `hash` does not match. `docs/audit-trail.md` must say that truncating the newest rows, or rewriting the anchor and every later row, cannot be detected from inside the DB. `--verify` prints the head `seq` and `hash` so an operator can record them elsewhere.
- **Write path.** The call path only pushes onto an in-memory queue (no I/O, no `await`). A flusher writes batches in one transaction, every `AUDIT_FLUSH_MS` (250) or `AUDIT_BATCH` (200) entries, whichever comes first, and computes the chain at write time. The queue holds at most `AUDIT_QUEUE_MAX` (10,000) entries. On overflow new entries are dropped and counted, and the next flush writes one chained `dropped` entry with the count. A DB error is logged once per minute to the operator log and never fails or delays a tool call. `app.stop()` flushes the queue.
- **Size bounds.** Retention defaults to 14 days (`auditRetentionDays`, env `AGENT_GATEWAY_AUDIT_RETENTION_DAYS`). There is a row cap, `auditMaxRows` (default 200,000). Pruning runs at start and hourly, deleting oldest-first and updating the anchor. Identical auth failures (same `event`, transport, and the token or code prefix if available, else none) within 1 s coalesce into one entry with `count`, so an unauthenticated flood cannot outrun the cap.
- **Storage access.** Use the gateway DB file through a second `DatabaseSync` connection on the same path, opened after `openStore` has applied migrations, with `PRAGMA busy_timeout`. Do not add audit methods to `gateway/src/store/store.ts`. The CLI opens the DB read-only for listing and verify, and read-write only for purge.
- **Verbose mode** (`auditVerbose`, env `AGENT_GATEWAY_AUDIT_VERBOSE`, default false) also stores `args_json`, capped at 4 KiB, with a `truncated` marker. It never stores results. It is **refused, not warned**. Startup fails with a `ConfigError` when verbose is set together with `--public-url` (35) or `--server-mode` (36, if present when this lands). Even when it is enabled, values are stored only for `stdio` and `http-local` sessions, never for `oauth` ones. Justification for `docs/audit-trail.md`: a warning reaches only the operator, the person the rule protects others from, while the players and GM whose world data would be stored never see it. Refusing is the only option that keeps "never world data" true for people other than the operator.
- **CLI.** `foundry-agent-gateway audit [--since <ISO time | 15m | 2h | 7d>] [--session <id>] [--user <id>] [--limit <n>, default 100]` lists entries oldest-first, one line each. `audit --verify` exits 0 when the chain is intact and 1 with `first broken link at seq N` otherwise. `audit --purge [--older-than <dur>, default the retention]` deletes, moves the anchor and prints the count. Every client-supplied or DB-sourced string goes through `safeText` before printing. `--db` and `AGENT_GATEWAY_DB` are honoured the same way the main command honours them.

## Acceptance
- [ ] A migration file under `gateway/src/store/migrations/` creates `audit_entries` (columns as in Design constraints, `seq INTEGER PRIMARY KEY`, index on `ts`, `session_id` and `user_id`) and `audit_meta`. It is registered by one import and one array entry in `migrations/index.ts`. The existing `gateway/test/store/store.test.ts` passes unchanged.
- [ ] `gateway/test/audit/no-values.test.ts`: with verbose off, it makes calls through a session (fixture tool and registry) whose args hold sentinels: a unique marker string, an ESC sequence, a 10 KiB string, a nested object with the marker as a key and a value, and an array. It also makes calls that end in `UNKNOWN_TOOL`, `INVALID_ARGS` and `WORLD_OFFLINE`, with a fixture result text holding a second marker. After a flush it reads the raw DB file bytes, plus the `-journal` file if present, and asserts that neither marker appears. Rows exist for every call, with `args_bytes` and `args_hash` set.
- [ ] Canonical hashing: `{b:1,a:{d:2,c:3}}` and `{a:{c:3,d:2},b:1}` produce the same `args_hash`, and it equals SHA-256 of `{"a":{"c":3,"d":2},"b":1}`.
- [ ] Refusals are recorded with `origin = 'gateway'`: one test each for unknown tool, a tool hidden from a player, ambiguity (`result = 'AMBIGUOUS'`), unbound (`WORLD_OFFLINE`), schema failure (`INVALID_ARGS`) and a scope refusal (`FORBIDDEN`, via 35's scope check). A module-returned `LinkCallError` is recorded with `origin = 'module'` and its code, and a success with `result = 'ok'` and `latency_ms >= 0`.
- [ ] Session identity: a stdio session records `transport = 'stdio'`, `client_id = null`. A local HTTP session records `http-local`. An OAuth-authenticated session records `oauth` and the DCR client id. All of them record the same `session_id` across their calls, and different sessions record different ids.
- [ ] Auth events: a wrong pairing code and a revoked or mismatched stored token on the link each write `kind = 'auth'` (`pairing_failed`, `token_rejected`). A wrong HTTP bearer token and an expired or invalid OAuth access token write `token_rejected`. A first token issued from an authorization code writes `oauth_grant` with the client id. Token revocation writes `oauth_revoke` if 35 exposes a revocation path. If it does not, the PR says so, and `recordAuth('oauth_revoke', …)` is exported for 36 to call. 1,000 wrong bearer requests within 1 s produce at most 2 rows, whose `count`s sum to 1,000.
- [ ] Hash chain: `gateway/test/audit/chain.test.ts` writes 50 entries and `--verify` exits 0. Then, on copies of the DB: changing one column of row 20 with raw SQL makes verify exit 1 naming seq 20; deleting row 20 names seq 21; deleting row 1 without moving the anchor names seq 2 (or the first remaining row). After a legitimate purge, verify exits 0.
- [ ] Retention: with an injected clock, entries older than `auditRetentionDays` are removed by the start or hourly prune and by `audit --purge`. `--older-than 1h` removes only entries older than an hour. The anchor moves, a chained `purge` entry is written and verify still passes. Rows beyond `auditMaxRows` are pruned oldest-first.
- [ ] Bounded under load: a test with a stub writer that blocks for 2 s makes 50,000 calls. Each call resolves without waiting on the writer, the queue never exceeds `AUDIT_QUEUE_MAX`, and after the writer unblocks one `dropped` entry carries the exact overflow count. A flood of 300,000 calls against a real DB with `auditMaxRows = 1,000` leaves at most 1,000 + one batch of rows after the next prune, and the DB file stays under 5 MB.
- [ ] No measurable slowdown: `gateway/test/audit/overhead.test.ts` runs 2,000 fixture calls with audit on and off, takes the minimum of 5 runs each, and asserts the audit-on total is within 10% or 50 ms of audit-off, whichever is larger.
- [ ] Terminal-safe CLI: `gateway/test/audit/cli.test.ts` seeds entries whose `tool`, `session_id`, `user_id`, `world_id` and `client_id` contain ESC `[2J`, `\r`, `\n`, U+2028 and a 200-character string. It runs the built CLI and asserts stdout has no byte in `\x00-\x09\x0b-\x1f\x7f-\x9f` and no U+2028 or U+2029, has exactly one `\n` per entry, and caps every field at 80 characters, as `safeText` does. `--since`, `--session`, `--user` and `--limit` filter as documented.
- [ ] Verbose mode: with it on, a stdio session stores `args_json` (capped at 4 KiB, marked when truncated) and an OAuth session stores none. Startup with verbose plus `--public-url` exits non-zero with a message naming both options, and the same holds with `--server-mode` if 36 has landed. The default config has verbose off (a test asserts it).
- [ ] `docs/audit-trail.md` covers what is recorded and never recorded, the "not a security boundary, not authoritative; see the module audit (19)" statement, the brute-force caveat on `args_hash`, the hash-chain limits (tail truncation, anchor rewrite), retention and the cap, CLI usage, and the verbose-mode privacy trade-off with why it is refused in remote and server mode.
- [ ] The diff to `gateway/src/mcp/session.ts`, `gateway/src/link/server.ts`, `gateway/src/http/**`, `gateway/src/oauth/**`, `gateway/src/app.ts` and `gateway/src/bin/cli.ts` adds lines only. `git diff --stat` and `git diff` for those paths show no removed lines, other than a line that has to be split to add an argument, which the PR names. `gateway/test/mcp/**`, `gateway/test/routing/**`, `gateway/test/link/**` and `gateway/test/http/**` pass unchanged.
- [ ] `npm run verify` passes.

## Out of scope
- A status-page view of the trail (`gateway/src/status/**`); a later task.
- Computing `args_hash` in the module or adding it to the module's audit entry (19); only the exported canonicaliser is provided here.
- Storing results, document content or remote IP addresses, in any mode.
- JSON or CSV export from the CLI.
- The consent page, grant listing and in-Foundry revocation UI (36); this task only records the events.
- Carrying the trail into `docs/security.md` and `docs/privacy.md` (43 links to `docs/audit-trail.md`).
- Policy enforcement or rate limiting based on the trail (module, 13 and 14; self-protection limit, 34).
- Any change to binding, routing, refusal messages or error codes.
