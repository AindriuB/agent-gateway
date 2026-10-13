# 57 — Report link port bind failures with one clear stderr line

**Repo:** .
**Depends on:** none
**Owns:**
- gateway/src/link/server.ts
- gateway/src/bin/cli.ts
- gateway/src/bin/start-failure.ts (new)
- gateway/test/link/listen-errors.test.ts (new)
- gateway/test/bin/start-failure.test.ts (new)

## Goal
When the gateway cannot bind its link port, startup fails with Node's raw
`listen EADDRINUSE ...` text. The MCP client only sees
`MCP error -32000: Connection closed`. This happened during the task 32 dnd5e
live e2e run, where two gateways both tried to use port 7429. Map `EADDRINUSE`
and `EACCES` from `LinkServer.listen()` to a typed error. The CLI entrypoint
should then print exactly one plain stderr line naming the port and exit
non-zero. Nothing may be written to stdout, because stdout is the MCP stdio
channel.

## Context
- gateway/src/link/server.ts:62-72 — `listen()` currently passes the raw `error` event to `reject`
- gateway/src/app.ts:86 — `await link.listen()` inside `start()`. It is not edited: the typed error propagates through it unchanged
- gateway/src/bin/cli.ts:76-79 — `app.start().catch(...)` currently writes `Failed to start: ${String(err)}` and calls `process.exit(1)`
- gateway/src/bin/cli.ts:55-63 — `ConfigError` handling: the existing pattern of a typed error, its message written to stderr, and an exit
- gateway/src/config/index.ts:13 — `ConfigError extends Error`, the shape to copy for a typed error
- gateway/test/link/helpers.ts — `startServer()` harness. Use it to occupy a port with one `LinkServer` before a second `listen()` on the same port
- docs/conventions.md#tests — test location and fast/slow split

## Acceptance
- [ ] `gateway/src/link/server.ts` exports `class LinkListenError extends Error` with readonly `code: 'EADDRINUSE' | 'EACCES'` and `port: number`
- [ ] `LinkServer.listen()` rejects with a `LinkListenError` when the bind fails with `EADDRINUSE` or `EACCES`. Its `message` is exactly `link port <N> is in use; is another gateway running?` for `EADDRINUSE`, and `permission denied binding link port <N>` for `EACCES`. `<N>` is the configured port
- [ ] Any other bind error code still rejects with the original error object, unchanged
- [ ] `gateway/src/bin/start-failure.ts` exports `reportStartFailure(err: unknown, io: { writeStderr(line: string): void; exit(code: number): never | void })`. For a `LinkListenError` it writes exactly `err.message + '\n'` once and calls `exit(1)`. For any other error it keeps today's `Failed to start: ${String(err)}` line and calls `exit(1)`
- [ ] `cli.ts`'s `app.start().catch` calls `reportStartFailure` with `process.stderr.write` and `process.exit`. A grep of the diff shows no new `process.stdout` / `console.log` writes on the failure path
- [ ] `gateway/test/link/listen-errors.test.ts` holds a port with one server, starts a second `LinkServer` on that port and checks that `listen()` rejects with `LinkListenError`, `code === 'EADDRINUSE'`, the matching `port` and the exact message
- [ ] The `EACCES` mapping is covered without root and without depending on the OS, for example by making the underlying server emit an `error` with `code: 'EACCES'`, or through a pure exported mapping helper. One more case checks that an unrelated code (for example `EADDRNOTAVAIL`) passes through unchanged
- [ ] `gateway/test/bin/start-failure.test.ts` checks, with injected `writeStderr`/`exit` spies, that a `LinkListenError` produces one line and `exit(1)`, and that a generic `Error` produces the `Failed to start:` line and `exit(1)`
- [ ] `npm run verify` passes

## Out of scope
- `gateway/src/app.ts`: do not add catch/exit logic there, and do not change resource cleanup (the store opened before `listen()`) on failed start
- Automatically retrying or choosing a fallback port
- Bind errors on the local HTTP port (7421) or in the OAuth/HTTP transport
- Changing the e2e harness or the port assignments in docs/testing.md
- Rewording other startup messages (pairing code, link URL)
