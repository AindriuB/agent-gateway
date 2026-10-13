import { readFileSync } from 'node:fs';
import { connect, type Socket } from 'node:net';
import { join } from 'node:path';
import type { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import type { UserSelector } from '../routing/index.js';
import {
  MAX_RELAY_BUFFERED_BYTES,
  MAX_RELAY_LINE_BYTES,
  RELAY_HANDSHAKE_MS,
  RELAY_VERSION,
  type RelayRefusal,
} from './constants.js';
import { SECRET_FILE } from './endpoint.js';
import { LineSplitter } from './lines.js';

export type RpcMessage = Record<string, unknown>;

/** Where a secondary's stdio traffic goes: a relay socket, or an in-process session. */
export interface Upstream {
  onMessage?: (message: RpcMessage) => void;
  onClose?: () => void;
  /** Fires after `send` returned false, once the upstream can take more. */
  onDrain?: () => void;
  /** False means "stop feeding me until onDrain". */
  send(message: RpcMessage): boolean;
  close(): void;
  pause?(): void;
  resume?(): void;
}

/** The secondary's end of an authenticated relay socket. */
export class SocketUpstream implements Upstream {
  onMessage?: (message: RpcMessage) => void;
  onClose?: () => void;
  onDrain?: () => void;
  private closed = false;

  constructor(
    private readonly socket: Socket,
    private readonly splitter: LineSplitter,
    firstLines: string[],
  ) {
    socket.on('error', () => undefined);
    socket.once('close', () => this.finish());
    socket.on('drain', () => this.onDrain?.());
    socket.on('data', (chunk: Buffer) => {
      try {
        for (const line of this.splitter.push(chunk)) this.deliver(line);
      } catch {
        this.socket.destroy();
      }
    });
    // Anything that arrived with the handshake reply; handlers are attached after construction.
    queueMicrotask(() => {
      for (const line of firstLines) this.deliver(line);
    });
  }

  private deliver(line: string): void {
    if (line.trim() === '') return;
    let msg: unknown;
    try {
      msg = JSON.parse(line);
    } catch {
      this.socket.destroy();
      return;
    }
    if (typeof msg === 'object' && msg !== null && !Array.isArray(msg))
      this.onMessage?.(msg as RpcMessage);
  }

  send(message: RpcMessage): boolean {
    if (this.socket.destroyed) return true;
    const ok = this.socket.write(`${JSON.stringify(message)}\n`);
    if (this.socket.writableLength > MAX_RELAY_BUFFERED_BYTES) this.socket.destroy();
    return ok;
  }

  close(): void {
    this.socket.destroy();
    this.finish();
  }

  pause(): void {
    this.socket.pause();
  }

  resume(): void {
    this.socket.resume();
  }

  private finish(): void {
    if (this.closed) return;
    this.closed = true;
    this.onClose?.();
  }
}

/** An in-process MCP server session (the new primary's own, or a degraded one). */
export class LocalUpstream implements Upstream {
  onMessage?: (message: RpcMessage) => void;
  onClose?: () => void;
  onDrain?: () => void;
  private closed = false;

  constructor(private readonly transport: InMemoryTransport) {
    transport.onmessage = (m) => this.onMessage?.(m as unknown as RpcMessage);
    transport.onclose = () => {
      if (this.closed) return;
      this.closed = true;
      this.onClose?.();
    };
  }

  start(): Promise<void> {
    return this.transport.start();
  }

  send(message: RpcMessage): boolean {
    void this.transport.send(message as unknown as JSONRPCMessage).catch(() => undefined);
    return true;
  }

  close(): void {
    this.closed = true;
    void this.transport.close();
  }
}

export type ConnectResult =
  | { kind: 'ok'; upstream: SocketUpstream }
  | { kind: 'refused'; code: RelayRefusal | string; selector?: UserSelector }
  | { kind: 'failed'; reason: string };

export interface ConnectOptions {
  endpoint: string;
  stateDir: string;
  linkPort: number;
  selector: UserSelector;
}

/** One relay connect attempt: read the secret, dial, handshake. Never throws. */
export function connectRelay(opts: ConnectOptions): Promise<ConnectResult> {
  let secret: string;
  try {
    secret = readFileSync(join(opts.stateDir, SECRET_FILE), 'utf8').trim();
  } catch (err) {
    return Promise.resolve({
      kind: 'failed',
      reason: `cannot read relay secret (${(err as NodeJS.ErrnoException).code ?? 'error'})`,
    });
  }
  return new Promise<ConnectResult>((resolve) => {
    const socket = connect(opts.endpoint);
    const splitter = new LineSplitter(MAX_RELAY_LINE_BYTES);
    let settled = false;
    const settle = (r: ConnectResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };
    const timer = setTimeout(() => {
      socket.destroy();
      settle({ kind: 'failed', reason: 'relay handshake timed out' });
    }, RELAY_HANDSHAKE_MS + 1000);
    socket.on('error', (err: NodeJS.ErrnoException) =>
      settle({ kind: 'failed', reason: `cannot connect to relay (${err.code ?? err.message})` }),
    );
    socket.once('close', () => settle({ kind: 'failed', reason: 'relay closed during handshake' }));
    socket.once('connect', () => {
      socket.write(
        `${JSON.stringify({
          relay: RELAY_VERSION,
          secret,
          linkPort: opts.linkPort,
          selector: {
            ...(opts.selector.world ? { world: opts.selector.world } : {}),
            ...(opts.selector.user ? { user: opts.selector.user } : {}),
          },
        })}\n`,
      );
    });
    const onData = (chunk: Buffer) => {
      let lines: string[];
      try {
        lines = splitter.push(chunk);
      } catch {
        socket.destroy();
        settle({ kind: 'failed', reason: 'relay handshake reply too long' });
        return;
      }
      if (lines.length === 0) return;
      socket.off('data', onData);
      socket.pause();
      let reply: { relay?: unknown; ok?: unknown; code?: unknown; selector?: unknown };
      try {
        reply = JSON.parse(lines[0]!) as typeof reply;
      } catch {
        socket.destroy();
        settle({ kind: 'failed', reason: 'relay sent a malformed handshake reply' });
        return;
      }
      if (reply.relay !== RELAY_VERSION) {
        socket.destroy();
        settle({ kind: 'failed', reason: 'relay speaks a different protocol version' });
      } else if (reply.ok === true) {
        const up = new SocketUpstream(socket, splitter, lines.slice(1));
        socket.resume();
        settle({ kind: 'ok', upstream: up });
      } else {
        socket.destroy();
        const sel = reply.selector as { world?: unknown; user?: unknown } | undefined;
        settle({
          kind: 'refused',
          code: typeof reply.code === 'string' ? reply.code : 'RELAY_PROTOCOL',
          ...(sel && typeof sel === 'object'
            ? {
                selector: {
                  world: typeof sel.world === 'string' ? sel.world : undefined,
                  user: typeof sel.user === 'string' ? sel.user : undefined,
                },
              }
            : {}),
        });
      }
    };
    socket.on('data', onData);
  });
}
