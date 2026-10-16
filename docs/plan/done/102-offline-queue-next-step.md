# 102 — Say who an offline-queued call waits for and what happens next

**Repo:** .
**Depends on:** none
**Status:** Ready.
**Owns:**
- gateway/src/mcp/session.ts (the two offline-queue reply texts only, `:434` and `:462`, plus any small helper they need)
- gateway/test/mcp/offline-queue-text.test.ts (new)

## Goal
When a write is queued because the bound Foundry user is offline, the agent (and the person reading
its reply) is told only "World offline: intent queued; no human approval or execution has
occurred." Nothing says the call waits for that Foundry user to reconnect, or that it will need
approval again then. In the 0.3.0 playtest a ChatGPT session bound to Gamemaster queued a call
while the browser had switched to a player, and the call sat until the GM came back. Name the user
and the next step in both queue replies.

## Context
- gateway/src/mcp/session.ts:443-466 — the enqueue path; its reply text is at `:462`.
- gateway/src/mcp/session.ts:412-440 — `approval_status` for a queued row; its text is at `:434`.
- gateway/src/mcp/session.ts:296-300 — `notConnected` already names the user with
  `safeText(who.userName || who.userId)` and the world with `safeText(who.worldId)`. Reuse that
  source (`binding.identity`, `r.pair`) and `safeText`. Never take the name from tool arguments.
- gateway/src/offline-queue/repository.ts:15-19 — `QueueOwner` is (world, user, agent).
- docs/plan/done/30-offline-write-queue.md:74 — a queued intent is replayed on reconnect through the
  normal approval path, so "it will be asked for approval again" is accurate.

## Acceptance
- [ ] The enqueue reply text names the world and the Foundry user (the user name when the binding
      has one, else the user id). It says the call is held until that user next opens the world in a
      browser with Agent Gateway connected, and that it then needs approval there before anything
      runs. Example shape: `World offline: queued for Gamemaster in world till-dawn. It is held until
      Gamemaster opens that world with Agent Gateway connected, then asks for approval there.
      Nothing has been approved or run yet. Check it with approval_status.`
- [ ] The `approval_status` text for a `queued` row carries the same who-and-next-step information.
- [ ] Both texts pass the name through `safeText`. A test with a user name containing control
      characters, and one with a 500-character name, shows the text is sanitised and bounded the
      same way `notConnected`'s is.
- [ ] When the binding has no user name, the text uses the user id and never prints `undefined`,
      an empty name, or "as ." (test).
- [ ] `structuredContent` for both replies is unchanged (`{status:'pending_approval', id}` and the
      existing status object); `gateway/test/mcp/output-schema.test.ts` passes unmodified.
- [ ] `npm run verify` passes.

## Out of scope
- Changing what is queued, the queue's states or replay (task 30's design).
- The `notConnected` text, and the `gateway_status` "as ." follow-up from 87.
- Persisting approvals that were already pending in a browser (task 112).
- Docs (the scribe picks up the new wording at record time).
