import type { OfflineQueue } from '../offline-queue/service.js';
import type { EventBuffer } from '../events/index.js';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket, type RawData } from 'ws';
import {
  MAX_FRAME_BYTES,
  ToolsetMessage,
  PROTOCOL_VERSION,
  checkCompat,
  parseLinkMessage,
  type ErrorCode,
  type LinkMessage,
} from '@agent-gateway/protocol';
import type { Store } from '../store/index.js';
import type { PairingCodes } from './pairing-codes.js';
import {
  CodeAttempts,
  MAX_FAILED_CODE_ATTEMPTS_PER_CLIENT,
  MAX_FAILED_CODE_ATTEMPTS_PUBLIC,
} from './code-attempts.js';
import { clientKey, loopbackAuthority } from '../http/client-key.js';
import { BoundedMap } from '../http/limits.js';
import { publicHostMatches } from '../http/public-url.js';
import { canonicalOrigin } from './origin.js';
import { toolsets } from '../routing/toolsets.js';
import { handleGrantMessage } from './grants.js';
import { LinkCallError, LinkConnection, type LinkRegistry } from './registry.js';

export const HEARTBEAT_INTERVAL_MS = 15_000;
export const MAX_MISSED_PONGS = 2;
/** Sockets that have upgraded but not yet sent `hello`; the next upgrade gets a 503. */
export const MAX_PENDING_HANDSHAKES = 16;
/** Within the global cap, so one page cannot starve every other origin's reconnects. */
export const MAX_PENDING_PER_ORIGIN = 4;
/** Public mode: pre-hello sockets per client key (the Origin header is attacker-chosen). */
export const MAX_PENDING_PER_CLIENT = 4;

/** Why a connection attempt was refused; the text goes to the local log; the peer sees only the message built from it. */
export type OriginRejection =
  | 'origin is not an allowed browser origin'
  | 'host header is not loopback'
  | 'no valid pairing code'
  | 'pairing was made from a different origin'
  | 'pairing predates origin binding; pair again with a code'
  | 'too many failed pairing codes'
  | 'pairing token is unknown, revoked, or for another world or user'
  | 'too many sockets waiting to say hello; close this page'
  | 'too many pages are holding gateway connections open without pairing';

export interface LinkServerOptions {
  port: number;
  store: Store;
  codes: PairingCodes;
  registry: LinkRegistry;
  /**
   * Optional extra restriction: exact `Origin` values allowed to reach `hello`. Undefined or empty
   * means any canonical http(s) origin may; a pairing code or a token bound to it is still needed.
   */
  allowedOrigins?: readonly string[];
  /** Clock for the failed-code window; defaults to Date.now. */
  now?: () => number;
  gatewayVersion: string;
  /** Defaults to 127.0.0.1. Any other address also requires `allowNonLoopback`. */
  host?: string;
  allowNonLoopback?: boolean;
  /**
   * The gateway's external origin. Its host is accepted in the `Host` header next to the loopback
   * names, and its presence turns on the per-client failed-code and pre-hello limits.
   */
  publicUrl?: string;
  /** Key clients by the right-most `X-Forwarded-For` entry when the TCP peer is loopback. */
  trustProxy?: boolean;
  /** Called after a pairing code was spent on a new pairing. */
  onCodePaired?: () => void;
  /** Time a socket may stay silent before sending `hello`. */
  helloTimeoutMs?: number;
  events?: EventBuffer;
  queue?: OfflineQueue;
  /** Called when a connection is refused; `origin` is `undefined` when there was no usable header. */
  onOriginRejected?: (
    origin: string | undefined,
    reason: OriginRejection,
    /** Extra context for the log line, e.g. which origins hold the pre-hello slots. */
    detail?: string,
  ) => void;
}

export const hashToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

export class LinkListenError extends Error {
  constructor(
    readonly code: 'EADDRINUSE' | 'EACCES',
    readonly port: number,
  ) {
    super(
      code === 'EADDRINUSE'
        ? `link port ${port} is in use; is another gateway running?`
        : `permission denied binding link port ${port}`,
    );
    this.name = 'LinkListenError';
  }
}

/** Map a bind failure to a typed error; other errors pass through unchanged. */
export function mapListenError(err: Error, port: number): Error {
  const code = (err as NodeJS.ErrnoException).code;
  return code === 'EADDRINUSE' || code === 'EACCES' ? new LinkListenError(code, port) : err;
}

