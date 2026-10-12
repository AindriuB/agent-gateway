import { EventEmitter } from 'node:events';
import {
  AgentEvent,
  EVENT_BUFFER_CONFIG,
  EVENT_CONFIG,
  type EventReadOutput,
} from '@agent-gateway/protocol';
import { LinkCallError, type LinkConnection, type LinkRegistry } from '../link/index.js';
import { toolsets as defaultToolsets, type ToolsetStore } from '../routing/toolsets.js';
import type { Store } from '../store/index.js';
import { EventCursorError, type EventOwner, type OfflineEventPolicy } from './repository.js';
type Stream = { conn: LinkConnection; lastSeq: number };
type Waiter = {
  session: string;
  worldId: string;
  check(force?: boolean): void;
  stop(error: LinkCallError): void;
};
const key = (c: EventOwner) => JSON.stringify([c.worldId, c.userId, c.agentId]);
/** Bounded online read service. SQLite stores payloads; memory retains only live stream hints/waiters. */
export class EventBuffer extends EventEmitter<{ changed: [] }> {
  private readonly streams = new WeakMap<LinkConnection, Stream>();
  private readonly previous = new Map<string, Stream>();
  private readonly waiters = new Set<Waiter>();
  private readonly toolsets: ToolsetStore;
  private readonly offRevoked: () => void;
  private stopped = false;
  private readonly failedOwners = new Set<string>();
  private readonly failedWorlds = new Set<string>();
  private retentionTimer: ReturnType<typeof setInterval> | undefined;
  private readonly authorizationChanged = (conn: LinkConnection) => {
    if (this.registry.get(conn.worldId, conn.userId) !== conn || conn.closed) return;
    if (!this.store.isPairingActive(conn.agentId, conn.worldId, conn.userId)) return;
    try {
      this.store.events.setReadAllowed(this.owner(conn), this.toolsets.eventReadAllowed(conn));
      this.failedOwners.delete(key(this.owner(conn)));
    } catch {
      if (this.failedOwners.size >= EVENT_CONFIG.MAX_PENDING_UPDATES) this.stopped = true;
      else this.failedOwners.add(key(this.owner(conn)));
      this.toolsets.revokeEventReads(conn);
      conn.close();
    }
    this.changed();
  };
  private readonly changed = () => {
    for (const w of [...this.waiters]) w.check();
    this.emit('changed');
  };
  constructor(
    private readonly store: Store,
    private readonly registry: LinkRegistry,
    toolsets = defaultToolsets,
    private readonly now = Date.now,
  ) {
    super();
    this.toolsets = toolsets;
    registry.on('connected', this.changed);
    registry.on('disconnected', this.changed);
    toolsets.on('changed', this.authorizationChanged);
    this.offRevoked = store.onPairingRevoked(this.changed);
  }
  get pendingCount() {
    return this.waiters.size;
  }
  private owner(conn: LinkConnection): EventOwner {
    return { worldId: conn.worldId, userId: conn.userId, agentId: conn.agentId };
  }
  private online(conn: LinkConnection) {
    if (this.stopped || conn.closed || this.registry.get(conn.worldId, conn.userId) !== conn)
      throw new LinkCallError('WORLD_OFFLINE', 'The bound connection is no longer online');
    if (!this.store.isPairingActive(conn.agentId, conn.worldId, conn.userId))
      throw new LinkCallError('FORBIDDEN', 'The bound pairing is no longer active');
  }
  authorize(conn: LinkConnection) {
    this.online(conn);
    if (this.failedWorlds.has(conn.worldId))
      throw new LinkCallError('FORBIDDEN', 'World event policy could not be persisted');
    if (this.failedOwners.has(key(this.owner(conn))) || !this.toolsets.eventReadAllowed(conn))
      throw new LinkCallError(
        'FORBIDDEN',
        'Event reads require an explicit allow policy announcement',
      );
  }
  connect(conn: LinkConnection, resume?: { connectionId: string; lastSeq: number }) {
    this.online(conn);
    try {
      this.store.events.setReadAllowed(this.owner(conn), false);
    } catch {
      if (this.failedOwners.size >= EVENT_CONFIG.MAX_PENDING_UPDATES) this.stopped = true;
      else this.failedOwners.add(key(this.owner(conn)));
      conn.close();
      throw new LinkCallError('INTERNAL', 'Cannot clear retained event authorization');
    }
    const owner = this.owner(conn),
      k = key(owner),
      prior = this.previous.get(k);
    if (this.store.events.ensureStream(owner)) {
      const missed =
        prior && resume?.connectionId === prior.conn.id && resume.lastSeq >= prior.lastSeq
          ? resume.lastSeq - prior.lastSeq
          : 'unknown';
      this.store.events.append(
        owner,
        {
          type: 'gap',
          ts: this.now(),
          userId: conn.userId,
          summary: 'Connection interrupted; offline activity is not observed',
          missed,
        },
        this.now(),
      );
    }
    const stream = { conn, lastSeq: 0 };
    this.streams.set(conn, stream);
    this.previous.delete(k);
    this.previous.set(k, stream);
    // Old inactive inference hints may be forgotten; missing hints produce an honest unknown gap.
    if (this.previous.size > EVENT_CONFIG.MAX_PENDING_UPDATES)
      this.previous.delete(this.previous.keys().next().value!);
    this.changed();
  }
  accept(conn: LinkConnection, input: unknown) {
    this.online(conn);
    const event = AgentEvent.parse(input),
      stream = this.streams.get(conn);
    if (
      !stream ||
      event.userId !== conn.userId ||
      event.type === 'gap' ||
      event.seq <= stream.lastSeq
    )
      throw new LinkCallError('INVALID_ARGS', 'Invalid authenticated event stream');
    this.store.events.append(this.owner(conn), event, this.now());
    stream.lastSeq = event.seq;
    this.changed();
  }
  private read(conn: LinkConnection, after: number | undefined, limit: number) {
    this.authorize(conn);
    try {
      return this.store.events.read(this.owner(conn), after, limit);
    } catch (e) {
      if (e instanceof EventCursorError) throw new LinkCallError('INVALID_ARGS', e.message);
      throw e;
    }
  }
  poll(
    conn: LinkConnection,
    session: string,
    after: number | undefined,
    limit: number,
    signal?: AbortSignal,
  ): Promise<EventReadOutput> {
    const initial = this.read(conn, after, limit);
    if (signal?.aborted)
      return Promise.reject(new LinkCallError('INTERNAL', 'Event poll cancelled'));
    if ([...this.waiters].some((w) => w.session === session))
      throw new LinkCallError('RATE_LIMITED', 'Only one event poll may wait per session');
    if (initial.events.length || initial.cursorGap) return Promise.resolve(initial);
    if (this.waiters.size >= EVENT_BUFFER_CONFIG.MAX_PENDING_POLLS)
      throw new LinkCallError('RATE_LIMITED', 'Gateway event poll capacity reached');
    return new Promise((resolve, reject) => {
      const release = () => {
        if (timer) clearTimeout(timer);
        this.waiters.delete(waiter);
        signal?.removeEventListener('abort', aborted);
      };
      const waiter: Waiter = {
        session,
        worldId: conn.worldId,
        stop: (error) => {
          release();
          reject(error);
        },
        check: (force = false) => {
          try {
            const result = this.read(conn, after, limit);
            if (force || result.events.length || result.cursorGap) {
              release();
              resolve(result);
            }
          } catch (e) {
            release();
            reject(e);
          }
        },
      };
      const aborted = () => waiter.stop(new LinkCallError('INTERNAL', 'Event poll cancelled'));
      this.waiters.add(waiter);
      signal?.addEventListener('abort', aborted, { once: true });
      const timer = setTimeout(() => {
        try {
          const result = this.read(conn, after, limit);
          release();
          resolve(result);
        } catch (e) {
          release();
          reject(e);
        }
      }, EVENT_BUFFER_CONFIG.POLL_TIMEOUT_MS);
    });
  }
  ownerFor(pair: { worldId: string; userId: string }, pinnedAgentId?: string): EventOwner {
    const conn = this.registry.get(pair.worldId, pair.userId);
    if (conn && !conn.closed) {
      this.online(conn);
      if (pinnedAgentId && pinnedAgentId !== conn.agentId)
        throw new LinkCallError('FORBIDDEN', 'Event pairing changed');
      return this.owner(conn);
    }
    if (pinnedAgentId) {
      if (!this.store.isPairingActive(pinnedAgentId, pair.worldId, pair.userId))
        throw new LinkCallError('FORBIDDEN', 'Event pairing revoked');
      return { ...pair, agentId: pinnedAgentId };
    }
    const pairs = this.store
      .listActivePairings()
      .filter((p) => p.worldId === pair.worldId && p.userId === pair.userId);
    if (pairs.length !== 1)
      throw new LinkCallError('FORBIDDEN', 'An exact active pairing is required');
    return { ...pair, agentId: pairs[0]!.id };
  }
  authorizeOwner(owner: EventOwner, history = false): LinkConnection | undefined {
    if (this.stopped) throw new LinkCallError('WORLD_OFFLINE', 'Gateway event service stopped');
    if (!this.store.isPairingActive(owner.agentId, owner.worldId, owner.userId))
      throw new LinkCallError('FORBIDDEN', 'The bound pairing is no longer active');
    if (this.failedWorlds.has(owner.worldId))
      throw new LinkCallError('FORBIDDEN', 'World event policy could not be persisted');
    const policy = this.store.events.policy(owner.worldId);
    const conn = this.registry.get(owner.worldId, owner.userId);
    if (conn && !conn.closed) {
      if (conn.agentId !== owner.agentId) throw new LinkCallError('FORBIDDEN', 'Pairing changed');
      this.authorize(conn);
      if (history && !policy.enabled)
        throw new LinkCallError('FORBIDDEN', 'Offline event history is not enabled');
      return conn;
    }
    if (!policy.enabled)
      throw new LinkCallError('WORLD_OFFLINE', 'Offline event reading is not enabled');
    if (this.failedOwners.has(key(owner)) || !this.store.events.readAllowed(owner))
      throw new LinkCallError('FORBIDDEN', 'No retained read authorization');
    return undefined;
  }
  readOffline(owner: EventOwner, after: number | undefined, limit: number) {
    this.authorizeOwner(owner);
    try {
      return this.store.events.read(owner, after, limit);
    } catch (e) {
      if (e instanceof EventCursorError) throw new LinkCallError('INVALID_ARGS', e.message);
      throw e;
    }
  }
  history(owner: EventOwner, since: number, types: readonly string[] | undefined, limit: number) {
    this.authorizeOwner(owner, true);
    try {
      return this.store.events.history(owner, since, types, limit);
    } catch (e) {
      if (e instanceof EventCursorError) throw new LinkCallError('INVALID_ARGS', e.message);
      throw e;
    }
  }
  setPolicy(conn: LinkConnection, policy: OfflineEventPolicy) {
    this.online(conn);
    try {
      this.store.events.setPolicy(conn.worldId, policy);
    } catch (e) {
      if (this.failedWorlds.size >= EVENT_CONFIG.MAX_PENDING_UPDATES) this.stopped = true;
      else this.failedWorlds.add(conn.worldId);
      this.changed();
      throw e;
    }
    this.failedWorlds.delete(conn.worldId);
    try {
      this.runRetention();
    } catch {
      /* Accepted policy is durable; retry retention hourly. */
    }
    this.changed();
  }
  purge(conn: LinkConnection): number {
    this.online(conn);
    const count = this.store.events.purge(conn.worldId);
    for (const waiter of [...this.waiters]) if (waiter.worldId === conn.worldId) waiter.check(true);
    this.changed();
    return count;
  }
  private runRetention() {
    const count = this.store.events.retain(this.now());
    if (count) this.changed();
  }
  startRetention() {
    if (this.stopped || this.retentionTimer) return;
    this.runRetention();
    this.retentionTimer = setInterval(
      () => {
        try {
          this.runRetention();
        } catch {
          /* Retain payloads on transient storage failure; retry at the next interval. */
        }
      },
      60 * 60 * 1000,
    );
    this.retentionTimer.unref();
  }
  cancelSession(session: string) {
    for (const w of [...this.waiters])
      if (w.session === session) w.stop(new LinkCallError('INTERNAL', 'Event session closed'));
  }
  close() {
    this.stopped = true;
    if (this.retentionTimer) clearInterval(this.retentionTimer);
    this.retentionTimer = undefined;
    for (const w of [...this.waiters])
      w.stop(new LinkCallError('WORLD_OFFLINE', 'Gateway event service stopped'));
    this.registry.off('connected', this.changed);
    this.registry.off('disconnected', this.changed);
    this.toolsets.off('changed', this.authorizationChanged);
    this.offRevoked();
    this.previous.clear();
  }
}
