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
import { toolsets } from '../routing/toolsets.js';
import { LinkCallError, LinkConnection, type LinkRegistry } from './registry.js';

export const HEARTBEAT_INTERVAL_MS = 15_000;
export const MAX_MISSED_PONGS = 2;

export interface LinkServerOptions {
  port: number;
  store: Store;
  codes: PairingCodes;
  registry: LinkRegistry;
  /** Exact `Origin` header values allowed to connect. */
  allowedOrigins: readonly string[];
  gatewayVersion: string;
  /** Defaults to 127.0.0.1. Any other address also requires `allowNonLoopback`. */
  host?: string;
  allowNonLoopback?: boolean;
  /** Time a socket may stay silent before sending `hello`. */
  helloTimeoutMs?: number;
  events?: EventBuffer;
}

export const hashToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

export class LinkServer {
  private readonly http: Server;
  private readonly wss: WebSocketServer;
  private readonly sockets = new Set<WebSocket>();
  private readonly host: string;

  constructor(private readonly opts: LinkServerOptions) {
    this.host = opts.host ?? '127.0.0.1';
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
      this.http.once('error', reject);
      this.http.listen(this.opts.port, this.host, () => {
        this.http.off('error', reject);
        const addr = this.http.address();
        resolve(typeof addr === 'object' && addr ? addr.port : this.opts.port);
      });
    });
  }

  async close(): Promise<void> {
    for (const ws of this.sockets) ws.terminate();
    await new Promise<void>((resolve) => this.http.close(() => resolve()));
  }

  private onUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const origin = req.headers.origin;
    if (origin === undefined || !this.opts.allowedOrigins.includes(origin)) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    this.wss.handleUpgrade(req, socket, head, (ws) => this.onConnection(ws));
  }

  private onConnection(ws: WebSocket): void {
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
        conn = this.handshake(msg, send, reject, ws);
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
    send: (m: LinkMessage) => void,
    reject: (code: ErrorCode, message: string) => void,
    ws: WebSocket,
  ): LinkConnection | undefined {
    const compat = checkCompat(PROTOCOL_VERSION, hello.protocolVersion);
    if (!compat.ok) {
      reject(compat.code, compat.message);
      return undefined;
    }
    const { store, codes } = this.opts;
    const invalid = (): undefined => {
      reject('PAIRING_INVALID', 'Pairing code or token is invalid, expired or already used');
      return undefined;
    };
    let agentId: string;
    let issuedToken: string | undefined;
    let recordedName: string;
    if (hello.auth.kind === 'pairingCode') {
      if (!codes.consume(hello.auth.code)) return invalid();
      issuedToken = randomBytes(32).toString('base64url');
      agentId = randomUUID();
      store.createPairing({
        id: agentId,
        tokenHash: hashToken(issuedToken),
        worldId: hello.world.id,
        userId: hello.user.id,
        userName: hello.user.name,
      });
      recordedName = hello.user.name;
    } else {
      const row = store.findPairingByHash(hashToken(hello.auth.token));
      if (
        !row ||
        row.revokedAt !== null ||
        row.worldId !== hello.world.id ||
        row.userId !== hello.user.id
      ) {
        return invalid();
      }
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
