import { chmodSync, existsSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { connect, createServer, type Server as NetServer, type Socket } from 'node:net';
import type { Server as McpServer } from '@modelcontextprotocol/sdk/server/index.js';
import { safeText, type UserSelector } from '../routing/index.js';
import {
  MAX_RELAY_HANDSHAKE_BYTES,
  MAX_RELAY_LINE_BYTES,
  MAX_RELAY_SESSIONS,
  RELAY_HANDSHAKE_MS,
  RELAY_VERSION,
  STEPDOWN_GRACE_MS,
  type RelayRefusal,
} from './constants.js';
import {
  describeConfigDiff,
  parseRelayConfig,
  sameConfig,
  sameSessionConfig,
  type RelayConfig,
} from './config.js';
import { writeClaim } from './claim.js';
import { LineSplitter } from './lines.js';
import { newSecret, parseSecretFile, secretMatches, writeSecret } from './secret.js';
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
  /** This primary's configuration; a relaying instance must match it. */
  config: RelayConfig;
  /** A mismatched but newer instance asked to take over: called once after the grace period. */
  onStepDown?: (why: string) => void;
  platform?: NodeJS.Platform;
}

const REFUSAL_GRACE_MS = 500;
const MAX_LOGGED_REFUSALS = 20;

/** True when something accepts connections at `path`. */
function isLive(path: string): Promise<boolean> {
  return new Promise((resolve) => {
    const s = connect(path);
    const done = (live: boolean) => {
      s.destroy();
      resolve(live);
    };
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
  });
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
  private socketIno: number | undefined;
  private bindPath = '';
  private steppingDown = false;
  /** Refusals already logged; a standby re-asks every few seconds and must not flood the log. */
  private readonly loggedRefusals = new Set<string>();
  private endpoint: string;

  constructor(private readonly opts: RelayServerOptions) {
    this.platform = opts.platform ?? process.platform;
    this.isWin = this.platform === 'win32';
    this.endpoint = opts.endpoint;
  }

  get sessionCount(): number {
    return this.active;
  }

  /** Open sockets of any state, including ones still awaiting their handshake. */
  get socketCount(): number {
    return this.sockets.size;
  }

  async listen(): Promise<void> {
    const { stateDir, endpoint } = this.opts;
    if (!this.isWin) {
      const mode = statSync(stateDir).mode;
      if (mode & 0o077)
        throw new Error(
          `state dir ${safeText(stateDir)} is accessible to other users (mode ${(mode & 0o777).toString(8)}); expected 0700`,
        );
      // Holding the link port makes a leftover socket file very likely stale, but never replace
      // one that still answers: it belongs to someone else.
      if (existsSync(endpoint) && (await isLive(endpoint)))
        throw new Error(`relay endpoint ${safeText(endpoint)} is already in use`);
    }
    this.secret = newSecret();
    // win32: a random per-boot pipe name, published only in the secret file (see relayEndpoint).
    if (this.isWin) this.endpoint = `${endpoint}-${newSecret().slice(0, 16)}`;
    // Unix: bind a private temporary name, then rename it onto the endpoint. libuv remembers the
    // temporary name, so closing this server can never unlink a successor's endpoint.
    this.bindPath = this.isWin
      ? this.endpoint
      : `${endpoint.slice(0, -'.sock'.length)}.${process.pid}.${newSecret().slice(0, 6)}.sock`;
    this.secretFile = writeSecret(
      stateDir,
      this.opts.linkPort,
      this.secret,
      this.isWin ? this.endpoint : undefined,
    );
    const net = createServer((s) => this.onConnection(s));
    this.net = net;
    const oldMask = this.isWin ? undefined : process.umask(0o177);
    let listening: Promise<void>;
    try {
      listening = new Promise<void>((resolve, reject) => {
        net.once('error', reject);
        net.listen(this.bindPath, () => {
          net.off('error', reject);
          resolve();
        });
      });
    } finally {
      // Bind happens synchronously inside listen(); put the old mask back unconditionally.
      if (oldMask !== undefined) process.umask(oldMask);
    }
    try {
      await listening;
      if (!this.isWin) {
        chmodSync(this.bindPath, 0o600);
        this.socketIno = statSync(this.bindPath).ino;
        // Atomically replaces any stale file left at the endpoint.
        renameSync(this.bindPath, this.endpoint);
      }
    } catch (err) {
      rmSync(this.bindPath, { force: true });
      await this.close();
      throw err;
    }
  }

  async close(): Promise<void> {
    const net = this.net;
    this.net = undefined;
    for (const s of this.sockets) s.destroy();
    this.sockets.clear();
    if (net?.listening) await new Promise<void>((r) => net.close(() => r()));
    // Only remove what this server created: the socket by inode, the secret by its content.
    if (!this.isWin && this.socketIno !== undefined) {
      try {
        if (statSync(this.opts.endpoint).ino === this.socketIno)
          rmSync(this.opts.endpoint, { force: true });
      } catch {
        // already gone
      }
    }
    this.socketIno = undefined;
    if (this.secretFile) {
      try {
        if (parseSecretFile(readFileSync(this.secretFile, 'utf8')).secret === this.secret)
          rmSync(this.secretFile, { force: true });
      } catch {
        // already gone
      }
    }
    this.secretFile = undefined;
  }

  /** Keep serving for the grace period so in-flight calls finish, then let the app exit. */
  private stepDown(why: string, heir: number): void {
    if (this.steppingDown) return;
    this.steppingDown = true;
    // Name the heir before the port is released, so older instances do not win the race for it.
    try {
      writeClaim(this.opts.stateDir, this.opts.linkPort, heir);
    } catch (err) {
      this.opts.log(`could not record the handover claim: ${safeText((err as Error).message)}`);
    }
    const net = this.net;
    if (net?.listening) net.close();
    const timer = setTimeout(() => this.opts.onStepDown?.(why), STEPDOWN_GRACE_MS);
    timer.unref();
  }

  private refuse(socket: Socket, code: RelayRefusal, extra: object = {}): void {
    socket.end(`${JSON.stringify({ relay: RELAY_VERSION, ok: false, code, ...extra })}\n`);
    // A peer that never closes its side must not hold a pre-auth slot.
    const grace = setTimeout(() => socket.destroy(), REFUSAL_GRACE_MS);
    grace.unref();
    socket.once('close', () => clearTimeout(grace));
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
    const theirConfig = parseRelayConfig((hello as { config?: unknown }).config);
    if (!theirConfig || !sameConfig(theirConfig, this.opts.config)) {
      // A relayed session runs on this primary's link, store and selector, so a difference in
      // `allowOrigins` is never served. A difference only in the session-neutral ports and log
      // level is served, unless the caller is strictly newer: then this primary steps down for it.
      const newer = !!theirConfig && theirConfig.startedAt > this.opts.config.startedAt;
      const neutralOnly = !!theirConfig && sameSessionConfig(theirConfig, this.opts.config);
      if (newer || !neutralOnly) {
        const text = `relay refused: ${describeConfigDiff(this.opts.config, theirConfig)}${newer ? '; stepping down for the newer instance' : ''}`;
        // Keyed on the logged text, not the peer's start time: peers with the same settings but
        // different start times must not take turns defeating the dedup. Bounded; cleared when full.
        const key = `${newer ? 'STEPDOWN' : 'MISMATCH'} ${text}`;
        if (!this.loggedRefusals.has(key)) {
          if (this.loggedRefusals.size >= MAX_LOGGED_REFUSALS) this.loggedRefusals.clear();
          this.loggedRefusals.add(key);
          this.opts.log(text);
        }
        this.refuse(socket, newer ? 'RELAY_CONFIG_STEPDOWN' : 'RELAY_CONFIG_MISMATCH', {
          config: this.opts.config,
        });
        if (newer)
          this.stepDown(describeConfigDiff(this.opts.config, theirConfig), theirConfig!.startedAt);
        return;
      }
      this.opts.log(
        `relay served despite a session-neutral difference: ${describeConfigDiff(this.opts.config, theirConfig)}`,
      );
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
