import type { Readable, Writable } from 'node:stream';
import {
  MAX_RELAY_LINE_BYTES,
  MAX_RELAY_PENDING,
  RELAY_BUSY,
  RELAY_LOST,
  RELAY_RECONNECTING,
  RELAY_RPC_ERROR,
} from './constants.js';
import { LineSplitter } from './lines.js';
import type { RpcMessage, Upstream } from './upstream.js';

const REPLAY_ID = 'relay-replay-initialize';

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
  private up: Upstream | undefined;
  private readonly pending = new Set<string>();
  private initialize: RpcMessage | undefined;
  private initialized = false;
  private readonly splitter = new LineSplitter(MAX_RELAY_LINE_BYTES);
  private started = false;
  private stopped = false;
  private readonly onData = (chunk: Buffer) => this.handleChunk(chunk);

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
  }

  stop(): void {
    this.stopped = true;
    this.input.off('data', this.onData);
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
    up.onMessage = (m) => {
      if (this.up !== up) return;
      this.fromUpstream(m);
    };
    up.onClose = () => {
      if (this.up !== up) return;
      this.up = undefined;
      this.failPending(RELAY_LOST, 'the gateway instance serving this session went away');
      this.onLost?.();
    };
    up.onDrain = () => this.input.resume();
    if (this.initialize) {
      up.send({ ...this.initialize, id: REPLAY_ID });
      if (this.initialized) up.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
      this.write({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' });
    }
  }

  private write(m: RpcMessage): void {
    if (this.stopped) return;
    if (!this.output.write(`${JSON.stringify(m)}\n`)) {
      this.up?.pause?.();
      this.output.once('drain', () => this.up?.resume?.());
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
      if (m.id === REPLAY_ID) return;
      this.pending.delete(key(m.id));
    }
    this.write(m);
  }

  private handleChunk(chunk: Buffer): void {
    let lines: string[];
    try {
      lines = this.splitter.push(chunk);
    } catch {
      this.log('dropped an oversized line from the client; reconnecting the relay session');
      this.up?.close();
      return;
    }
    for (const line of lines) this.handleLine(line);
  }

  private handleLine(line: string): void {
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
    if (!up.send(msg)) {
      this.input.pause();
    }
  }
}
