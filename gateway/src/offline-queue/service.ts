import { isDeepStrictEqual } from 'node:util';
import {
  MAX_FRAME_BYTES,
  validateArgs,
  TOOL_NAME_PATTERN,
  TOOLS,
  toJsonSchema,
  sniffImage,
  type LinkMessage,
} from '@agent-gateway/protocol';
import type { Store } from '../store/store.js';
import { LinkCallError, type LinkConnection, type LinkRegistry } from '../link/registry.js';
import { toolsets, type ToolsetStore } from '../routing/toolsets.js';
import { QUEUE_CONFIG, hashArgs, type QueueOwner } from './repository.js';
type ReportState = 'pending' | 'approved' | 'denied' | 'expired';
const EARLY_REPORTS_PER_CONNECTION = 32;
const EARLY_REPORT_MS = 30_000;
const IMAGE_SCAN_LIMIT = 1_000_000;
/**
 * True when any value in the arguments looks like image bytes: a data URL or base64 text (any
 * `data:<type>;base64,` prefix, leading whitespace and line breaks allowed) that sniffs as an
 * image, or an array of integers whose first bytes are an image header.
 */
export function carriesImage(v: unknown, budget = { n: IMAGE_SCAN_LIMIT }): boolean {
  if (typeof v === 'string') {
    budget.n -= v.length;
    if (/^\s*data:image\//i.test(v)) return true;
    const head = v
      .slice(0, 256)
      .replace(/^\s+/, '')
      .replace(/^data:[^,]*;base64,/i, '')
      .replace(/\s+/g, '')
      .slice(0, 64);
    return v.length >= 16 && /^[A-Za-z0-9+/_-]+={0,2}$/.test(head)
      ? sniffImage(Buffer.from(head, 'base64')) !== null
      : false;
  }
  if (budget.n < 0) return true;
  if (Array.isArray(v)) {
    if (v.length > 8) {
      const first = v.slice(0, 12);
      if (first.every((x) => Number.isInteger(x) && x >= 0 && x <= 255))
        if (sniffImage(Uint8Array.from(first as number[])) !== null) return true;
    }
    return v.some((x) => carriesImage(x, budget));
  }
  if (v && typeof v === 'object') return Object.values(v).some((x) => carriesImage(x, budget));
  return false;
}
export class OfflineQueue {
  private timer: ReturnType<typeof setInterval>;
  private readonly changed: (c: LinkConnection) => void;
  private readonly disconnected: (c: LinkConnection) => void;
  private readonly offRevoked: () => void;
  /** Connections whose module has sent its post-hello approval list (protocol 7.2.0). */
  private readonly capableIds = new Set<string>();
  /** Reports that beat their row (the result frame is still on its way): per connection, bounded. */
  private readonly early = new Map<string, Map<string, { state: ReportState; at: number }>>();
  constructor(
    private store: Store,
    private registry: LinkRegistry,
    private sets: ToolsetStore = toolsets,
    private now: () => number = Date.now,
  ) {
    try {
      store.queue.orphanLive(now());
      store.queue.expireOrphans(now());
    } catch {
      /* The sweep below still fails closed. */
    }
    store.queue.recover(now());
    this.changed = (c) => {
      if (!this.current(c)) return;
      try {
        store.queue.setCatalog(c, sets.catalog(c));
        this.deliver(c);
      } catch {
        registry.remove(c);
        sets.revokeEventReads(c);
        c.close();
      }
    };
    this.disconnected = (c) => {
      this.capableIds.delete(c.id);
      try {
        store.queue.disconnected(c.id, now());
      } catch {
        /* Claimed rows also recover as unknown after restart. */
      }
    };
    sets.on('changed', this.changed);
    registry.on('disconnected', this.disconnected);
    this.offRevoked = store.onPairingRevoked(() => {
      for (const c of registry.list())
        if (!store.isPairingActive(c.agentId, c.worldId, c.userId)) {
          registry.remove(c);
          c.close();
        }
    });
    this.timer = setInterval(() => {
      try {
        this.sweep();
      } catch {
        /* Admission/read remains fail-closed on storage failure. */
      }
    }, QUEUE_CONFIG.cleanupMs);
    this.timer.unref();
  }
  /** Expire overdue orphans before the general cleanup would mark them `unknown`. */
  private sweep() {
    const t = this.now();
    for (const [id, m] of this.early) {
      for (const [k, v] of m) if (t - v.at > EARLY_REPORT_MS) m.delete(k);
      if (!m.size) this.early.delete(id);
    }
    this.store.queue.expireOrphans(this.now());
    this.store.queue.cleanup(this.now());
  }
  capable(c: LinkConnection) {
    return this.capableIds.has(c.id);
  }
  private current(c: LinkConnection) {
    return (
      !c.closed &&
      this.registry.get(c.worldId, c.userId) === c &&
      this.store.isPairingActive(c.agentId, c.worldId, c.userId)
    );
  }
  owner(pair: { worldId: string; userId: string }, pinned?: QueueOwner): QueueOwner {
    if (pinned) {
      if (pinned.worldId !== pair.worldId || pinned.userId !== pair.userId)
        throw new LinkCallError('FORBIDDEN', 'Queued owner mismatch');
      if (!this.store.isPairingActive(pinned.agentId, pair.worldId, pair.userId))
        throw new LinkCallError('FORBIDDEN', 'Queued pairing revoked');
      const c = this.registry.get(pair.worldId, pair.userId);
      if (c && c.agentId !== pinned.agentId)
        throw new LinkCallError('FORBIDDEN', 'Queued pairing replaced');
      return pinned;
    }
    const c = this.registry.get(pair.worldId, pair.userId);
    if (c && this.current(c)) return { worldId: c.worldId, userId: c.userId, agentId: c.agentId };
    const rows = this.store
      .listActivePairings()
      .filter((p) => p.worldId === pair.worldId && p.userId === pair.userId);
    if (rows.length !== 1)
      throw new LinkCallError('FORBIDDEN', 'Choose an exact unambiguous active pairing');
    return { ...pair, agentId: rows[0]!.id };
  }
  /** The queue's own admission checks, shared by the offline enqueue and the live mirror. */
  private admit(owner: QueueOwner, name: string, args: unknown) {
    const def = this.store.queue.catalog(owner)?.find((t) => t.name === name);
    if (!def || def.category === 'read')
      throw new LinkCallError('FORBIDDEN', 'No validated offline write catalog for this tool');
    const core = TOOLS.find((t) => t.name === name);
    if (!core && TOOL_NAME_PATTERN.test(name))
      throw new LinkCallError('FORBIDDEN', 'Unknown canonical core tool');
    if (core?.redactArgs?.length)
      throw new LinkCallError(
        'WORLD_OFFLINE',
        `${name} carries file data and is not held while the world is offline. Nothing was stored or run. Retry once the user has the world open with Agent Gateway connected.`,
      );
    if (
      core &&
      (core.handledBy !== 'module' ||
        !isDeepStrictEqual(
          {
            ...toJsonSchema(core),
            name: core.name,
            category: core.category,
            minRole: core.minRole,
            description: core.description,
          },
          def,
        ))
    )
      throw new LinkCallError('FORBIDDEN', 'Offline core definition changed');
    const coreParsed = core?.input.safeParse(args ?? {});
    const parsed = coreParsed
      ? coreParsed.success
        ? { ok: true as const, value: coreParsed.data }
        : { ok: false as const, issues: coreParsed.error.issues }
      : validateArgs(def.inputSchema, args ?? {});
    if (!parsed.ok)
      throw new LinkCallError(
        'INVALID_ARGS',
        'Invalid queued arguments: ' + parsed.issues.map((i) => i.message).join('; '),
      );
    return { def, value: parsed.value as Record<string, unknown> };
  }
  enqueue(owner: QueueOwner, sessionId: string, name: string, args: unknown, signal?: AbortSignal) {
    if (signal?.aborted) throw new LinkCallError('INTERNAL', 'Request aborted before queue commit');
    this.owner(owner, owner);
    const { def, value } = this.admit(owner, name, args);
    // An orphaned or requeued mirrored approval for this very call is still open: reuse it.
    this.sweep();
    const open = this.store.queue.findOpenAlias(owner, name, hashArgs(JSON.stringify(value)));
    if (open) return open;
    return this.store.queue.enqueue(owner, sessionId, def, value, this.now());
  }
  /**
   * Mirror a live `pending_approval` so it can outlive the requester's tab. Only for a capable
   * connection; skipped, never failing the call, when the queue would not have admitted the call,
   * when the tool carries file data, or when the arguments hold image bytes.
   */
  recordLive(
    c: LinkConnection,
    sessionId: string,
    name: string,
    args: unknown,
    alias: string,
    /** Whether the connection was capable when the call began (it may have closed since). */
    wasCapable = this.capable(c),
  ) {
    if (!wasCapable || !alias || alias.length > 64) return undefined;
    try {
      const owner: QueueOwner = { worldId: c.worldId, userId: c.userId, agentId: c.agentId };
      if (!this.store.isPairingActive(c.agentId, c.worldId, c.userId)) return undefined;
      const { def, value } = this.admit(owner, name, args);
      if (carriesImage(value)) return undefined;
      const live = !c.closed && this.registry.get(c.worldId, c.userId) === c;
      const now = this.now();
      const row = this.store.queue.insertAlias(
        owner,
        sessionId,
        def,
        value,
        alias,
        live ? c.id : null,
        now,
      );
      const early = this.early.get(c.id);
      const held = early?.get(alias);
      if (held && now - held.at <= EARLY_REPORT_MS) {
        if (live) this.store.queue.report(owner, c.id, alias, held.state, now);
        else if (held.state !== 'pending')
          this.store.queue.reportOrphan(owner, alias, held.state, now);
      }
      early?.delete(alias);
      return row;
    } catch {
      return undefined;
    }
  }
  /** The module's `approvalState` frame: a transition, or the pending list after a hello. */
  approvalState(c: LinkConnection, msg: Extract<LinkMessage, { type: 'approvalState' }>) {
    if (!this.current(c)) throw new LinkCallError('FORBIDDEN', 'Stale approval state connection');
    const owner: QueueOwner = { worldId: c.worldId, userId: c.userId, agentId: c.agentId };
    if (msg.ids) {
      this.capableIds.add(c.id);
      this.store.queue.expireOrphans(this.now());
      this.store.queue.reconcile(owner, c.id, new Set(msg.ids), this.now());
      // Tell the module which of its records this connection now owns, before anything is replayed.
      const owned = this.store.queue.ownedAliases(owner, c.id, msg.ids);
      try {
        c.send(JSON.stringify({ type: 'approvalOwnership', ids: owned }));
      } catch {
        /* A dead socket is handled by the close path; the module withdraws on its own timeout. */
      }
      this.deliver(c);
    } else if (this.capableIds.has(c.id) && msg.id && msg.state) {
      const now = this.now();
      if (
        !this.store.queue.report(owner, c.id, msg.id, msg.state, now) &&
        !this.store.queue.getByAlias(owner, msg.id) &&
        msg.state !== 'pending'
      ) {
        // The row is not written yet (its call result is still being processed): keep the report.
        let held = this.early.get(c.id);
        if (!held) this.early.set(c.id, (held = new Map()));
        for (const [k, v] of held) if (now - v.at > EARLY_REPORT_MS) held.delete(k);
        if (held.size < EARLY_REPORTS_PER_CONNECTION)
          held.set(msg.id, { state: msg.state, at: now });
      }
    }
  }
  isRead(owner: QueueOwner, name: string) {
    return this.store.queue.catalog(owner)?.find((t) => t.name === name)?.category === 'read';
  }
  status(owner: QueueOwner, id: string) {
    this.owner(owner, owner);
    this.sweep();
    return this.store.queue.get(owner, id) ?? this.store.queue.getByAlias(owner, id);
  }
  deliver(c: LinkConnection) {
    if (!this.current(c)) return;
    this.sweep();
    const catalog = this.sets.catalog(c);
    if (!catalog) return;
    const calls = [];
    for (const row of this.store.queue.queued(c, QUEUE_CONFIG.perOwner)) {
      if (calls.length >= QUEUE_CONFIG.batch) break;
      const def = catalog.find((t) => t.name === row.tool);
      if (!def || !isDeepStrictEqual(def, JSON.parse(row.definition))) {
        this.store.queue.reject(c, row.id, this.now());
        continue;
      }
      const call = {
        id: row.id,
        tool: row.tool,
        args: JSON.parse(row.args),
        sessionId: row.session_id,
        expiresAt: row.expires_at,
        definition: def,
      };
      if (
        Buffer.byteLength(JSON.stringify({ type: 'queuedCalls', calls: [...calls, call] })) >
        MAX_FRAME_BYTES
      )
        break;
      if (this.store.queue.claim(c, row.id, c.id)) calls.push(call);
    }
    if (calls.length) {
      try {
        c.send(JSON.stringify({ type: 'queuedCalls', calls }));
      } catch {
        this.store.queue.disconnected(c.id, this.now());
      }
    }
  }
  accept(c: LinkConnection, msg: Extract<LinkMessage, { type: 'queuedStatus' }>) {
    if (!this.current(c)) throw new LinkCallError('FORBIDDEN', 'Stale replay receipt connection');
    if (
      !this.store.queue.status(c, msg.id, c.id, msg.status, msg.text, this.now(), msg.resultFailed)
    )
      throw new LinkCallError('FORBIDDEN', 'Unclaimed or terminal replay receipt');
    this.deliver(c);
  }
  close() {
    clearInterval(this.timer);
    this.sets.off('changed', this.changed);
    this.registry.off('disconnected', this.disconnected);
    this.offRevoked();
  }
}
