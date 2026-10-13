import { chmodSync, existsSync, rmSync, statSync } from 'node:fs';
import { createServer, type Server as NetServer, type Socket } from 'node:net';
import type { Server as McpServer } from '@modelcontextprotocol/sdk/server/index.js';
import { safeText, type UserSelector } from '../routing/index.js';
import {
  MAX_RELAY_HANDSHAKE_BYTES,
  MAX_RELAY_LINE_BYTES,
  MAX_RELAY_SESSIONS,
  RELAY_HANDSHAKE_MS,
  RELAY_VERSION,
  type RelayRefusal,
} from './constants.js';
import { LineSplitter } from './lines.js';
import { newSecret, secretMatches, writeSecret } from './secret.js';
import { RelaySocketTransport } from './transport.js';

export interface RelayServerOptions {
  /** Unix socket path or Windows pipe name from `relayEndpoint`. */
  endpoint: string;
  stateDir: string;
  /** The link port this primary holds; a secondary must name the same one. */
  linkPort: number;
  /** The primary's own selector: every relayed session binds with it. */
  selector: UserSelector;
  /** Builds one full session server per authenticated connection. */
  createSession: () => McpServer;
  log: (line: string) => void;
  platform?: NodeJS.Platform;
}

const norm = (s: UserSelector | undefined) => ({ world: s?.world || '', user: s?.user || '' });

/**
 * The primary's side of the relay: a private local endpoint where secondary instances connect and
 * each get their own full MCP session. Identity comes only from the primary's own selector.
 */
export class RelayServer {
  private net: NetServer | undefined;
  private secretFile: string | undefined;
  private readonly sockets = new Set<Socket>();
  private active = 0;
  private counter = 0;
  private readonly platform: NodeJS.Platform;
  private readonly isWin: boolean;
  private secret = '';

  constructor(private readonly opts: RelayServerOptions) {
    this.platform = opts.platform ?? process.platform;
    this.isWin = this.platform === 'win32';
  }

  get sessionCount(): number {
    return this.active;
  }

  async listen(): Promise<void> {
    const { stateDir, endpoint } = this.opts;
    if (!this.isWin) {
      const mode = statSync(stateDir).mode;
      if (mode & 0o077)
        throw new Error(
          `state dir ${safeText(stateDir)} is accessible to other users (mode ${(mode & 0o777).toString(8)}); expected 0700`,
        );
      // Holding the link port proves any socket file left behind is stale.
      rmSync(endpoint, { force: true });
    }
    this.secret = newSecret();
    this.secretFile = writeSecret(stateDir, this.secret);
    const net = createServer((s) => this.onConnection(s));
    this.net = net;
    const oldMask = this.isWin ? undefined : process.umask(0o177);
    try {
      await new Promise<void>((resolve, reject) => {
        net.once('error', reject);
        net.listen(endpoint, () => {
          net.off('error', reject);
          resolve();
        });
        // Back to the previous umask as soon as bind has happened (it is synchronous).
        if (oldMask !== undefined) process.umask(oldMask);
      });
    } catch (err) {
      if (oldMask !== undefined && process.umask() !== oldMask) process.umask(oldMask);
      await this.close();
      throw err;
    }
    if (!this.isWin) chmodSync(endpoint, 0o600);
  }

  async close(): Promise<void> {
    const net = this.net;
    this.net = undefined;
    for (const s of this.sockets) s.destroy();
    this.sockets.clear();
    if (net?.listening) await new Promise<void>((r) => net.close(() => r()));
    if (!this.isWin && existsSync(this.opts.endpoint) && net)
      rmSync(this.opts.endpoint, { force: true });
    if (this.secretFile) rmSync(this.secretFile, { force: true });
    this.secretFile = undefined;
  }

  private refuse(socket: Socket, code: RelayRefusal, extra: object = {}): void {
    socket.end(`${JSON.stringify({ relay: RELAY_VERSION, ok: false, code, ...extra })}\n`);
  }

