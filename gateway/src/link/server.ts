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
import type { InviteRow, Store } from '../store/index.js';
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
import { safeText } from '../routing/sanitize.js';
import { AttestLimiter, PendingPairings } from './attestation.js';
import {
  completeVouchedInvite,
  pairFromMemoryInvite,
  redeemInvite,
  settleInviteMismatch,
  type InviteClaim,
  type MemoryInviteProvider,
  type PairingOutcome,
} from './invites.js';
import { handleGrantMessage } from './grants.js';
import { handleInviteMessage } from './invite-admin.js';
import { handlePairingMessage } from './pairing-admin.js';
import { handleUserGrantMessage } from './user-grants.js';
import { LinkCallError, LinkConnection, type LinkRegistry } from './registry.js';

export const HEARTBEAT_INTERVAL_MS = 15_000;
/**
 * Unanswered pings tolerated before the link is closed: the 9th tick, 135 s after the first ping
 * went unanswered, terminates it. A browser tab can stall for about two minutes and still recover.
 */
export const MAX_MISSED_PONGS = 8;
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
  | 'no valid invite'
  | 'user is the headless agent and pairs only through the runner'
  | 'invite could not be redeemed (internal error)'
  | 'no admin GM is connected to confirm the pairing'
  | 'invite is already waiting for a GM to confirm it'
  | 'too many pairings are waiting for a GM to confirm them'
  | 'pairing confirmation timed out'
  | 'pairing was confirmed for a different user'
  | 'pairing was made from a different origin'
  | 'pairing predates origin binding; pair again with a code'
  | 'too many failed pairing codes'
  | 'pairing token is unknown, revoked, or for another world or user'
  | 'too many sockets waiting to say hello; close this page'
  | 'too many pages are holding gateway connections open without pairing';

export type LinkEvent =
  | { kind: 'connected'; worldId: string; userName: string; connectionId: string }
  | {
      kind: 'disconnected';
      worldId: string;
      userName: string;
      connectionId: string;
      code: number;
      reason: string;
      durationMs: number;
    };

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
  /**
   * Server mode (task 68): a `pairingCode` hello is checked as an operator invite; the shared code
   * is never consulted.
   */
  serverMode?: boolean;
  /** In-memory invites (task 37's headless runner); checked in both modes, before anything else. */
  inviteProvider?: MemoryInviteProvider;
  /**
   * Is (world, user) the configured headless agent? Decided by the operator's configuration, never
   * by `hello.headless`. Such a user pairs only through an in-memory invite.
   */
  isHeadlessAgent?: (worldId: string, userId: string) => boolean;
  /**
   * The Foundry user id that approvals for the configured headless agent should reach (task 38),
   * read from the operator's stored configuration. Sent in `welcome` only to a connection that
   * `isHeadlessAgent` classified, never to a browser connection.
   */
  headlessOwner?: (worldId: string, userId: string) => string | undefined;
  /** Operator-log lines that are not a refused connection. */
  log?: (line: string) => void;
  /** Called after a pairing code was spent on a new pairing. */
  onCodePaired?: () => void;
  /** Time a socket may stay silent before sending `hello`. */
  helloTimeoutMs?: number;
  events?: EventBuffer;
  queue?: OfflineQueue;
  /** Called after an authenticated link connects and when it closes. Never called for rejects. */
  onLinkEvent?: (event: LinkEvent) => void;
  /** Called when a connection is refused; `origin` is `undefined` when there was no usable header. */
  onOriginRejected?: (
    origin: string | undefined,
    reason: OriginRejection,
    /** Extra context for the log line, e.g. which origins hold the pre-hello slots. */
    detail?: string,
  ) => void;
}

/** What the owner of a pending vouch needs to finish or refuse its socket. */
interface PendingHandle {
  hello: Extract<LinkMessage, { type: 'hello' }>;
  ws: WebSocket;
  send: (m: LinkMessage) => void;
  reject: (code: ErrorCode, message: string) => void;
  admitted: (c: LinkConnection) => void;
}

