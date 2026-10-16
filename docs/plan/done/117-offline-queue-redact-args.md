# 117 — Refuse to queue `redactArgs` tools while the world is offline

**Repo:** .
**Depends on:** none
**Status:** Ready. The defect is confirmed (Evidence below). Task 112 must list 117 in its
`Depends on`, because both tasks edit `OfflineQueue.enqueue` in gateway/src/offline-queue/service.ts.
112 already treats this as a separate task (112 Out of scope, offline admission).
**Owns:**
- gateway/src/offline-queue/service.ts: `enqueue` (:89-131) only, adding one refusal before
  validation. No other method changes.
- gateway/test/offline-queue/redact-args.test.ts (new)

## Goal
When the user's world is offline, an `image_upload` call is written to the gateway's `queued_calls`
table with the whole base64 image in `args`. The row stays up to 7 days queued and up to 7 more
after it resolves. That bypasses the task 53 `redactArgs` guarantee, which keeps the bytes out of
approvals and audit. Decision: the gateway refuses to queue any core tool whose definition declares
a non-empty `redactArgs`. It tells the agent that nothing was stored or run, and that it should
retry once the user is back online. All other tools queue exactly as they do now.

## Evidence (confirmed 2026-10-16, main 24e43cc)
- gateway/src/mcp/session.ts:462-485: offline admission runs whenever `!r.conn`, the tool is not
  `approval_status` and it is not a read. It passes the raw `req.params.arguments` to
  `opts.queue.enqueue`. It never checks `redactArgs`.
- gateway/src/offline-queue/service.ts:89-131: `enqueue` checks the catalog (:92-94), the core
  definition match (:95-110) and validation (:112-123). It then passes `parsed.value` to the
  repository. It never checks `redactArgs`.
- gateway/src/offline-queue/repository.ts:96 `JSON.stringify(args)`, and :132-145, which inserts it
  into the `args` column of `queued_calls`. The only size gate is `MAX_FRAME_BYTES` (:97-112;
  protocol/src/link/messages.ts:10, 1 MiB).
- protocol/src/tools/image-upload.ts:11-27: `image_upload` is `category: 'write'` and
  `handledBy: 'module'`, so it passes the service.ts:99-101 core gate. It declares
  `redactArgs: ['data']`, and `data` is at most 699052 base64 chars (:7). The comment at :4 says
  the cap was chosen to fit "both live and queued frames", so a full-size upload is accepted.
- repository.ts:10-11 `ttlMs` and `retainMs` are both 7 days. Cleanup (:54-65) deletes resolved
  rows only after `retainMs`, and it never blanks `args`.
- gateway/test/offline-queue/integration.test.ts:107 delivers the queued call with
  `args: { content: 'fixture' }` from the stored row. That shows args persist in the row verbatim
  until replay. No gateway test covers `image_upload` or `redactArgs` (`rg redactArgs gateway/`
  returns nothing).
- task 53 Out of scope (docs/plan/tasks/53-image-upload.md:181) deferred the offline queue
  explicitly. `image_upload` (890db80) is not in any release tag, so no published install
  holds such rows.

## Approach
- In `enqueue`, after `core` is resolved (service.ts:95) and before validation, throw
  `LinkCallError('WORLD_OFFLINE', …)` when `core?.redactArgs?.length`. The existing catch at
  session.ts:486-489 already turns a `LinkCallError` into `failure(e.code, e.message)`, so
  session.ts needs no change.
- Message (sanitised, no args echoed): `<tool> carries file data and is not held while the world
  is offline. Nothing was stored or run. Retry once the user has the world open with Agent Gateway
  connected.`
- Key the check on the core definition only. Pack tools never carry `redactArgs`, because the
  module ignores it for them (module/src/ops/registry-class.ts:103).

### Alternative not taken
Storing redacted args encrypted at rest, or as a reference to a separate blob with its own
retention, would let uploads queue offline. Both are heavier: key management or a second table, a
migration, and delivery-time rehydration through the `MAX_FRAME_BYTES` check (service.ts:163).
Plan that as a new task if offline uploads are wanted later.

## Context
- gateway/src/offline-queue/service.ts:89-131: the function to change.
- gateway/src/mcp/session.ts:462-489: caller, and the catch that maps `LinkCallError`.
- protocol/src/tools/define.ts:22-23: `redactArgs`. protocol/src/link/errors.ts:3-15:
  `WORLD_OFFLINE` exists.
- gateway/test/mcp/offline-queue-text.test.ts:1-10: harness imports for an MCP session over an
  offline pairing (store, `OfflineQueue`, `LinkServer`, `createSessionServer`).
- gateway/test/offline-queue/service.test.ts:59-64: direct `enqueue` refusal cases to mirror.

## Acceptance
- [ ] A direct `OfflineQueue.enqueue(owner, s, 'image_upload', { data: <base64 >= 64 KiB>, mime:
      'image/png' })` with a matching validated catalog throws `LinkCallError` with code
      `WORLD_OFFLINE`, and `SELECT COUNT(*) FROM queued_calls` is unchanged (test).
- [ ] An MCP `tools/call` of `image_upload` through `createSessionServer` while the pairing is
      offline returns `isError` with code `WORLD_OFFLINE`, and neither the text nor
      `structuredContent` contains `pending_approval` or a queue id (test).
- [ ] After that call, no row of `queued_calls` has an `args` (or any column) containing the base64
      `data` string or a 32-char prefix of it, and the table's row count is 0 (test reads SQLite
      directly).
- [ ] The refusal fires for every core tool in `TOOLS` with non-empty `redactArgs`. The test
      iterates `TOOLS.filter(t => t.redactArgs?.length)`, asserts the list is non-empty, and
      asserts each one is refused.
- [ ] A non-redacted offline write (e.g. `chat_post`) still returns `pending_approval` with an id,
      and its row's `args` equals the validated args (test, same file).
- [ ] The refusal message does not echo any argument value (test asserts the base64 is absent from
      the message).
- [ ] `git diff main -- gateway/src/mcp/session.ts gateway/src/offline-queue/repository.ts` is
      empty.
- [ ] `npm run verify` passes.

## Out of scope
- gateway/src/mcp/session.ts: no edits. 112 owns :431-461 and :520-560, and the offline branch
  :462-485 stays as is.
- gateway/src/offline-queue/repository.ts, migrations, and purging existing rows. No release holds
  `image_upload`, so no rows exist in the field.
- 112's alias-row `redactArgs` skip (112 Acceptance, session.ts `pending_approval` path).
- Encrypted or by-reference storage of queued args (see Alternative not taken).
- `redactArgs` on pack tools, nested fields, and the live (online) path.
- 109's files: gateway/src/link/server.ts heartbeat, gateway/src/link/registry.ts,
  module/src/approvals/manager.ts and module/src/approvals/live.ts.
