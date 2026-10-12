import { actionCategory, effectiveCategory } from '../ops/context.js';
import { isOpError, replayOf, type DispatchResult, type OpContext } from '../ops/types.js';
import type { ToolDefinition } from '@agent-gateway/protocol';
import { liveToolMetadata as toolRegistry } from '../ops/registry-class.js';
import { callHash } from './canonical.js';
import { APPROVAL_CONFIG as CFG } from './config.js';
import type {
  ApprovalEnv,
  ApprovalRecord,
  ApprovalRequestPayload,
  ApprovalScope,
  ApproverClass,
  EnvUser,
  InboxEntry,
  ResolveOptions,
} from './types.js';

export const HOOK_REQUESTED = 'agentGateway.approvalRequested';
export const HOOK_RESOLVED = 'agentGateway.approvalResolved';

function storedResult(res: DispatchResult): { text: string; failed: boolean } {
  const failed = isOpError(res);
  const text = isOpError(res) ? `${res.error.code}: ${res.error.message}` : res.text;
  return { text: text.slice(0, CFG.MAX_RESULT_CHARS), failed };
}

const ID_PATTERN = /^[A-Za-z0-9_-]{22,64}$/;

interface Waiter {
  ctx: OpContext;
  next: () => Promise<DispatchResult>;
  /** Finish the waiting call; ignored once it has already returned. */
  finish(result: DispatchResult): void;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v: unknown, max = 1000): v is string => typeof v === 'string' && v.length <= max;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Strip control characters and cap the length of text that came from a person. */
export function cleanText(v: unknown, max: number): string {
  if (typeof v !== 'string') return '';
  return v
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .trim()
    .slice(0, max);
}

/**
 * The approval queue for one client. As the requester it holds the call, relays the request over
 * the module socket and runs the handler once an eligible user approves. As an approver it holds
 * requests received from other users. Who sent a socket message is only ever the `senderId` the
 * Foundry server appended; no payload field is read as an identity.
 */
export class ApprovalManager {
  private records = new Map<string, ApprovalRecord>();
  private waiters = new Map<string, Waiter>();
  private inbox = new Map<string, InboxEntry>();
  /** Requests this client answered, kept so the requester's final word can still reach the UI. */
  private answered = new Map<string, { requesterId: string; until: number; announced: string }>();
  private grants = new Map<string, ApproverClass>();
  private loadedFor: string | undefined;

  constructor(
    private env: ApprovalEnv,
    private opts: { waitMs?: number; tools?: readonly ToolDefinition[] } = {},
  ) {}

  // ---- storage --------------------------------------------------------------------------

  private localId(): string | undefined {
    return this.env.localUser()?.id;
  }

  /**
   * Read this user's records from client storage.
   *
   * Storage is only a history that approval_status can read, never something to run: the stored
   * text can be edited by anyone with the browser, so an `approved` or `pending` record found here
   * is not trusted. A call runs only from an approval given in the same page session, to a call
   * still waiting in memory. After a reload every unfinished record is expired (the agent calls
   * again and asks again), and an approved record that never ran does not run. This does not
   * defend against a hostile local user, who can already act as themselves; Foundry's server
   * permission checks are the limit there.
   */
  load(): void {
    const me = this.localId();
    this.loadedFor = me;
    this.records.clear();
    if (!me) return;
    let list: unknown;
    try {
      const all: unknown = JSON.parse(this.env.load() || '{}');
      list = isObj(all) ? all[me] : undefined;
    } catch {
      list = undefined;
    }
    if (!Array.isArray(list)) return;
    const lapsed: ApprovalRecord[] = [];
    for (const r of list as ApprovalRecord[]) {
      if (!isObj(r) || !isStr(r.id, 64) || !ID_PATTERN.test(r.id)) continue;
      if (r.requesterId !== me || r.argsHash !== callHash(String(r.tool), r.args)) continue;
      delete (r as { rerun?: unknown }).rerun;
      if (r.status === 'pending' || (r.status === 'approved' && !r.result)) {
        r.status = 'expired';
        r.resolvedAt = this.env.now();
        lapsed.push(r);
      } else if (!['approved', 'denied', 'expired'].includes(r.status)) {
        continue;
      }
      this.records.set(r.id, r);
    }
    if (lapsed.length) {
      this.persist();
      for (const r of lapsed) this.announceResolved(r);
    }
  }