export const GM_USER_MESSAGE =
  'GM users are paired by the operator with a GM invite (--invite ... --gm), not by a vouch.';

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
  private readonly socketByConnection = new WeakMap<LinkConnection, WebSocket>();
  private readonly vouches: PendingPairings<PendingHandle>;
  private sweepTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly opts: LinkServerOptions) {
    this.host = opts.host ?? '127.0.0.1';
    this.isPublic = opts.publicUrl !== undefined;
    this.vouches = new PendingPairings<PendingHandle>(opts.now);
    this.attempts = new CodeAttempts(
      opts.now,
      this.isPublic || opts.serverMode === true
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
    clearTimeout(this.sweepTimer);
    for (const ws of this.sockets) ws.terminate();
    await new Promise<void>((resolve) => this.http.close(() => resolve()));
  }

  /** Tell a live connection its pairing is revoked and close its socket (1008). */
  dropConnection(conn: LinkConnection): void {
    const ws = this.socketByConnection.get(conn);
    if (!ws) return;
    if (ws.readyState === ws.OPEN) {
      ws.send(
        JSON.stringify({
          type: 'reject',
          code: 'PAIRING_INVALID',
          message: 'pairing was revoked',
        } satisfies LinkMessage),
      );
    }
    ws.close(1008, 'PAIRING_INVALID');
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
    /** Why this side terminated the socket; terminate() reports 1006 with no reason otherwise. */
    let terminatedBecause: 'heartbeat-timeout' | 'socket-error' | undefined;
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

    let connectedAt = 0;
    const attestLimiter = new AttestLimiter(this.opts.now);
    const admitted = (c: LinkConnection): void => {
      conn = c;
      connectedAt = (this.opts.now ?? Date.now)();
      this.opts.onLinkEvent?.({
        kind: 'connected',
        worldId: c.worldId,
        userName: c.info.userName,
        connectionId: c.id,
      });
      heartbeat = setInterval(() => {
        if (missed >= MAX_MISSED_PONGS) {
          terminatedBecause ??= 'heartbeat-timeout';
          ws.terminate();
          return;
        }
        missed++;
        send({ type: 'ping' });
      }, HEARTBEAT_INTERVAL_MS);
    };
    ws.on('close', (code: number, reasonBuf: Buffer) => {
      clearTimeout(helloTimer);
      if (heartbeat) clearInterval(heartbeat);
      this.sockets.delete(ws);
      this.vouches.release(ws);
      if (conn) {
        this.opts.registry.remove(conn);
        this.opts.onLinkEvent?.({
          kind: 'disconnected',
          worldId: conn.worldId,
          userName: conn.info.userName,
          connectionId: conn.id,
          code,
          reason: reasonBuf.toString('utf8') || (code === 1006 ? (terminatedBecause ?? '') : ''),
          durationMs: (this.opts.now ?? Date.now)() - connectedAt,
        });
      }
    });
    ws.on('error', () => {
      if (conn) toolsets.revokeEventReads(conn);
      terminatedBecause ??= 'socket-error';
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
        this.handshake(msg, origin, send, reject, ws, client, admitted);
        return;
      }
      // Any inbound frame proves the peer is alive, not only an app-level pong.
      missed = 0;
      switch (msg.type) {
        case 'pong':
          break;
        case 'ping':
          send({ type: 'pong' });
          break;
        case 'result':
          conn.settle(msg.id, {
            ok: {
              text: msg.text,
              ...(msg.structured === undefined ? {} : { structured: msg.structured }),
              ...(msg.images ? { images: msg.images } : {}),
            },
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
        case 'approvalState':
          try {
            this.opts.queue?.approvalState(conn, msg);
          } catch {
            this.opts.registry.remove(conn);
            ws.close(1008, 'invalid approval state');
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
        case 'createInvite':
        case 'listInvites':
        case 'cancelInvite':
          // A replaced connection must not manage invites for the user any more.
          if (this.opts.registry.get(conn.worldId, conn.userId) !== conn || conn.closed) {
            ws.close(1008, 'stale invite connection');
            break;
          }
          handleInviteMessage(conn, msg, this.opts.store, send, this.opts.now);
          break;
        case 'listPairings':
        case 'revokePairing':
          // A replaced connection must not manage pairings for the user any more.
          if (this.opts.registry.get(conn.worldId, conn.userId) !== conn || conn.closed) {
            ws.close(1008, 'stale pairing connection');
            break;
          }
          handlePairingMessage(conn, msg, this.opts.store, this.opts.registry, send, this.opts.now);
          break;
        case 'listUserGrants':
        case 'revokeUserGrant':
          // A replaced connection must not manage grants for the user any more.
          if (this.opts.registry.get(conn.worldId, conn.userId) !== conn || conn.closed) {
            ws.close(1008, 'stale user grants connection');
            break;
          }
          handleUserGrantMessage(conn, msg, this.opts.store, send, this.opts.now);
          break;
        case 'attest':
          // A replaced connection must not vouch for anyone any more.
          if (this.opts.registry.get(conn.worldId, conn.userId) !== conn || conn.closed) {
            ws.close(1008, 'stale attest connection');
            break;
          }
          if (!attestLimiter.allow(msg.authorId)) {
            send({ type: 'error', id: '', code: 'RATE_LIMITED', message: 'too many attestations' });
            break;
          }
          this.attest(conn, msg, send);
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
    admitted: (c: LinkConnection) => void,
  ): void {
    const compat = checkCompat(PROTOCOL_VERSION, hello.protocolVersion);
    if (!compat.ok) {
      reject(compat.code, compat.message);
      return;
    }
    const { store, codes } = this.opts;
    const invalid = (
      reason: OriginRejection,
      code: ErrorCode = 'PAIRING_INVALID',
      peerMessage: string = reason,
      detail?: string,
    ): undefined => {
      this.opts.onOriginRejected?.(origin, reason, detail);
      reject(code, peerMessage);
      return undefined;
    };
    let agentId: string;
    let issuedToken: string | undefined;
    let recordedName: string;
    let admin: boolean | undefined;
    let outcome: PairingOutcome | undefined;
    let claim: InviteClaim | undefined;
    let fromDatabase = false;
    if (
      hello.auth.kind === 'pairingCode' &&
      (this.opts.serverMode === true || this.opts.inviteProvider !== undefined)
    ) {
      // A socket that closed before this point must not spend an invite it can never be told about.
      if (ws.readyState !== ws.OPEN) return;
      // Checked before the invite store, so a valid invite is neither spent nor found by guessing.
      if (this.attempts.limited(client)) {
        invalid('too many failed pairing codes', 'RATE_LIMITED');
        return;
      }
      const code = hello.auth.code;
      claim = {
        worldId: hello.world.id,
        userId: hello.user.id,
        // Display only: identity is the ids.
        userName: safeText(hello.user.name),
        origin,
      };
      const onError = (err: unknown): void =>
        void this.opts.onOriginRejected?.(
          origin,
          'invite could not be redeemed (internal error)',
          safeText((err as Error).message ?? String(err)),
        );
      const memory = this.opts.inviteProvider?.redeem(code, {
        worldId: claim.worldId,
        userId: claim.userId,
        origin,
      });
      if (
        memory === 'unknown' &&
        this.opts.isHeadlessAgent?.(claim.worldId, claim.userId) === true
      ) {
        // The agent user is not for humans: no shared code or operator invite pairs it.
        this.attempts.recordFailure(client);
        invalid(
          'user is the headless agent and pairs only through the runner',
          'PAIRING_INVALID',
          'no valid invite',
          `world ${safeText(claim.worldId)}, user ${safeText(claim.userId)}`,
        );
        return;
      }
      if (memory === 'match') outcome = pairFromMemoryInvite(store, claim, onError);
      else if (memory === 'mismatch') outcome = { ok: false, reason: 'refused' };
      else if (this.opts.serverMode === true) {
        const redeemed = redeemInvite(store, code, claim, (this.opts.now ?? Date.now)(), onError);
        if (!redeemed.ok && redeemed.reason === 'vouch') {
          // Nothing is spent: the invite pairs only if an admin GM vouches for the author Foundry
          // records on the player's chat message.
          this.startVouch(redeemed.invite, claim, client, { hello, ws, send, reject, admitted });
          return;
        }
        outcome = redeemed;
        fromDatabase = true;
      }
    }
    if (outcome && claim) {
      if (!outcome.ok) {
        if (outcome.reason === 'internal') {
          reject('INTERNAL', 'Could not redeem the invite');
          return;
        }
        this.attempts.recordFailure(client);
        invalid(
          'no valid invite',
          'PAIRING_INVALID',
          'no valid invite',
          `hello said world ${safeText(hello.world.id)}, user ${safeText(hello.user.id)}`,
        );
        return;
      }
      issuedToken = outcome.token;
      agentId = outcome.pairing.id;
      recordedName = claim.userName;
      // In-memory invites (headless runner) behave as before: no admin field.
      if (fromDatabase) admin = outcome.pairing.admin;
    } else if (hello.auth.kind === 'pairingCode') {
      // Local mode: anyone who can reach the link port and holds the code can claim any user id;
      // local mode assumes the gateway is reachable only from the owner's machine. Server mode
      // uses operator invites instead.
      // Checked before the code store, so a valid code is neither spent nor found by guessing.
      if (this.attempts.limited(client)) {
        invalid('too many failed pairing codes', 'RATE_LIMITED');
        return;
      }
      if (!codes.consume(hello.auth.code)) {
        this.attempts.recordFailure(client);
        invalid('no valid pairing code');
        return;
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
        invalid(
          'pairing token is unknown, revoked, or for another world or user',
          'PAIRING_INVALID',
          'no valid pairing code',
        );
        return;
      }
      if (row.origin === null) {
        invalid('pairing predates origin binding; pair again with a code');
        return;
      }
      if (row.origin !== origin) {
        invalid('pairing was made from a different origin');
        return;
      }
      agentId = row.id;
      // The name given at pairing is the one that counts; a reconnect's hello name is only a claim.
      recordedName = row.userName;
      // The operator-set flag as of now, never the hello's `isGM`.
      admin = row.admin;
    }
    const c = this.admit(
      { hello, ws, send, reject, admitted },
      agentId,
      recordedName,
      issuedToken,
      admin,
    );
    if (c) admitted(c);
  }

  /**
   * Headless iff the configured agent's (world, user) says hello; `hello.headless` is
   * informational, and a disagreement is logged once and ignored.
   */
  private classifyHeadless(hello: Extract<LinkMessage, { type: 'hello' }>): boolean {
    const headless = this.opts.isHeadlessAgent?.(hello.world.id, hello.user.id) === true;
    if (hello.headless === true && !headless)
      this.opts.log?.(
        `hello from world ${safeText(hello.world.id)}, user ${safeText(hello.user.id)} claimed to be headless but is not the configured headless agent; ignoring the claim`,
      );
    return headless;
  }

  /** Register the connection and send its welcome; undefined (and a reject) when it cannot start. */
  private admit(
    h: PendingHandle,
    agentId: string,
    recordedName: string,
    issuedToken: string | undefined,
    admin: boolean | undefined,
  ): LinkConnection | undefined {
    const { hello, ws, send, reject } = h;
    const connectionId = randomUUID();
    const headless = this.classifyHeadless(hello);
    const conn = new LinkConnection(
      connectionId,
      agentId,
      hello.world.id,
      hello.user.id,
      {
        send: (d) => ws.send(d),
        close: () => ws.close(1000, 'replaced'),
      },
      {
        userName: recordedName,
        isGM: hello.user.isGM,
        headless,
      },
    );
    this.socketByConnection.set(conn, ws);
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
      ...(admin === undefined ? {} : { admin }),
      ...(headless
        ? {
            headless: true as const,
            ...ownerField(this.opts.headlessOwner?.(hello.world.id, hello.user.id)),
          }
        : {}),
    });
    return conn;
  }

  /** Is an admin GM (an operator-set flag on its active pairing) connected in `worldId`? */
  private adminLive(worldId: string): boolean {
    for (const c of this.opts.registry.list()) {
      if (c.worldId === worldId && !c.closed && this.isAdmin(c)) return true;
    }
    return false;
  }

  /** The stored row decides, read now: never the hello and never a cached value. */
  private isAdmin(c: LinkConnection): boolean {
    const row = this.opts.store.getPairing(c.agentId);
    return (
      !!row &&
      row.revokedAt === null &&
      row.admin &&
      row.worldId === c.worldId &&
      row.userId === c.userId
    );
  }

  private startVouch(
    invite: InviteRow,
    claim: InviteClaim,
    client: string,
    handle: PendingHandle,
  ): void {
    const { ws, send, reject } = handle;
    const refuse = (reason: OriginRejection, code: ErrorCode, message: string): void => {
      this.opts.onOriginRejected?.(claim.origin, reason);
      reject(code, message);
    };
    if (!this.adminLive(claim.worldId)) {
      refuse(
        'no admin GM is connected to confirm the pairing',
        'PAIRING_UNCONFIRMED',
        'No admin GM is connected for this world to confirm you. Ask your GM to open Foundry with the Agent Gateway module, then try again.',
      );
      return;
    }
    // Expired entries are rejected here, never dropped silently by reserve().
    this.sweepPending();
    const r = this.vouches.reserve(invite, claim, client, ws, handle);
    if (!r.ok) {
      if (r.reason === 'reserved')
        refuse(
          'invite is already waiting for a GM to confirm it',
          'PAIRING_INVALID',
          'no valid invite',
        );
      else
        refuse(
          'too many pairings are waiting for a GM to confirm them',
          'RATE_LIMITED',
          'Too many pairings are waiting for confirmation. Try again in a minute.',
        );
      return;
    }
    send({
      type: 'pairingChallenge',
      nonce: r.pending.nonce,
      expiresAt: r.pending.expiresAt,
    });
    clearTimeout(this.sweepTimer);
    const next = this.vouches.nextExpiry();
    if (next !== undefined) {
      this.sweepTimer = setTimeout(
        () => this.sweepPending(),
        Math.max(0, next - (this.opts.now ?? Date.now)()) + 50,
      );
      this.sweepTimer.unref();
    }
  }

  /** Time out pending vouches whose TTL has passed; the sockets get PAIRING_UNCONFIRMED. */
  sweepPending(): void {
    for (const p of this.vouches.sweep()) {
      this.opts.onOriginRejected?.(p.claim.origin, 'pairing confirmation timed out');
      p.handle.reject(
        'PAIRING_UNCONFIRMED',
        'Your GM did not confirm in time. Ask your GM to be online, then try again.',
      );
    }
    const next = this.vouches.nextExpiry();
    clearTimeout(this.sweepTimer);
    if (next !== undefined) {
      this.sweepTimer = setTimeout(
        () => this.sweepPending(),
        Math.max(0, next - (this.opts.now ?? Date.now)()) + 50,
      );
      this.sweepTimer.unref();
    }
  }

  /** An admin GM's module vouches for the author Foundry recorded on a challenge message. */
  private attest(
    conn: LinkConnection,
    msg: Extract<LinkMessage, { type: 'attest' }>,
    send: (m: LinkMessage) => void,
  ): void {
    const now = this.opts.now ?? Date.now;
    // Only an operator-set admin pairing may vouch; `hello.user.isGM` is never consulted.
    if (!this.isAdmin(conn)) {
      send({ type: 'error', id: '', code: 'FORBIDDEN', message: 'not an admin GM' });
      return;
    }
    this.sweepPending();
    const p = this.vouches.get(msg.nonce);
    // Unknown, expired, or issued for another world: ignored.
    if (!p || p.claim.worldId !== conn.worldId) return;
    const onError = (err: unknown): void =>
      void this.opts.onOriginRejected?.(
        p.claim.origin,
        'invite could not be redeemed (internal error)',
        safeText((err as Error).message ?? String(err)),
      );
    if (msg.authorId !== p.invite.userId) {
      this.vouches.take(p.nonce);
      try {
        settleInviteMismatch(this.opts.store, p.invite.id);
      } catch (err) {
        onError(err);
      }
      this.attempts.recordFailure(p.client);
      this.opts.onOriginRejected?.(p.claim.origin, 'pairing was confirmed for a different user');
      p.handle.reject('PAIRING_INVALID', 'no valid invite');
      return;
    }
    if (msg.authorIsGM) {
      this.vouches.take(p.nonce);
      p.handle.reject('PAIRING_UNCONFIRMED', GM_USER_MESSAGE);
      return;
    }
    this.vouches.take(p.nonce);
    if (p.handle.ws.readyState !== p.handle.ws.OPEN) return;
    const out = completeVouchedInvite(this.opts.store, p.invite.id, p.claim, now(), onError);
    if (!out.ok) {
      if (out.reason === 'internal') p.handle.reject('INTERNAL', 'Could not redeem the invite');
      else p.handle.reject('PAIRING_INVALID', 'no valid invite');
      return;
    }
    const c = this.admit(p.handle, out.pairing.id, p.claim.userName, out.token, out.pairing.admin);
    if (c) p.handle.admitted(c);
  }
}

const ownerField = (owner: string | undefined): { ownerUserId?: string } =>
  owner !== undefined && owner !== '' ? { ownerUserId: owner } : {};
