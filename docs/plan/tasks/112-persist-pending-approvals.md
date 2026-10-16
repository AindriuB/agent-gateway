# 112 — Keep pending approvals when the requesting player logs out or reloads

**Repo:** .
**Depends on:** 102, 109
**Status:** BLOCKED on decision (architecture). Do not fan out until Andrew answers "Open
decisions" and the answer is written into this file. After the decision, an architect pass should
confirm the Owns list below before implementation.
**Owns (provisional, for option A):**
- module/src/approvals/**
- module/test/approvals/**
- gateway/src/offline-queue/**
- gateway/test/offline-queue/**
- gateway/src/mcp/session.ts (the `approval_status` branch only)
- gateway/src/store/migrations/014-*.ts (new, only if a column or state is needed; a shared folder, one new file)
- protocol/src/link/messages.ts — insertion only (a shared insertion-only file), if a new link frame is needed

## Goal
A write waiting for approval lives only in the requesting player's tab: in memory, with its
history in that browser's localStorage. If that player logs out or reloads, the request is gone.
On load, stored pending records are marked expired, a GM who connects later sees nothing, and the
agent must call again. Make a pending approval survive the requester's tab going away, so that it
is asked again when they return, without ever letting stored or replayed data run anything a human
has not approved in a live session.

## Context
- module/src/approvals/manager.ts:57-63 — the in-memory `records`, `waiters` and `inbox` maps (the
  GM inbox is memory-only).
- module/src/approvals/manager.ts:73-116 — `load()` and its doc comment: browser storage is
  untrusted history, so after a reload every unfinished record is expired (`:103-106`).
- module/src/approvals/live.ts:13-14 — the storage key: per browser, per world.
- module/src/approvals/live.ts:75-83 — a GM who joins while the requester's tab is still open is
  re-presented the request (`representTo`, `representAll`). The loss is specifically the
  requester's tab ending.
- gateway/src/offline-queue/repository.ts:15-22 — gateway-side durable queue, owner (world, user,
  agent), with states including `queued` and `pending`.
- docs/plan/done/30-offline-write-queue.md:74 — a queued intent is replayed on reconnect through the
  normal approval path, with claim and receipt guards against double execution.
- gateway/src/mcp/session.ts:412-440 — `approval_status` answers from the gateway queue when the
  owner is offline.

## Open decisions
1. **Where a pending approval is persisted.**
   - A. **Gateway, reusing the offline queue.** When the module replies `pending_approval` for a
     live call, the gateway records the intent (tool, args hash and args, owner) as a pending
     queue row. If the requester's link closes while the row is still pending, the gateway turns it
     into a `queued` intent. On that user's next connection it is replayed through task 30's path
     and asked for approval again. `approval_status` keeps answering the same id throughout.
     Execution stays in the requester's browser, under their Foundry identity.
   - B. **GM side.** The GM's client stores its inbox in its own browser storage. This does not
     help when the GM was offline when the request was made, and the requester must still be online
     to execute. It fixes only "GM reloads".
   - C. **Gateway routes approvals.** The gateway holds pending approvals and presents them to
     any eligible approver who connects, even while the requester is offline. The approval is
     executed when the requester returns. This changes who carries the approval (the link instead
     of the Foundry socket), so approver identity must come from the gateway's pairing, not
     Foundry's `senderId`. It is a larger security review.
   - D. **Requester browser.** Instead of expiring stored pending records on reload, re-ask them.
     Storage is untrusted, but a human still approves the args shown. Lost if the player switches
     machine or clears storage, and a GM still sees nothing while the player is away.
   - **Recommendation: A.** It reuses durable, reviewed machinery (task 30), keeps execution
     and identity where they are, survives logout, machine switch and gateway restart, and needs at
     most one queue state or column. C is the only option that lets a GM approve while the player is
     away, but nothing can run until the player returns anyway, so its cost buys little.
2. **Re-ask or keep the earlier approval?** If an approval was given but the tab closed before it
   ran: re-ask (consistent with 30 and the `load()` rule), or honour it. **Recommendation:
   re-ask.** Honouring it needs the gateway to trust a module-reported approval it cannot verify.
3. **Expiry.** How long a carried-over pending approval lives (today pending records expire
   after the approval wait). **Recommendation:** the offline queue's existing retention.

## Acceptance (for option A; rewrite if another option is chosen)
- [ ] A write that gets `pending_approval`, followed by the requester's link closing (logout or
      reload), leaves a gateway row for that id, and `approval_status` returns the queued text from
      task 102 while the user is offline (test).
- [ ] On the requester's next connection the intent is replayed and appears for approval again.
      Approving it runs the call exactly once, and `approval_status` for the original id returns
      the result (integration test).
- [ ] A record found in browser storage still never runs by itself. `load()` behaviour for stored
      records is unchanged (the existing storage and security approval tests pass unmodified).
- [ ] A call approved and executed before the link closed is not replayed (test).
- [ ] A link drop with a reconnect within the 109 window does not create a duplicate request (test).
- [ ] Rows carry the (world, user, agent) owner. Another user or another agent cannot read or
      claim them (test, mirroring task 30's cross-owner refusal).
- [ ] `npm run verify` passes. A live check on Foundry v14 (player requests, logs out, logs back in,
      GM approves, the call runs once) is listed in the PR as done or pending Andrew.

## Out of scope
- GM-side inbox persistence (option B) and gateway-routed approvals (option C), unless chosen.
- The approval dialog UI, the policy matrix, and audit/undo.
- The offline-queue reply wording (task 102) and link keepalive (task 109).
