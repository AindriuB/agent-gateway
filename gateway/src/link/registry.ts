import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { ErrorCode } from '@agent-gateway/protocol';

export class LinkCallError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'LinkCallError';
  }
}

export interface CallResult {
  text: string;
  structured?: unknown;
}

export interface LinkTransport {
  send(data: string): void;
  close(): void;
}

interface Pending {
  resolve(r: CallResult): void;
  reject(e: LinkCallError): void;
  timer: ReturnType<typeof setTimeout>;
}

export class LinkConnection {
  closed = false;
  private readonly pending = new Map<string, Pending>();

  constructor(
    readonly id: string,
    readonly agentId: string,
    readonly worldId: string,
    readonly userId: string,
    private readonly transport: LinkTransport,
    /** What the module reported in `hello`; display and tool-list hints only, never authority. */
    readonly info: { userName: string; isGM: boolean } = { userName: '', isGM: false },
  ) {}

  call(
    tool: string,
    args: Record<string, unknown>,
    timeoutMs: number,
    sessionId = '',
  ): Promise<CallResult> {
    if (this.closed) return Promise.reject(new LinkCallError('WORLD_OFFLINE', 'World is offline'));
    const id = randomUUID();
    return new Promise<CallResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new LinkCallError('INTERNAL', `Call ${tool} timed out after ${timeoutMs} ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.transport.send(JSON.stringify({ type: 'call', id, sessionId, tool, args }));
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new LinkCallError('WORLD_OFFLINE', String(e)));
      }
    });
  }

  /** Settle a pending call from a `result` or `error` frame. */
  settle(id: string, outcome: { ok: CallResult } | { err: LinkCallError }): void {
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    clearTimeout(p.timer);
    if ('ok' in outcome) p.resolve(outcome.ok);
    else p.reject(outcome.err);
  }

  /** Mark closed and fail every pending call with WORLD_OFFLINE. */
  markClosed(): void {
    this.closed = true;
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      this.pending.delete(id);
      p.reject(new LinkCallError('WORLD_OFFLINE', 'World disconnected'));
    }
  }

  send(data: string): void {
    this.transport.send(data);
  }

  close(): void {
    this.transport.close();
  }
}

export interface LinkRegistryEvents {
  connected: [LinkConnection];
  disconnected: [LinkConnection];
}

const key = (worldId: string, userId: string): string => JSON.stringify([worldId, userId]);

export class LinkRegistry extends EventEmitter<LinkRegistryEvents> {
  private readonly conns = new Map<string, LinkConnection>();

  get(worldId: string, userId: string): LinkConnection | undefined {
    return this.conns.get(key(worldId, userId));
  }

  list(): LinkConnection[] {
    return [...this.conns.values()];
  }

  /** Registers the connection; a stale duplicate for the same world/user is replaced. */
  add(conn: LinkConnection): void {
    const k = key(conn.worldId, conn.userId);
    const old = this.conns.get(k);
    this.conns.set(k, conn);
    if (old && old !== conn) {
      old.markClosed();
      old.close();
      this.emit('disconnected', old);
    }
    this.emit('connected', conn);
  }

  remove(conn: LinkConnection): void {
    conn.markClosed();
    const k = key(conn.worldId, conn.userId);
    if (this.conns.get(k) === conn) {
      this.conns.delete(k);
      this.emit('disconnected', conn);
    }
  }

  call(
    conn: LinkConnection,
    tool: string,
    args: Record<string, unknown>,
    timeoutMs: number,
    sessionId = '',
  ): Promise<CallResult> {
    return conn.call(tool, args, timeoutMs, sessionId);
  }
}
