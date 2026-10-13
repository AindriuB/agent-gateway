# 69 — Relay secondary gateway instances to the primary over a private local socket

**Repo:** .
**Depends on:** 62
**Status:** MVP A (Andrew, 2026-10-13); before 64/65/66
**Owns:**
- gateway/src/relay/** (new)
- gateway/src/app.ts
- gateway/src/mcp/degraded.ts
- gateway/src/bin/cli.ts (the `stdin` `end`/shutdown wiring only; no new flags)
- gateway/test/relay/** (new)
- gateway/test/bin/link-conflict.test.ts

## Goal
Claude Desktop starts several gateway instances from one `.mcpb`, and only the
first holds link port 7420 and the db. All the others answer with just
`gateway_status`, so a Cowork chat never gets Foundry tools. After this task
the primary also serves MCP on a private local socket. Each secondary becomes a
thin relay that forwards its stdio MCP traffic there. Every relayed session gets
its own full session on the primary, exactly as if it were local. If the
primary goes away, a secondary takes over, within a bounded number of attempts.

## Context
- docs/plan/done/62-claude-desktop-mcpb.md "Amendments" and "Attempt 1": the degraded mode and the Cowork finding
- gateway/src/app.ts:21-25: `isInstanceConflict`, the only trigger for secondary mode (EADDRINUSE or db locked)
- gateway/src/app.ts:121-136: the link port is bound before the store opens; keep that order
- gateway/src/app.ts:145-165: `createSessionServer` gets `registry`, `events`, `queue`, `selector`, `knownIdentities`, `log`. Call it once per relayed connection with the same shared objects.
- gateway/src/mcp/session.ts:55: each session server makes its own `sessionId` (`randomUUID()`). That id goes to `registry.call`, `queue.enqueue`, `events.poll`/`cancelSession`, and the module keys approvals and audit by it (module/src/approvals/manager.ts:243,289; module/src/ops/dispatch.ts:46-60). So one session server per relayed connection gives correct per-session approvals and audit without touching session.ts.
- gateway/src/mcp/session.ts:59-62 and :375-385: the "Bound MCP session to ..." line, and the `onclose` cleanup that must run when a relay connection closes
- gateway/src/routing/binding.ts:36-40: a session binds to one (world, user) pair, chosen by the `UserSelector`, and never falls back
- gateway/src/bin/cli.ts:91-105: `selector`, `dbPath`, and `process.stdin.once('end', shutdown)`
- protocol/src/link/messages.ts:9: `MAX_FRAME_BYTES` (1 MiB) bounds a single tool call or result on the link
- gateway/test/bin/link-conflict.test.ts: the built-CLI multi-process harness, including the 4-instances-times-20 primary test. Extend it; don't fork it.
- docs/plan/tasks/34-gateway-local-http.md: deliberately **not** reused. See Design.

## Design (decided here; change only through a PR note Andrew approves)
1. **Transport.** It uses a Unix domain socket on darwin and a named pipe on win32; there is no TCP port. The endpoint is derived from the state dir, which is `dirname(dbPath)`:
   - darwin: `<stateDir>/relay.sock`. If the path is over 103 bytes (the `sun_path` limit), relaying is off and the instance stays degraded, with a reason that names the length.
   - win32: `\\.\pipe\foundry-agent-gateway-<first 16 hex of sha256(lowercased resolved stateDir)>`.

   34's HTTP stays whole in MVP B.
2. **Authentication.** It has two layers, and both must pass.
   - (a) OS permissions. The state dir is 0700. The socket is chmod 0600 before the primary accepts any connection.
   - (b) A per-boot secret. The primary writes 32 random bytes as hex to `<stateDir>/relay.secret` with mode 0600, by writing a temp file with `0o600` and renaming it. The secondary sends it in its first line and the primary compares with `timingSafeEqual`.

   On win32, (b) is the cross-user defence: the user profile ACL protects the file, and Node cannot set a pipe DACL.

   No identity, user, world or session id is ever read from relayed MCP messages.
3. **Handshake.** The secondary's first line is `{"relay":1,"secret":"<hex>","linkPort":<n>,"selector":{"world"?,"user"?}}`. The primary must get it within `RELAY_HANDSHAKE_MS` (2000) and replies with one line:
   - `{"relay":1,"ok":true}` on success.
   - `{"relay":1,"ok":false,"code":C}` on refusal, then it closes. `C` is one of `RELAY_AUTH`, `RELAY_PORT_MISMATCH`, `RELAY_SELECTOR_MISMATCH`, `RELAY_FULL` or `RELAY_PROTOCOL`.

   After `ok`, the stream is newline-delimited JSON-RPC, the same framing as stdio.
4. **Binding.** A relayed session uses the **primary's** selector and `knownIdentities`. If the secondary's selector is non-empty and differs from the primary's, the handshake is refused with `RELAY_SELECTOR_MISMATCH`, and the secondary goes degraded with a reason that names both selectors, sanitised with `safeText`. Desktop starts every instance from the same `.mcpb` args, so in practice the selectors are equal.
5. **Limits.**
   - `MAX_RELAY_LINE_BYTES` = 4 MiB, in each direction, at both ends. It is enforced while reading, before `JSON.parse`. An oversized line closes that relay connection.
   - `MAX_RELAY_SESSIONS` = 16 concurrent connections on the primary; the next one gets `RELAY_FULL`.
   - `MAX_RELAY_BUFFERED_BYTES` = 8 MiB of unflushed writes on any one relay socket. Past that, the primary destroys the connection, and the secondary stops reading stdin until its socket drains.
   - `MAX_RELAY_PENDING` = 256 in-flight request ids tracked by a secondary. Past that, it answers new requests with JSON-RPC error `-32001` `RELAY_BUSY`.

   Every constant is exported from `gateway/src/relay/` and none is configurable.
6. **Lifecycle.**
   - Only the instance holding the link port creates or unlinks the socket and writes the secret. Holding the port proves any socket file left over is stale.
   - The primary opens the relay endpoint only after the store, `events`, `queue` and its own stdio session are ready.
   - On a conflict, a secondary connects as a relay. It retries the connect with backoff 100 ms, doubling, capped at 2 s, at most `RELAY_CONNECT_ATTEMPTS` (10) times. After that it serves the existing degraded server, with a reason that names the relay failure.
   - When the relay drops after `ok`:
     - It answers every pending request id with JSON-RPC error `-32001` `RELAY_LOST`.
     - It then attempts takeover, within the same bounded attempt budget. First it tries to become primary (bind the link port, open the store, create the socket). If the port is taken, it reconnects as a relay to whoever won.
     - Either way, it replays the client's captured `initialize` request and `notifications/initialized` to the new session, discards that reply, and sends the client `notifications/tools/list_changed`.
     - Requests that arrive while reconnecting get `-32001` `RELAY_RECONNECTING` immediately; they are not buffered.
     - When the budget runs out, it becomes degraded.
   - A relay never opens the db. The only files it reads in the state dir are the secret and the socket.
7. **Primary shutdown.** The primary stops when its own stdin ends, as today. It closes the relay server, unlinks the socket and secret it created, and destroys relay connections. The secondaries then take over as in 6.

## Acceptance
- [ ] Each relay constant and the `-32001` codes in Design 3 and 5-6 are exported from `gateway/src/relay/index.ts` with the values given; `rg -n "MAX_RELAY_LINE_BYTES|MAX_RELAY_SESSIONS|MAX_RELAY_BUFFERED_BYTES|MAX_RELAY_PENDING|RELAY_CONNECT_ATTEMPTS|RELAY_HANDSHAKE_MS" gateway/src/relay` shows each defined once
- [ ] Unit (`gateway/test/relay/`): endpoint path derivation for darwin and win32 (win32 tested as a pure function), the over-103-byte darwin refusal, the handshake codes for wrong secret, missing secret, wrong port, selector mismatch, malformed first line and handshake timeout, and the line-limit and session-limit refusals
- [ ] Security: with a wrong secret the primary replies `RELAY_AUTH` and closes, and no `createSessionServer` call happens (spy). On darwin, `stat` shows the socket `0600`, `relay.secret` `0600` and the state dir `0700` while the primary runs. Andrew runs `sudo -u nobody node <built relay probe> <socket>` once on the Mac and records in the PR that it is refused with EACCES. The probe is a test helper under `gateway/test/relay/`.
- [ ] Isolation: two relayed sessions and the primary's own stdio session call a fixture tool through the fake module (gateway/test/conformance/fake-module.ts). The module sees three distinct `sessionId`s. Closing one relay connection calls `events.cancelSession` for that id only. After 20 relay sessions open and close, the `connected`/`disconnected` listener counts on `LinkRegistry` and the toolset listener count are back to baseline.
- [ ] Multi-process, built CLI (`gateway/test/bin/link-conflict.test.ts` or `gateway/test/relay/*.test.ts`):
  - (a) Cowork case. Start a primary, then a secondary with the same `--db`/`--link-port`. With a fake module paired and connected, an MCP SDK client on the **secondary's** stdio lists the full tool set (not `gateway_status`) and successfully calls a fixture tool.
  - (b) The existing 4-instances-times-20 test still gets exactly one link-port holder per round, and every non-holder now lists the full tool set through the relay.
  - (c) Takeover. Kill the primary by PID, with two secondaries running. Within 15 s exactly one of them holds the link port. The other relays to it. Both clients get `notifications/tools/list_changed`, and both can call the fixture tool again after the fake module reconnects. An in-flight call at kill time gets `RELAY_LOST`.
  - (d) Bounded retry. A secondary whose relay socket never appears and whose port stays taken by a plain `net` server serves the degraded server within `RELAY_CONNECT_ATTEMPTS` attempts (under 20 s), and `gateway_status` names the relay failure.
- [ ] No db access from relays: an app-level test injects a store opener spy, runs relay mode, and gets zero calls. The db file's mtime and size are unchanged across a relay session in the multi-process test.
- [ ] Back-pressure: a relayed client that sends a line over `MAX_RELAY_LINE_BYTES` has that connection closed, with other relay sessions unaffected. A relay peer that stops reading is destroyed once `writableLength` exceeds `MAX_RELAY_BUFFERED_BYTES`, and the primary's RSS growth stays under 64 MiB in that test.
- [ ] The primary logs one sanitised stderr line per relayed session (`relay session <n> opened`/`closed`). The pairing code still prints only from the link-port holder (the existing test passes).
- [ ] `npm run verify` passes, and `node --test scripts/test/build-mcpb.test.mjs` still passes
- [ ] Manual (Andrew, Mac, Claude Desktop with the rebuilt `.mcpb`): in a normal chat and a Cowork chat open at the same time, both call `world_info` successfully against foundry.local. Quitting the normal chat's instance (or killing the primary PID) leaves the Cowork chat working after one retry. The PR records the result.
- [ ] Windows: the endpoint and secret code paths compile, and the win32 path derivation is unit-tested. The PR states plainly that no live win32 run was done, unless Andrew provides one.

## Out of scope
- Task 34's HTTP transport, bearer token and status page; this task adds no TCP listener
- Any change to `gateway/src/mcp/session.ts`, `gateway/src/routing/**`, `gateway/src/link/**` or `gateway/src/store/**`. If one turns out to be needed, stop and report.
- New CLI flags or `.mcpb` `user_config` keys (gateway/mcpb/**, 62)
- Documenting the relay for users: `docs/security.md` and the guides belong to 65, and `docs/architecture.md` is the scribe's
- Sending the pairing code to relayed sessions
- Honouring a secondary's own `--user`/`--world` (see Design 4)
