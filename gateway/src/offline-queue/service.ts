import { isDeepStrictEqual } from 'node:util';
import {
  MAX_FRAME_BYTES,
  validateArgs,
  TOOL_NAME_PATTERN,
  TOOLS,
  toJsonSchema,
  type LinkMessage,
} from '@agent-gateway/protocol';
import type { Store } from '../store/store.js';
import { LinkCallError, type LinkConnection, type LinkRegistry } from '../link/registry.js';
import { toolsets, type ToolsetStore } from '../routing/toolsets.js';
import { QUEUE_CONFIG, type QueueOwner } from './repository.js';
export class OfflineQueue {
  private timer: ReturnType<typeof setInterval>;
  private readonly changed: (c: LinkConnection) => void;
  private readonly disconnected: (c: LinkConnection) => void;
  private readonly offRevoked: () => void;
  constructor(
    private store: Store,
    private registry: LinkRegistry,
    private sets: ToolsetStore = toolsets,
    private now: () => number = Date.now,
  ) {
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
        store.queue.cleanup(now());
      } catch {
        /* Admission/read remains fail-closed on storage failure. */
      }
    }, QUEUE_CONFIG.cleanupMs);
    this.timer.unref();
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
  enqueue(owner: QueueOwner, sessionId: string, name: string, args: unknown, signal?: AbortSignal) {
    if (signal?.aborted) throw new LinkCallError('INTERNAL', 'Request aborted before queue commit');
    this.owner(owner, owner);
    const def = this.store.queue.catalog(owner)?.find((t) => t.name === name);
    if (!def || def.category === 'read')
      throw new LinkCallError('FORBIDDEN', 'No validated offline write catalog for this tool');
    const core = TOOLS.find((t) => t.name === name);
    if (!core && TOOL_NAME_PATTERN.test(name))
      throw new LinkCallError('FORBIDDEN', 'Unknown canonical core tool');
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
    return this.store.queue.enqueue(
      owner,
      sessionId,
      def,
      parsed.value as Record<string, unknown>,
      this.now(),
    );
  }
  isRead(owner: QueueOwner, name: string) {
    return this.store.queue.catalog(owner)?.find((t) => t.name === name)?.category === 'read';
  }
  status(owner: QueueOwner, id: string) {
    this.owner(owner, owner);
    this.store.queue.cleanup(this.now());
    return this.store.queue.get(owner, id);
  }
  deliver(c: LinkConnection) {
    if (!this.current(c)) return;
    this.store.queue.cleanup(this.now());
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