  private persist(): void {
    const me = this.localId();
    if (!me) return;
    const now = this.env.now();
    for (const [id, r] of this.records) {
      if (r.status !== 'pending' && now - (r.resolvedAt ?? r.expiresAt) > CFG.APPROVAL_RETAIN_MS) {
        this.records.delete(id);
      }
    }
    const sorted = [...this.records.values()].sort((a, b) => a.createdAt - b.createdAt);
    while (sorted.length > CFG.MAX_RECORDS) {
      const drop = sorted.find((r) => r.status !== 'pending');
      if (!drop) break;
      this.records.delete(drop.id);
      sorted.splice(sorted.indexOf(drop), 1);
    }
    let all: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(this.env.load() || '{}');
      if (isObj(parsed)) all = parsed;
    } catch {
      // Unreadable storage is replaced.
    }
    // Storage is a convenience and must never break the flow: keep it small (oldest resolved
    // records go first) and treat any failure to write, synchronous or not, as non-fatal.
    let text = '';
    for (;;) {
      all[me] = sorted;
      text = JSON.stringify(all);
      if (text.length <= CFG.MAX_STORE_CHARS) break;
      const drop = sorted.find((r) => r.status !== 'pending');
      if (!drop) break;
      this.records.delete(drop.id);
      sorted.splice(sorted.indexOf(drop), 1);
    }
    try {
      void Promise.resolve(this.env.save(text)).catch((err) => this.saveFailed(err));
    } catch (err) {
      this.saveFailed(err);
    }
  }

  private saveWarned = false;
  private saveFailed(err: unknown): void {
    if (this.saveWarned) return;
    this.saveWarned = true;
    console.error('agent-gateway | could not save the approval queue to client storage', err);
  }

  // ---- records --------------------------------------------------------------------------

  private newId(): string {
    const bytes = this.env.random(16);
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  private scheduleExpiry(r: ApprovalRecord): void {
    this.env.setTimer(() => this.expireDue(), Math.max(0, r.expiresAt - this.env.now()) + 1);
  }

  /** Turn every pending record past its deadline into `expired`. Called on every entry point. */
  expireDue(): void {
    const now = this.env.now();
    let changed = false;
    for (const r of this.records.values()) {
      if (r.status === 'pending' && now >= r.expiresAt) {
        r.status = 'expired';
        r.resolvedAt = now;
        changed = true;
        const waiter = this.waiters.get(r.id);
        if (waiter) replayOf(waiter.ctx)?.report('expired', 'Queued approval expired');
        waiter?.finish(this.pendingResult(r.id));
        this.waiters.delete(r.id);
        this.announceResolved(r);
      }
    }
    for (const [id, e] of this.inbox) if (now >= e.expiresAt) this.inbox.delete(id);
    for (const [id, a] of this.answered) if (now >= a.until) this.answered.delete(id);
    if (changed) this.persist();
  }

  private pendingResult(id: string): DispatchResult {
    return {
      text: this.env.t('AGENT_GATEWAY.Approvals.pending', { id }),
      structured: { status: 'pending_approval', id },
    };
  }

  private toPayload(r: ApprovalRecord): ApprovalRequestPayload {
    return {
      id: r.id,
      agentId: r.agentId,
      sessionId: r.sessionId,
      tool: r.tool,
      args: r.args,
      argsHash: r.argsHash,
      category: r.category,
      approver: r.approver,
      ...(r.replay ? { replay: true as const } : {}),
      createdAt: r.createdAt,
      expiresAt: r.expiresAt,
    };
  }

  /** May this user answer this request? A GM may answer anything; the owner only an owner request. */
  eligible(r: ApprovalRecord, userId: string): EnvUser | undefined {
    const u = this.env.user(userId);
    if (!u) return undefined;
    if (u.isGM) return u;
    return r.approver === 'owner' && userId === r.agentOwnerId ? u : undefined;
  }

  // ---- the call side --------------------------------------------------------------------

  private grantKey(ctx: OpContext): string {
    const base =
      this.opts.tools?.find((d) => d.name === ctx.tool)?.category ??
      toolRegistry.info(ctx.tool)?.category;
    return JSON.stringify([
      ctx.user.id,
      ctx.agent.id,
      ctx.sessionId,
      ctx.tool,
      effectiveCategory(ctx, base),
    ]);
  }

  /** What the policy says about this call right now; the stricter approver of old and new. */
  private currentDecision(
    requesterId: string,
    headless: boolean,
    category: string,
    approver: ApproverClass,
    base = category,
  ): { kind: 'allow' } | { kind: 'deny' } | { kind: 'ask'; approver: ApproverClass } {
    const first = this.env.currentDecision({ requesterId, headless, category: base, approver });
    const second =
      base === category
        ? first
        : this.env.currentDecision({ requesterId, headless, category, approver });
    const now =
      first.kind === 'deny' || second.kind === 'deny'
        ? { kind: 'deny' as const }
        : first.kind === 'ask' || second.kind === 'ask'
          ? {
              kind: 'ask' as const,
              approver:
                (first.kind === 'ask' && first.approver === 'gm') ||
                (second.kind === 'ask' && second.approver === 'gm')
                  ? ('gm' as const)
                  : ('owner' as const),
            }
          : { kind: 'allow' as const };
    if (now.kind === 'ask' && approver === 'gm') return { kind: 'ask', approver: 'gm' };
    return now;
  }

  private hasGrant(ctx: OpContext, approver: ApproverClass): boolean {
    const level = this.grants.get(this.grantKey(ctx));
    return level === 'gm' || (level === 'owner' && approver === 'owner');
  }

  private bindsTo(r: ApprovalRecord, ctx: OpContext): boolean {
    return (
      r.tool === ctx.tool &&
      r.agentId === ctx.agent.id &&
      r.requesterId === ctx.user.id &&
      r.sessionId === ctx.sessionId &&
      r.argsHash === callHash(ctx.tool, ctx.args) &&
      r.category ===
        effectiveCategory(
          ctx,
          this.opts.tools?.find((d) => d.name === ctx.tool)?.category ??
            toolRegistry.info(ctx.tool)?.category,
        )
    );
  }

  /** Approval cannot preserve privileges the requester has since lost. */
  private async resumeApproved(
    ctx: OpContext,
    next: () => Promise<DispatchResult>,
  ): Promise<DispatchResult> {
    const replay = replayOf(ctx);
    if (replay && (!replay.current() || this.env.now() >= replay.expiresAt))
      return { error: { code: 'DENIED', message: 'Queued request expired or disconnected' } };
    const user = this.env.user(ctx.user.id);
    if (!user) {
      return { error: { code: 'FORBIDDEN', message: 'The requesting user no longer exists' } };
    }
    const def = this.opts.tools
      ? this.opts.tools.find((d) => d.name === ctx.tool)
      : toolRegistry.info(ctx.tool);
    if (!def) {
      return { error: { code: 'TOOL_NOT_FOUND', message: `Unknown tool "${ctx.tool}"` } };
    }
    if (def.minRole === 'gm' && !user.isGM) {
      return { error: { code: 'FORBIDDEN', message: `Tool "${ctx.tool}" requires a GM` } };
    }
    const category = effectiveCategory(ctx, def.category)!;
    if (
      category !==
      actionCategory(ctx.tool, ctx.args, def.category, !('origin' in def) || def.origin === 'core')
    )
      return { error: { code: 'INTERNAL', message: 'Tool classification changed' } };
    const decision = this.currentDecision(
      user.id,
      ctx.agent.headless,
      category,
      ctx.approval?.approver ?? 'owner',
      def.category,
    );
    if (decision.kind === 'deny')
      return {
        error: { code: 'DENIED', message: this.env.t('AGENT_GATEWAY.Approvals.policyChanged') },
      };
    ctx.user = { id: user.id, isGM: user.isGM };
    ctx.approved = true;
    return next();
  }

  /** Run the handler for an approved call, after checking it is the very call that was approved. */
  private async executeApproved(
    r: ApprovalRecord,
    ctx: OpContext,
    next: () => Promise<DispatchResult>,
  ): Promise<DispatchResult> {
    let res: DispatchResult;
    if (!this.bindsTo(r, ctx)) {
      res = { error: { code: 'DENIED', message: this.env.t('AGENT_GATEWAY.Approvals.mismatch') } };
    } else {
      try {
        res = await this.resumeApproved(ctx, next);
      } catch (err) {
        console.error('agent-gateway | approved call failed', err);
        res = { error: { code: 'INTERNAL', message: `Tool "${ctx.tool}" failed unexpectedly` } };
      }
    }
    r.result = storedResult(res);
    replayOf(ctx)?.report('approved', r.result.text);
    this.persist();
    return res;
  }

  /** The approval stage body: ask, wait a while, then either run or return pending. */
  async request(
    ctx: OpContext,
    category: string,
    next: () => Promise<DispatchResult>,
  ): Promise<DispatchResult> {
    const approval = ctx.approval;
    if (!approval) return next();
    this.ensureLoaded();
    this.expireDue();
    const hash = callHash(ctx.tool, ctx.args);

    // A session grant is only as good as today's policy: a call the policy now denies is refused,
    // and one it now sends to a GM needs a grant a GM gave.
    const base =
      this.opts.tools?.find((d) => d.name === ctx.tool)?.category ??
      toolRegistry.info(ctx.tool)?.category ??
      category;
    const now0 = this.currentDecision(
      ctx.user.id,
      ctx.agent.headless,
      category,
      approval.approver,
      base,
    );
    if (now0.kind === 'deny') {
      return {
        error: { code: 'DENIED', message: this.env.t('AGENT_GATEWAY.Approvals.policyChanged') },
      };
    }
    if (!replayOf(ctx) && (now0.kind === 'allow' || this.hasGrant(ctx, now0.approver))) {
      return this.resumeApproved(ctx, next);
    }

    const open = [...this.records.values()].filter(
      (r) => r.status === 'pending' && r.agentId === ctx.agent.id,
    );
    if (open.length >= CFG.MAX_PENDING_PER_AGENT) {
      return {
        error: { code: 'RATE_LIMITED', message: this.env.t('AGENT_GATEWAY.Approvals.tooMany') },
      };
    }

    const now = this.env.now();
    const record: ApprovalRecord = {
      id: replayOf(ctx)?.id ?? this.newId(),
      agentId: ctx.agent.id,
      agentOwnerId: ctx.agent.ownerUserId,
      headless: ctx.agent.headless,
      sessionId: ctx.sessionId,
      requesterId: ctx.user.id,
      tool: ctx.tool,
      args: ctx.args,
      argsHash: hash,
      category,
      approver: approval.approver,
      createdAt: now,
      expiresAt: Math.min(now + CFG.APPROVAL_TTL_MS, replayOf(ctx)?.expiresAt ?? Infinity),
      ...(replayOf(ctx) ? { replay: true as const } : {}),
      status: 'pending',
    };
    this.records.set(record.id, record);
    this.scheduleExpiry(record);
    this.persist();

    return new Promise<DispatchResult>((resolve) => {
      let done = false;
      const timer = this.env.setTimer(
        () => waiter.finish(this.pendingResult(record.id)),
        this.opts.waitMs ?? CFG.APPROVAL_WAIT_MS,
      );
      const waiter: Waiter = {
        ctx,
        next,
        finish: (result) => {
          if (done) return;
          done = true;
          this.env.clearTimer(timer);
          resolve(result);
        },
      };
      this.waiters.set(record.id, waiter);
      // Hooks and socket replies can resolve synchronously: the caller must already be waiting.
      this.env.callHook(HOOK_REQUESTED, {
        ...this.toPayload(record),
        requesterId: ctx.user.id,
        local: true,
      });
      if (record.status === 'pending') this.sendRequest(record, this.recipients(record));
    });
  }

  // ---- resolving ------------------------------------------------------------------------

  /**
   * Apply an answer to one of this client's requests. `resolver` must already be an attested
   * identity: the socket sender, or the local user. Returns whether the answer was accepted.
   */
  private applyResolution(
    r: ApprovalRecord,
    resolver: string,
    o: ResolveOptions,
    bind?: { tool: unknown; argsHash: unknown; agentId: unknown; userId: unknown },
  ): boolean {
    this.expireDue();
    if (r.status !== 'pending') return false;
    const who = this.eligible(r, resolver);
    if (!who) return false;
    if (
      bind &&
      (bind.tool !== r.tool ||
        bind.argsHash !== r.argsHash ||
        bind.agentId !== r.agentId ||
        bind.userId !== r.requesterId)
    ) {
      return false;
    }
    if (r.replay && o.scope === 'session') return false;
    if (o.decision !== 'approve' && o.decision !== 'deny') return false;
    if (o.decision === 'approve') {
      // The request may have waited a long time. Judge it by today's policy, not the old one.
      const def = this.opts.tools?.find((d) => d.name === r.tool) ?? toolRegistry.info(r.tool);
      const cur = def
        ? this.currentDecision(r.requesterId, r.headless, r.category, r.approver, def.category)
        : { kind: 'deny' as const };
      if (cur.kind === 'deny') {
        o = { decision: 'deny', reason: this.env.t('AGENT_GATEWAY.Approvals.policyChanged') };
      } else if (cur.kind === 'ask' && cur.approver === 'gm' && !who.isGM) {
        // It now needs a GM and only the owner approved: do not run it, ask the GMs instead.
        r.approver = 'gm';
        this.persist();
        this.sendRequest(r, this.recipients(r));
        return false;
      }
    }
    const waiter = this.waiters.get(r.id);
    // Only a call that is waiting in this page session can be run; nothing is run from storage.
    if (o.decision === 'approve' && !waiter) return false;
    r.resolvedBy = who.name;
    r.resolvedAt = this.env.now();
    if (o.decision === 'deny') {
      r.status = 'denied';
      r.reason = cleanText(o.reason, CFG.MAX_REASON_CHARS);
      this.waiters.delete(r.id);
      if (waiter) replayOf(waiter.ctx)?.report('denied', r.reason ?? 'Denied');
      const name = who.name;
      waiter?.finish({
        error: {
          code: 'DENIED',
          message: r.reason
            ? this.env.t('AGENT_GATEWAY.Approvals.denied', { approver: name, reason: r.reason })
            : this.env.t('AGENT_GATEWAY.Approvals.deniedNoReason', { approver: name }),
        },
      });
    } else {
      replayOf(waiter!.ctx)?.markApproved?.(who.isGM);
      r.status = 'approved';
      // Code is never approved for a whole session: every code call is shown and asked again.
      r.scope = o.scope === 'session' && !r.replay && r.category !== 'code' ? 'session' : 'once';
      if (r.scope === 'session') {
        this.grants.set(
          JSON.stringify([r.requesterId, r.agentId, r.sessionId, r.tool, r.category]),
          who.isGM ? 'gm' : 'owner',
        );
      }
      this.waiters.delete(r.id);
      void this.executeApproved(r, waiter!.ctx, waiter!.next).then((res) => waiter!.finish(res));
    }
    this.persist();
    this.announceResolved(r);
    return true;
  }

  private announceResolved(r: ApprovalRecord): void {
    this.env.callHook(HOOK_RESOLVED, {
      id: r.id,
      status: r.status,
      reason: r.reason ?? '',
      resolvedBy: r.resolvedBy ?? '',
      scope: r.scope ?? 'once',
      local: true,
    });
    this.env.emit(
      { t: 'approval.resolved', id: r.id, status: r.status },
      this.recipients(r, false),
    );
  }

  /**
   * The approver API (task 17 builds the dialog on it). Answers a request this client made, or
   * one received from another user. Returns whether the answer was sent or applied.
   */
  resolveApproval(id: string, o: ResolveOptions): boolean {
    this.ensureLoaded();
    const me = this.env.localUser();
    if (!me) return false;
    const own = this.records.get(id);
    if (own) return this.applyResolution(own, me.id, o);
    const entry = this.inbox.get(id);
    if (!entry || !me.isGM || (entry.replay && o.scope === 'session')) return false;
    this.expireDue();
    if (!this.inbox.has(id)) return false;
    this.inbox.delete(id);
    this.answered.set(id, {
      requesterId: entry.requesterId,
      until: entry.expiresAt,
      announced: o.decision === 'approve' ? 'approved' : 'denied',
    });
    while (this.answered.size > CFG.MAX_INBOX * 2) {
      this.answered.delete(this.answered.keys().next().value!);
    }
    this.env.emit(
      {
        t: 'approval.resolve',
        id,
        decision: o.decision,
        reason: cleanText(o.reason, CFG.MAX_REASON_CHARS),
        scope: o.scope === 'session' ? 'session' : 'once',
        bind: {
          tool: entry.tool,
          argsHash: entry.argsHash,
          agentId: entry.agentId,
          userId: entry.requesterId,
        },
      },
      [entry.requesterId],
    );
    this.env.callHook(HOOK_RESOLVED, {
      id,
      status: o.decision === 'approve' ? 'approved' : 'denied',
      reason: cleanText(o.reason, CFG.MAX_REASON_CHARS),
      resolvedBy: me.name,
      scope: o.scope === 'session' ? 'session' : 'once',
      local: false,
    });
    return true;
  }

  /** Every record this client made, newest last (a copy). */
  ownRecords(): ApprovalRecord[] {
    this.ensureLoaded();
    this.expireDue();
    return [...this.records.values()].map((r) => structuredClone(r));
  }

  /** Requests waiting for this user's answer: their own, and those relayed by others. */
  listPending(): Array<ApprovalRequestPayload & { requesterId: string; local: boolean }> {
    this.ensureLoaded();
    this.expireDue();
    const me = this.localId();
    const own = [...this.records.values()]
      .filter((r) => r.status === 'pending' && me && this.eligible(r, me))
      .map((r) => ({ ...this.toPayload(r), requesterId: r.requesterId, local: true }));
    const remote = [...this.inbox.values()].map((e) => ({
      id: e.id,
      agentId: e.agentId,
      sessionId: e.sessionId,
      tool: e.tool,
      args: e.args,
      argsHash: e.argsHash,
      category: e.category,
      approver: e.approver,
      ...(e.replay ? { replay: true as const } : {}),
      createdAt: e.createdAt,
      expiresAt: e.expiresAt,
      requesterId: e.requesterId,
      local: false,
    }));
    return [...own, ...remote];
  }

  // ---- approval_status ------------------------------------------------------------------

  /** Only the agent and user that made a request may read it; anyone else sees "not found". */
  statusFor(id: string, ctx: OpContext): DispatchResult {
    this.ensureLoaded();
    this.expireDue();
    const r = this.records.get(id);
    if (!r || r.agentId !== ctx.agent.id || r.requesterId !== ctx.user.id) {
      return {
        error: { code: 'INVALID_ARGS', message: this.env.t('AGENT_GATEWAY.Approvals.notFound') },
      };
    }
    const t = (k: string, d: Record<string, string> = {}) =>
      this.env.t(`AGENT_GATEWAY.Approvals.${k}`, { id: r.id, ...d });
    switch (r.status) {
      case 'pending':
        return { text: t('statusPending'), structured: { id: r.id, status: 'pending' } };
      case 'denied':
        return {
          text: t('statusDenied', { reason: r.reason ?? '' }),
          structured: { id: r.id, status: 'denied', reason: r.reason ?? '' },
        };
      case 'expired':
        return { text: t('statusExpired'), structured: { id: r.id, status: 'expired' } };
      default:
        return r.result
          ? {
              text: t('statusApproved', { result: r.result.text }),
              structured: {
                id: r.id,
                status: 'approved',
                result: r.result.text,
                resultFailed: r.result.failed,
              },
            }
          : { text: t('statusRunning'), structured: { id: r.id, status: 'approved' } };
    }
  }

  // ---- the socket -----------------------------------------------------------------------

  /** Users who should be shown a request now: eligible, other than this client, and online. */
  private recipients(r: ApprovalRecord, onlyEligible = true): string[] {
    const me = this.localId();
    return this.env
      .users()
      .filter((u) => u.id !== me && u.active && (!onlyEligible || this.eligible(r, u.id)))
      .filter((u) => u.isGM || u.id === r.agentOwnerId)
      .map((u) => u.id);
  }

  private sendRequest(r: ApprovalRecord, to: string[]): void {
    if (to.length === 0) return; // Nobody online: the request stays queued.
    this.env.emit({ t: 'approval.request', ...this.toPayload(r) }, to);
  }

  /** Send every open request to one user who has just connected, if they may answer it. */
  representTo(userId: string): void {
    this.ensureLoaded();
    this.expireDue();
    for (const r of this.records.values()) {
      if (r.status === 'pending' && this.eligible(r, userId)) this.sendRequest(r, [userId]);
    }
  }

  /** Send every open request to every eligible user online (after a link reconnect or reload). */
  representAll(): void {
    this.ensureLoaded();
    this.expireDue();
    for (const r of this.records.values()) {
      if (r.status === 'pending') this.sendRequest(r, this.recipients(r));
    }
  }

  /**
   * Handle a message from the module socket. `senderId` is the id the server appended and the only
   * thing used to decide who sent it.
   */
  handleSocket(data: unknown, senderId: unknown): void {
    if (!isObj(data) || !isStr(senderId, 64) || senderId === '') return;
    if (senderId === this.localId()) return;
    this.ensureLoaded();
    this.expireDue();
    switch (data.t) {
      case 'approval.request':
        return this.onRequest(data, senderId);
      case 'approval.resolve':
        return this.onResolve(data, senderId);
      case 'approval.resolved':
        return this.onResolved(data, senderId);
    }
  }

  private onResolve(data: Record<string, unknown>, senderId: string): void {
    if (!isStr(data.id, 64)) return;
    const r = this.records.get(data.id);
    if (!r || r.requesterId !== this.localId()) return;
    if (data.decision !== 'approve' && data.decision !== 'deny') return;
    const bind = isObj(data.bind) ? data.bind : undefined;
    if (!bind) return;
    const scope: ApprovalScope = data.scope === 'session' ? 'session' : 'once';
    this.applyResolution(
      r,
      senderId,
      {
        decision: data.decision,
        reason: typeof data.reason === 'string' ? data.reason : '',
        scope,
      },
      bind as { tool: unknown; argsHash: unknown; agentId: unknown; userId: unknown },
    );
  }

  private onRequest(data: Record<string, unknown>, senderId: string): void {
    const me = this.env.localUser();
    const sender = this.env.user(senderId);
    // Only a GM answers other people's requests, and only a known user can send one.
    if (!me?.isGM || !sender) return;
    if (
      !isStr(data.id, 64) ||
      !ID_PATTERN.test(data.id) ||
      !isStr(data.agentId, 200) ||
      !isStr(data.sessionId, 200) ||
      !isStr(data.tool, 100) ||
      !isStr(data.argsHash, 64) ||
      (data.approver !== 'owner' && data.approver !== 'gm') ||
      !isNum(data.createdAt) ||
      !isNum(data.expiresAt)
    ) {
      return;
    }
    // The hash shown to the approver and echoed back must be the hash of the arguments shown.
    if (data.argsHash !== callHash(data.tool, data.args)) return;
    // The category is the registry's, never the sender's, and an unknown tool is not shown at all.
    const def = this.opts.tools
      ? this.opts.tools.find((d) => d.name === data.tool)
      : toolRegistry.info(data.tool);
    if (!def) return;
    // The sender cannot keep a request alive longer than this client's own limit.
    const now = this.env.now();
    const expiresAt = Math.min(data.expiresAt, now + CFG.APPROVAL_TTL_MS);
    if (now >= expiresAt) return;
    const existing = this.inbox.get(data.id);
    if (existing) return; // Duplicate re-send, or a clash with another sender's id: first wins.
    if (this.inbox.size >= CFG.MAX_INBOX) return;
    if (
      [...this.inbox.values()].filter((e) => e.requesterId === senderId).length >=
      CFG.MAX_INBOX_PER_SENDER
    )
      return;
    const entry: InboxEntry = {
      id: data.id,
      agentId: data.agentId,
      sessionId: data.sessionId,
      tool: data.tool,
      args: data.args,
      argsHash: data.argsHash,
      category: actionCategory(
        def.name,
        data.args,
        def.category,
        !('origin' in def) || def.origin === 'core',
      ),
      approver: data.approver,
      ...(data.replay === true ? { replay: true as const } : {}),
      createdAt: data.createdAt,
      expiresAt,
      requesterId: senderId,
      requesterName: sender.name,
      receivedAt: now,
    };
    this.inbox.set(entry.id, entry);
    this.env.callHook(HOOK_REQUESTED, {
      id: entry.id,
      agentId: entry.agentId,
      sessionId: entry.sessionId,
      tool: entry.tool,
      args: entry.args,
      argsHash: entry.argsHash,
      category: entry.category,
      approver: entry.approver,
      createdAt: entry.createdAt,
      expiresAt: entry.expiresAt,
      requesterId: senderId,
      requesterName: sender.name,
      local: false,
    });
  }

  private onResolved(data: Record<string, unknown>, senderId: string): void {
    if (!isStr(data.id, 64)) return;
    const status = isStr(data.status, 20) ? data.status : 'expired';
    const e = this.inbox.get(data.id);
    const a = this.answered.get(data.id);
    // Only the user who made the request can close it, or correct what this client announced.
    if (e && e.requesterId === senderId) {
      this.inbox.delete(data.id);
    } else if (a && a.requesterId === senderId) {
      this.answered.delete(data.id);
      // Two approvers answered at once and the other one won: say what really happened.
      if (a.announced === status) return;
    } else {
      return;
    }
    this.env.callHook(HOOK_RESOLVED, {
      id: data.id,
      status,
      reason: '',
      resolvedBy: '',
      scope: 'once',
      local: false,
    });
  }

  private ensureLoaded(): void {
    if (this.loadedFor !== this.localId()) this.load();
  }
}