  private onConnection(socket: Socket): void {
    // Unauthenticated sockets are bounded in number as well as time.
    if (this.sockets.size >= MAX_RELAY_SESSIONS * 2) {
      socket.destroy();
      return;
    }
    this.sockets.add(socket);
    socket.on('error', () => undefined);
    socket.once('close', () => this.sockets.delete(socket));
    const splitter = new LineSplitter(MAX_RELAY_HANDSHAKE_BYTES);
    let done = false;
    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        this.refuse(socket, 'RELAY_PROTOCOL');
      }
    }, RELAY_HANDSHAKE_MS);
    timer.unref();
    const onData = (chunk: Buffer) => {
      if (done) return;
      let lines: string[];
      try {
        lines = splitter.push(chunk);
      } catch {
        done = true;
        clearTimeout(timer);
        this.refuse(socket, 'RELAY_PROTOCOL');
        return;
      }
      if (lines.length === 0) return;
      done = true;
      clearTimeout(timer);
      socket.off('data', onData);
      socket.pause();
      splitter.setLimit(MAX_RELAY_LINE_BYTES);
      this.handshake(socket, splitter, lines[0]!, lines.slice(1));
    };
    socket.on('data', onData);
    socket.once('close', () => clearTimeout(timer));
  }

  private handshake(socket: Socket, splitter: LineSplitter, first: string, rest: string[]): void {
    let hello: {
      relay?: unknown;
      secret?: unknown;
      linkPort?: unknown;
      selector?: unknown;
    };
    try {
      hello = JSON.parse(first) as typeof hello;
      if (typeof hello !== 'object' || hello === null || hello.relay !== RELAY_VERSION)
        throw new Error('bad hello');
    } catch {
      this.refuse(socket, 'RELAY_PROTOCOL');
      return;
    }
    if (!secretMatches(hello.secret, this.secret)) {
      this.refuse(socket, 'RELAY_AUTH');
      return;
    }
    if (hello.linkPort !== this.opts.linkPort) {
      this.refuse(socket, 'RELAY_PORT_MISMATCH');
      return;
    }
    const theirs = norm(
      typeof hello.selector === 'object' && hello.selector !== null
        ? {
            world: asString((hello.selector as UserSelector).world),
            user: asString((hello.selector as UserSelector).user),
          }
        : undefined,
    );
    const mine = norm(this.opts.selector);
    if (
      (theirs.world || theirs.user) &&
      (theirs.world !== mine.world || theirs.user !== mine.user)
    ) {
      this.refuse(socket, 'RELAY_SELECTOR_MISMATCH', {
        selector: { world: mine.world, user: mine.user },
      });
      return;
    }
    if (this.active >= MAX_RELAY_SESSIONS) {
      this.refuse(socket, 'RELAY_FULL');
      return;
    }
    this.open(socket, splitter, rest);
  }

  private open(socket: Socket, splitter: LineSplitter, firstLines: string[]): void {
    const n = ++this.counter;
    this.active++;
    // The session reads until the transport starts; stay paused so nothing is lost.
    const transport = new RelaySocketTransport(socket, splitter, firstLines);
    let server: McpServer;
    try {
      server = this.opts.createSession();
    } catch (err) {
      this.active--;
      socket.destroy();
      this.opts.log(`relay session ${n} failed to open: ${safeText((err as Error).message)}`);
      return;
    }
    let ended = false;
    const end = () => {
      if (ended) return;
      ended = true;
      this.active--;
      this.opts.log(`relay session ${n} closed`);
    };
    socket.once('close', end);
    socket.write(`${JSON.stringify({ relay: RELAY_VERSION, ok: true })}\n`);
    this.opts.log(`relay session ${n} opened`);
    server.connect(transport).then(
      () => socket.resume(),
      () => socket.destroy(),
    );
  }
}

const asString = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
