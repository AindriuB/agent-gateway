import {
  AgentEvent,
  EVENT_BUFFER_CONFIG,
  EVENT_CONFIG,
  type EventReadOutput,
} from '@agent-gateway/protocol';
import { LinkCallError, type LinkConnection, type LinkRegistry } from '../link/index.js';
import { toolsets as defaultToolsets, type ToolsetStore } from '../routing/toolsets.js';
import type { Store } from '../store/index.js';
import { EventCursorError, type EventOwner } from './repository.js';
type Stream = { conn: LinkConnection; lastSeq: number };
type Waiter = { session: string; check(): void; stop(error: LinkCallError): void };
const key = (c: EventOwner) => JSON.stringify([c.worldId, c.userId, c.agentId]);
/** Bounded online read service. SQLite stores payloads; memory retains only live stream hints/waiters. */
export class EventBuffer {
  private readonly streams = new WeakMap<LinkConnection, Stream>();
  private readonly previous = new Map<string, Stream>();
  private readonly waiters = new Set<Waiter>();
  private readonly toolsets: ToolsetStore;
  private readonly offRevoked: () => void;
  private stopped = false;
  private readonly changed = () => {
    for (const w of [...this.waiters]) w.check();
  };
  constructor(
    private readonly store: Store,
    private readonly registry: LinkRegistry,
    toolsets = defaultToolsets,
    private readonly now = Date.now,
  ) {
    this.toolsets = toolsets;
    registry.on('connected', this.changed);
    registry.on('disconnected', this.changed);
    toolsets.on('changed', this.changed);
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
    if (!this.toolsets.eventReadAllowed(conn))
      throw new LinkCallError(
        'FORBIDDEN',
        'Event reads require an explicit allow policy announcement',
      );
  }
  connect(conn: LinkConnection, resume?: { connectionId: string; lastSeq: number }) {
    this.online(conn);
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
        stop: (error) => {
          release();
          reject(error);
        },
        check: () => {
          try {
            const result = this.read(conn, after, limit);
            if (result.events.length || result.cursorGap) {
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
  history(conn: LinkConnection): never {
    this.authorize(conn);
    throw new LinkCallError('FORBIDDEN', 'Offline event history is not enabled');
  }
  cancelSession(session: string) {
    for (const w of [...this.waiters])
      if (w.session === session) w.stop(new LinkCallError('INTERNAL', 'Event session closed'));
  }
  close() {
    this.stopped = true;
    for (const w of [...this.waiters])
      w.stop(new LinkCallError('WORLD_OFFLINE', 'Gateway event service stopped'));
    this.registry.off('connected', this.changed);
    this.registry.off('disconnected', this.changed);
    this.toolsets.off('changed', this.changed);
    this.offRevoked();
    this.previous.clear();
  }
}
