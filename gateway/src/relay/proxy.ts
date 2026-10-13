import { randomUUID } from 'node:crypto';
import type { Readable, Writable } from 'node:stream';
import {
  MAX_RELAY_BUFFERED_BYTES,
  MAX_RELAY_LINE_BYTES,
  MAX_RELAY_PENDING,
  RELAY_BUSY,
  RELAY_LOST,
  RELAY_RECONNECTING,
  RELAY_RPC_ERROR,
} from './constants.js';
import { LineSplitter } from './lines.js';
import type { RpcMessage, Upstream } from './upstream.js';

const isRequest = (m: RpcMessage): boolean =>
  typeof m.method === 'string' && m.id !== undefined && m.id !== null;
const isResponse = (m: RpcMessage): boolean =>
  typeof m.method !== 'string' && m.id !== undefined && ('result' in m || 'error' in m);
const key = (id: unknown): string => `${typeof id}:${String(id)}`;

/**
 * A secondary's stdio side: client lines go to the current upstream (a relay socket or an
 * in-process session), replies come back. It tracks in-flight request ids so that a lost
 * upstream can be answered with errors, and captures the client's handshake so a replacement
 * session can be brought to the same state.
 */
export class StdioRelayProxy {
  /** Called once when the current upstream is lost; the owner then attaches a new one. */
  onLost?: () => void;
  /** Called once if the client stopped reading stdout past the cap; the proxy has already stopped. */
  onClientGone?: () => void;
  private up: Upstream | undefined;
  private readonly pending = new Set<string>();
  private initialize: RpcMessage | undefined;
  private initialized = false;
  /** Private to this proxy and unguessable, so it can never collide with a client's own id. */
  private readonly replayId = `relay-replay-${randomUUID()}`;
  private readonly splitter = new LineSplitter(MAX_RELAY_LINE_BYTES, true);
  private started = false;
  private stopped = false;
  private readonly onData = (chunk: Buffer) => this.handleChunk(chunk);
  /** stdout has more queued than it will take right now; stdin and the upstream are paused. */
  private blocked = false;
  private readonly onDrain = () => {
    if (!this.blocked || this.stopped) return;
    this.blocked = false;
    this.input.resume();
    this.up?.resume?.();
  };

  constructor(
    private readonly input: Readable,
    private readonly output: Writable,
    private readonly log: (line: string) => void = () => undefined,
  ) {}

  get pendingCount(): number {
    return this.pending.size;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.input.on('data', this.onData);
    // One drain listener for the proxy's life, not one per write.
    this.output.on('drain', this.onDrain);
  }

  stop(): void {
    this.stopped = true;
    this.pending.clear();
    this.input.off('data', this.onData);
    this.output.off('drain', this.onDrain);
    const up = this.up;
    this.up = undefined;
    up?.close();
  }

  /** Make `up` the live upstream. When the client already handshook, bring the new session up to date. */
  attach(up: Upstream): void {
    if (this.stopped) {
      up.close();
      return;
    }
    this.up = up;
    // Back-pressure belongs to one upstream. A swap must never inherit a pause that only the
    // old upstream's drain could have lifted.
    // A stdout stall outlives the upstream, so it stays paused; otherwise start flowing.
    if (this.blocked) up.pause?.();
    else this.input.resume();
    up.onMessage = (m) => {
      if (this.up !== up) return;
      this.fromUpstream(m);
    };
    up.onClose = () => this.lose(up);
    up.onDrain = () => {
      if (this.up === up && !this.blocked) this.input.resume();
    };
    if (this.initialize) {
      up.send({ ...this.initialize, id: this.replayId });
      if (this.initialized) up.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
      this.write({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' });
    }
  }

  /** `up` is gone (or being dropped): answer what was in flight and let the owner replace it. */
  private lose(up: Upstream): void {
    if (this.up !== up) return;
    this.up = undefined;
    if (!this.blocked) this.input.resume();
    this.failPending(RELAY_LOST, 'the gateway instance serving this session went away');
    up.close();
    this.onLost?.();
  }

  private write(m: RpcMessage): void {
    if (this.stopped) return;
    const line = `${JSON.stringify(m)}\n`;
    // Everything the client sees, replies and relay errors alike, goes through this cap: a client
    // that stops reading must not be able to grow this process's memory.
    if (this.output.writableLength + line.length > MAX_RELAY_BUFFERED_BYTES) {
      this.log('the client stopped reading stdout; dropping its session');
      this.stop();
      this.onClientGone?.();
      return;
    }
    if (!this.output.write(line) && !this.blocked) {
      this.blocked = true;
      this.input.pause();
      this.up?.pause?.();
    }
  }

  private fail(id: unknown, tag: string, text: string): void {
    this.write({
      jsonrpc: '2.0',
      id,
      error: { code: RELAY_RPC_ERROR, message: `${tag}: ${text}` },
    });
  }

  private failPending(tag: string, text: string): void {
    const ids = [...this.pending];
    this.pending.clear();
    for (const k of ids) {
      const sep = k.indexOf(':');
      const kind = k.slice(0, sep);
      const raw = k.slice(sep + 1);
      this.fail(kind === 'number' ? Number(raw) : raw, tag, text);
    }
  }

  private fromUpstream(m: RpcMessage): void {
    if (isResponse(m)) {
      if (m.id === this.replayId) return;
      this.pending.delete(key(m.id));
    }
    this.write(m);
  }

  private handleChunk(chunk: Buffer): void {
    const lines = this.splitter.push(chunk);
    // An oversized line is dropped on its own: the upstream and every other request carry on.
    // Reply only when its top-level id was found reliably; otherwise there is nobody to tell.
    for (const id of this.splitter.overflows.splice(0)) {
      this.log(`dropped a client line over ${MAX_RELAY_LINE_BYTES} bytes`);
      if (id !== undefined)
        this.write({
          jsonrpc: '2.0',
          id,
          error: { code: -32600, message: `request line over ${MAX_RELAY_LINE_BYTES} bytes` },
        });
    }
    for (const line of lines) this.handleLine(line);
  }

  private handleLine(line: string): void {
    if (this.stopped) return;
    if (line.trim() === '') return;
    let m: unknown;
    try {
      m = JSON.parse(line);
    } catch {
      return;
    }
    if (typeof m !== 'object' || m === null || Array.isArray(m)) return;
    const msg = m as RpcMessage;
    if (msg.method === 'initialize') this.initialize = msg;
    else if (msg.method === 'notifications/initialized') this.initialized = true;
    const request = isRequest(msg);
    const up = this.up;
    if (!up) {
      if (request)
        this.fail(msg.id, RELAY_RECONNECTING, 'the gateway is reconnecting; retry shortly');
      return;
    }
    if (request) {
      if (this.pending.size >= MAX_RELAY_PENDING) {
        this.fail(msg.id, RELAY_BUSY, 'too many requests in flight');
        return;
      }
      this.pending.add(key(msg.id));
    }
    if (!up.send(msg) && this.up === up) this.input.pause();
  }
}
