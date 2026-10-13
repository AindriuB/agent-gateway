import type { Socket } from 'node:net';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { JSONRPCMessageSchema, type JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { MAX_RELAY_BUFFERED_BYTES } from './constants.js';
import { LineSplitter } from './lines.js';

/**
 * MCP transport over an authenticated relay socket (the primary's end). Newline-delimited
 * JSON-RPC, like stdio, with the line limit enforced before parsing and a cap on unflushed
 * output so a peer that stops reading cannot grow the primary's memory.
 */
export class RelaySocketTransport implements Transport {
  onmessage?: (message: JSONRPCMessage) => void;
  onclose?: () => void;
  onerror?: (error: Error) => void;
  private closed = false;

  constructor(
    private readonly socket: Socket,
    private readonly splitter: LineSplitter,
    private readonly firstLines: string[],
  ) {
    socket.once('close', () => this.finish());
    socket.on('error', () => undefined);
  }

  start(): Promise<void> {
    this.socket.on('data', (chunk: Buffer) => {
      try {
        for (const line of this.splitter.push(chunk)) this.deliver(line);
      } catch (err) {
        this.onerror?.(err as Error);
        this.socket.destroy();
      }
    });
    const lines = this.firstLines.splice(0);
    queueMicrotask(() => {
      for (const line of lines) this.deliver(line);
    });
    return Promise.resolve();
  }

  private deliver(line: string): void {
    if (line.trim() === '') return;
    let msg: JSONRPCMessage;
    try {
      msg = JSONRPCMessageSchema.parse(JSON.parse(line));
    } catch (err) {
      this.onerror?.(err as Error);
      return;
    }
    this.onmessage?.(msg);
  }

  send(message: JSONRPCMessage): Promise<void> {
    if (this.socket.destroyed) return Promise.resolve();
    this.socket.write(`${JSON.stringify(message)}\n`);
    if (this.socket.writableLength > MAX_RELAY_BUFFERED_BYTES) {
      this.socket.destroy(new Error('relay peer is not reading'));
    }
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.socket.destroy();
    this.finish();
    return Promise.resolve();
  }

  private finish(): void {
    if (this.closed) return;
    this.closed = true;
    this.onclose?.();
  }
}