export class LinkServer {
  private readonly http: Server;
  private readonly wss: WebSocketServer;
  private readonly sockets = new Set<WebSocket>();
  private readonly host: string;
  private readonly attempts: CodeAttempts;
  private pending = 0;
  private readonly pendingByOrigin = new Map<string, number>();
  private readonly pendingByClient = new BoundedMap<number>();
  private readonly isPublic: boolean;
  private boundPort = 0;

  constructor(private readonly opts: LinkServerOptions) {
    this.host = opts.host ?? '127.0.0.1';
    this.isPublic = opts.publicUrl !== undefined;
    this.attempts = new CodeAttempts(
      opts.now,
      this.isPublic
        ? {
            global: MAX_FAILED_CODE_ATTEMPTS_PUBLIC,
            perClient: MAX_FAILED_CODE_ATTEMPTS_PER_CLIENT,
          }
        : undefined,
    );
    if (this.host !== '127.0.0.1' && !opts.allowNonLoopback) {
      throw new Error(`Refusing to bind link server to ${this.host} without allowNonLoopback`);
    }
    this.http = createServer((_req, res) => {
      res.writeHead(426).end();
    });
    this.wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES });
    this.http.on('upgrade', (req, socket, head) => this.onUpgrade(req, socket, head));
  }

  listen(): Promise<number> {
    return new Promise((resolve, reject) => {
      const onError = (err: Error) => reject(mapListenError(err, this.opts.port));
      this.http.once('error', onError);
      this.http.listen(this.opts.port, this.host, () => {
        this.http.off('error', onError);
        const addr = this.http.address();
        this.boundPort = typeof addr === 'object' && addr ? addr.port : this.opts.port;
        resolve(this.boundPort);
      });
    });
  }

  async close(): Promise<void> {
    for (const ws of this.sockets) ws.terminate();
    await new Promise<void>((resolve) => this.http.close(() => resolve()));
  }

  private onUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const header = req.headers.origin;
    const refuse = (status: string, reason?: OriginRejection): void => {
      if (reason) this.opts.onOriginRejected?.(header, reason);
      socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
    };
    // A rebound DNS name still reaches loopback, but its Host is the attacker's name.
    // The check holds whatever the bind address: only the loopback names and the public host pass.
    {
      const host = req.headers.host;
      const loopback = loopbackAuthority(host);
      if (
        loopback?.port !== String(this.boundPort) &&
        !publicHostMatches(host, this.opts.publicUrl)
      ) {
        refuse('403 Forbidden', 'host header is not loopback');
        return;
      }
    }
    const client = clientKey(
      req.socket.remoteAddress,
      req.headers['x-forwarded-for'],
      this.opts.trustProxy === true,
    );
    const origin = canonicalOrigin(header);
    const allowed = this.opts.allowedOrigins;
    if (origin === undefined || (allowed && allowed.length > 0 && !allowed.includes(origin))) {
      refuse('403 Forbidden', 'origin is not an allowed browser origin');
      return;
    }
    if (this.pending >= MAX_PENDING_HANDSHAKES) {
      // The refused origin may be innocent: name the pages that hold the slots instead.
      const holders = [...this.pendingByOrigin]
        .sort((x, y) => y[1] - x[1])
        .slice(0, 3)
        .map(([o, n]) => `${o.slice(0, 100)} x${n}`)
        .join(', ');
      this.opts.onOriginRejected?.(
        origin,
        'too many pages are holding gateway connections open without pairing',
        `held by: ${holders}`,
      );
      socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
      return;
    }
    if ((this.pendingByOrigin.get(origin) ?? 0) >= MAX_PENDING_PER_ORIGIN) {
      this.opts.onOriginRejected?.(
        origin,
        'too many sockets waiting to say hello; close this page',
      );
      socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
      return;
    }
    if (this.isPublic && (this.pendingByClient.get(client) ?? 0) >= MAX_PENDING_PER_CLIENT) {
      this.opts.onOriginRejected?.(
        origin,
        'too many sockets waiting to say hello; close this page',
      );
      socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
      return;
    }
    // Held until hello arrives or the socket closes, whichever comes first.
    this.pending++;
    if (this.isPublic)
      this.pendingByClient.set(client, (this.pendingByClient.get(client) ?? 0) + 1);
    this.pendingByOrigin.set(origin, (this.pendingByOrigin.get(origin) ?? 0) + 1);
    let released = false;
    const release = (): void => {
      if (released) return;
      released = true;
      this.pending--;
      const n = (this.pendingByOrigin.get(origin) ?? 1) - 1;
      if (n <= 0) this.pendingByOrigin.delete(origin);
      else this.pendingByOrigin.set(origin, n);
      if (this.isPublic) {
        const c = (this.pendingByClient.get(client) ?? 1) - 1;
        if (c <= 0) this.pendingByClient.delete(client);
        else this.pendingByClient.set(client, c);
      }
    };
    socket.once('close', release);
    this.wss.handleUpgrade(req, socket, head, (ws) =>
      this.onConnection(ws, origin, release, client),
    );
  }

  private onConnection(
    ws: WebSocket,
    origin: string,
    releasePending: () => void,
    client: string,
  ): void {
    this.sockets.add(ws);
    let conn: LinkConnection | undefined;
    let handshaking = false;
    let missed = 0;
    let heartbeat: ReturnType<typeof setInterval> | undefined;

    const send = (m: LinkMessage): void => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m));
    };
    const reject = (code: ErrorCode, message: string): void => {
      send({ type: 'reject', code, message });
      ws.close(1008, code);
    };
    const helloTimer = setTimeout(
      () => ws.close(1008, 'hello timeout'),
      this.opts.helloTimeoutMs ?? 10_000,
    );
    helloTimer.unref();

    ws.on('close', () => {
      clearTimeout(helloTimer);
      if (heartbeat) clearInterval(heartbeat);
      this.sockets.delete(ws);
      if (conn) this.opts.registry.remove(conn);
    });
    ws.on('error', () => {
      if (conn) toolsets.revokeEventReads(conn);
      ws.terminate();
    });

    ws.on('message', (data: RawData) => {
      const raw = Array.isArray(data) ? Buffer.concat(data) : data;
      const parsed = parseLinkMessage(raw instanceof ArrayBuffer ? new Uint8Array(raw) : raw);
      if (!parsed.ok) {
        // Only cap failures on authenticated, structurally valid toolsets are recoverable.
        if (conn && parsed.reason === 'invalid') {
          try {
            const candidate: unknown = JSON.parse(
              new TextDecoder().decode(raw instanceof ArrayBuffer ? new Uint8Array(raw) : raw),
            );
            const uncapped = ToolsetMessage.extend({
              tools: ToolsetMessage.shape.tools.element.array(),
            });
            if (uncapped.safeParse(candidate).success) {
              toolsets.revokeEventReads(conn);
              console.warn('ignored toolset: announcement count or byte cap exceeded');
              return;
            }
          } catch {
            /* Generic parse rejection below. */
          }
        }
        if (conn) {
          toolsets.revokeEventReads(conn);
          ws.close(1008, parsed.reason);
        } else reject('INVALID_ARGS', parsed.message);
        return;
      }
      const msg = parsed.message;
      if (!conn) {
        if (msg.type !== 'hello' || handshaking) {
          reject('INVALID_ARGS', 'Expected a single hello as the first message');
          return;
        }
        handshaking = true;
        clearTimeout(helloTimer);
        releasePending();
        conn = this.handshake(msg, origin, send, reject, ws, client);
        if (conn) {
          heartbeat = setInterval(() => {
            if (missed >= MAX_MISSED_PONGS) {
              ws.terminate();
              return;
            }
            missed++;
            send({ type: 'ping' });
          }, HEARTBEAT_INTERVAL_MS);
        }
        return;
      }
      switch (msg.type) {
        case 'pong':
          missed = 0;
          break;
        case 'ping':
          send({ type: 'pong' });
          break;
        case 'result':
          conn.settle(msg.id, {
            ok:
              msg.structured === undefined
                ? { text: msg.text }
                : { text: msg.text, structured: msg.structured },
          });
          break;
        case 'error':
          conn.settle(msg.id, { err: new LinkCallError(msg.code, msg.message) });
          break;
        case 'event':
          // Task 28 owns buffering. Bind even discarded events to this authenticated observer.
          if (
            msg.event.userId !== conn.userId ||
            this.opts.registry.get(conn.worldId, conn.userId) !== conn ||
            conn.closed
          ) {
            ws.close(1008, 'event observer mismatch');
            break;
          }
          try {
            this.opts.events?.accept(conn, msg.event);
          } catch {
            ws.close(1008, 'invalid event stream');
          }
          break;
        case 'eventPolicy':
        case 'purgeEvents':
          if (this.opts.registry.get(conn.worldId, conn.userId) !== conn || conn.closed) {
            ws.close(1008, 'stale event policy connection');
            break;
          }
          try {
            if (msg.type === 'eventPolicy')
              this.opts.events?.setPolicy(conn, {
                enabled: msg.enabled,
                retentionDays: msg.retentionDays,
              });
            else if (this.opts.events)
              send({
                type: 'purgeEventsResult',
                requestId: msg.requestId,
                count: this.opts.events.purge(conn),
              });
          } catch {
            ws.close(1008, 'invalid event policy');
          }
          break;
        case 'queuedStatus':
          try {
            this.opts.queue?.accept(conn, msg);
          } catch {
            this.opts.registry.remove(conn);
            ws.close(1008, 'invalid queued receipt');
          }
          break;
        case 'listGrants':
        case 'revokeGrant':
          // A replaced connection must not act for the user any more.
          if (this.opts.registry.get(conn.worldId, conn.userId) !== conn || conn.closed) {
            ws.close(1008, 'stale grants connection');
            break;
          }
          handleGrantMessage(conn, msg, this.opts.store.oauth, send, this.opts.now);
          break;
        case 'toolset':
          // Only for the connection that sent it, never another's.
          toolsets.set(conn, msg.tools, msg.eventReadAllowed === true);
          break;
        default:
          ws.close(1008, 'unexpected message');
      }
    });
  }

  private handshake(
    hello: Extract<LinkMessage, { type: 'hello' }>,
    origin: string,
    send: (m: LinkMessage) => void,
    reject: (code: ErrorCode, message: string) => void,
    ws: WebSocket,
    client: string,
  ): LinkConnection | undefined {
    const compat = checkCompat(PROTOCOL_VERSION, hello.protocolVersion);
    if (!compat.ok) {
      reject(compat.code, compat.message);
      return undefined;
    }
    const { store, codes } = this.opts;
    const invalid = (
      reason: OriginRejection,
      code: ErrorCode = 'PAIRING_INVALID',
      peerMessage: string = reason,
    ): undefined => {
      this.opts.onOriginRejected?.(origin, reason);
      reject(code, peerMessage);
      return undefined;
    };
    let agentId: string;
    let issuedToken: string | undefined;
    let recordedName: string;
    if (hello.auth.kind === 'pairingCode') {
      // Checked before the code store, so a valid code is neither spent nor found by guessing.
      if (this.attempts.limited(client))
        return invalid('too many failed pairing codes', 'RATE_LIMITED');
      if (!codes.consume(hello.auth.code)) {
        this.attempts.recordFailure(client);
        return invalid('no valid pairing code');
      }
      issuedToken = randomBytes(32).toString('base64url');
      agentId = randomUUID();
      store.createPairing({
        id: agentId,
        tokenHash: hashToken(issuedToken),
        worldId: hello.world.id,
        userId: hello.user.id,
        userName: hello.user.name,
        origin,
      });
      recordedName = hello.user.name;
      this.opts.onCodePaired?.();
    } else {
      const row = store.findPairingByHash(hashToken(hello.auth.token));
      if (
        !row ||
        row.revokedAt !== null ||
        row.worldId !== hello.world.id ||
        row.userId !== hello.user.id
      ) {
        return invalid(
          'pairing token is unknown, revoked, or for another world or user',
          'PAIRING_INVALID',
          'no valid pairing code',
        );
      }
      if (row.origin === null)
        return invalid('pairing predates origin binding; pair again with a code');
      if (row.origin !== origin) return invalid('pairing was made from a different origin');
      agentId = row.id;
      // The name given at pairing is the one that counts; a reconnect's hello name is only a claim.
      recordedName = row.userName;
    }
    const connectionId = randomUUID();
    const conn = new LinkConnection(
      connectionId,
      agentId,
      hello.world.id,
      hello.user.id,
      {
        send: (d) => ws.send(d),
        close: () => ws.close(1000, 'replaced'),
      },
      { userName: recordedName, isGM: hello.user.isGM },
    );
    this.opts.registry.add(conn);
    try {
      this.opts.events?.connect(conn, hello.resume);
    } catch {
      this.opts.registry.remove(conn);
      reject('INTERNAL', 'Could not initialize event stream');
      return undefined;
    }
    send({
      type: 'welcome',
      gatewayVersion: this.opts.gatewayVersion,
      protocolVersion: PROTOCOL_VERSION,
      connectionId,
      agentId,
      ...(issuedToken ? { pairingToken: issuedToken } : {}),
    });
    return conn;
  }
}
