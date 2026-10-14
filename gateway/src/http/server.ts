import { randomUUID } from 'node:crypto';
import {
  createServer,
  type IncomingMessage,
  type Server as NodeServer,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Server as McpServer } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import type { LinkRegistry } from '../link/index.js';
import { renderStatus } from '../status/page.js';
import type { HttpToken } from './token.js';
import { clientKey, loopbackAuthority } from './client-key.js';
import { publicHostMatches } from './public-url.js';
import {
  CountWindows,
  DISCOVERY_WINDOW_MS,
  FAILED_AUTH_WINDOW_MS,
  FailureWindows,
  MAX_DISCOVERY_PER_CLIENT,
  MAX_FAILED_AUTH_PER_CLIENT,
  MAX_HTTP_SESSIONS_PER_CLIENT,
  MAX_HTTP_SESSIONS_PER_PRINCIPAL,
  PUBLIC_CLIENT_RPS,
  RateWindows,
} from './limits.js';

/** Who a request is, as far as the transport knows. `selector` fixes the session's (world, user). */
export interface HttpPrincipal {
  key: string;
  selector?: { worldId: string; userId: string };
  /** Tool categories this credential may use (OAuth scopes); absent means no restriction. */
  scopes?: readonly string[];
}

/** The OAuth authorization server, as the transport sees it (task 35). */
export interface OAuthRoutes {
  /** Paths served by the OAuth server (metadata, register, authorize, token). */
  handles(path: string): boolean;
  handle(req: IncomingMessage, res: ServerResponse, path: string, client: string): Promise<void>;
  /** The principal for a bearer access token, or undefined. */
  authenticate(bearer: string | undefined): HttpPrincipal | undefined;
  /** Handed the link registry and the per-client failed-attempt bucket when the server is built. */
  attach?(wiring: { registry: LinkRegistry; failures: FailureWindows }): void;
  /** Advertised in `WWW-Authenticate` on a 401 from `/mcp`. */
  resourceMetadataUrl: string;
}

export interface SessionContext {
  principal: HttpPrincipal;
}

export interface HttpServerOptions {
  host: string;
  port: number;
  /** Local mode: the static bearer token. Ignored when `authenticate` is given. */
  token?: HttpToken;
  /**
   * Who the request is, or undefined when it carries no accepted credential. Defaults to a
   * wrapper around `token`; with neither, nothing is accepted.
   */
  authenticate?: (req: IncomingMessage) => HttpPrincipal | undefined;
  /** Public mode: serve OAuth and accept its access tokens (used when `authenticate` is not given). */
  oauth?: OAuthRoutes;
  /**
   * The external origin (`https://gw.example.com`). Its host joins the allowed Host values and the
   * origin is the only non-loopback Origin allowed. Setting it turns on the per-client request and
   * session limits and the minimal `/status`.
   */
  publicUrl?: string;
  /** Read the right-most `X-Forwarded-For` entry when the TCP peer is loopback. */
  trustProxy?: boolean;
  registry: LinkRegistry;
  version: string;
  startedAt: number;
  /** One fresh session server per HTTP MCP session. */
  createSession: (ctx: SessionContext) => McpServer;
  maxRequestBytes: number;
  rps: number;
  maxSessions: number;
  idleMs: number;
  now?: () => number;
  /** One line per evicted session. Never carries a grant id, session id, IP or client key. */
  log?: (line: string) => void;
}

interface Entry {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  lastActive: number;
  principalKey: string;
  clientKey: string;
  /** Requests being handled now; a session with one is never evicted. */
  inFlight: number;
}

type EvictReason = 'principal-cap' | 'client-cap' | 'global-cap';

class BodyTooLarge extends Error {}

function send(res: ServerResponse, code: number, body: string, type = 'text/plain'): void {
  if (res.headersSent) return;
  res.writeHead(code, {
    'content-type': `${type}; charset=utf-8`,
    'x-content-type-options': 'nosniff',
    'cache-control': 'no-store',
  });
  res.end(body);
}

const rpcError = (res: ServerResponse, code: number, message: string): void =>
  send(
    res,
    code,
    JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }),
    'application/json',
  );

/** Streamable HTTP MCP on a loopback address, behind a bearer token. */
export class HttpServer {
  private http: NodeServer | undefined;
  private readonly sessions = new Map<string, Entry>();
  private pending = 0;
  private sweeper: NodeJS.Timeout | undefined;
  private pendingByClient = new Map<string, number>();
  private pendingByPrincipal = new Map<string, number>();
  private window = { start: 0, count: 0 };
  private readonly now: () => number;
  private readonly failedAuth: FailureWindows;
  private readonly clientRate: RateWindows;
  private readonly discovery: CountWindows;
  private readonly publicHost: string | undefined;
  private readonly publicOrigin: string | undefined;
  private readonly authenticate: (req: IncomingMessage) => HttpPrincipal | undefined;

  constructor(private readonly o: HttpServerOptions) {
    this.now = o.now ?? Date.now;
    this.failedAuth = new FailureWindows(
      MAX_FAILED_AUTH_PER_CLIENT,
      FAILED_AUTH_WINDOW_MS,
      this.now,
    );
    this.clientRate = new RateWindows(PUBLIC_CLIENT_RPS, this.now);
    this.discovery = new CountWindows(MAX_DISCOVERY_PER_CLIENT, DISCOVERY_WINDOW_MS, this.now);
    if (o.publicUrl) {
      const u = new URL(o.publicUrl);
      this.publicHost = u.host;
      this.publicOrigin = u.origin;
    }
    const token = o.token;
    const oauth = o.oauth;
    oauth?.attach?.({ registry: o.registry, failures: this.failedAuth });
    this.authenticate =
      o.authenticate ??
      (oauth
        ? (req) => oauth.authenticate(this.bearer(req))
        : (req) => (token?.verify(this.bearer(req)) ? { key: 'local' } : undefined));
  }

  private get isPublic(): boolean {
    return this.publicHost !== undefined;
  }

  private hostAllowed(header: string | undefined): boolean {
    if (loopbackAuthority(header)) return true;
    return publicHostMatches(header, this.o.publicUrl);
  }

  private originAllowed(origin: string): boolean {
    if (origin === this.publicOrigin) return true;
    return !!loopbackAuthority(origin.replace(/^[a-z]+:\/\//i, ''));
  }

  get sessionCount(): number {
    return this.sessions.size;
  }

  async listen(): Promise<number> {
    const http = createServer((req, res) => {
      this.handle(req, res).catch(() => {
        if (!res.headersSent) rpcError(res, 500, 'internal error');
        else res.end();
      });
    });
    await new Promise<void>((resolve, reject) => {
      http.once('error', reject);
      http.listen(this.o.port, this.o.host, () => {
        http.off('error', reject);
        resolve();
      });
    });
    this.http = http;
    const every = Math.max(10, Math.min(30_000, Math.floor(this.o.idleMs / 2)));
    this.sweeper = setInterval(() => this.sweep(), every);
    this.sweeper.unref();
    return (http.address() as AddressInfo).port;
  }

  async close(): Promise<void> {
    if (this.sweeper) clearInterval(this.sweeper);
    this.sweeper = undefined;
    const http = this.http;
    this.http = undefined;
    const entries = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.all(entries.map((e) => e.server.close().catch(() => undefined)));
    if (http) {
      await new Promise<void>((resolve) => {
        http.close(() => resolve());
        http.closeAllConnections();
      });
    }
  }

  /** Close sessions with no request for `idleMs`. */
  sweep(): void {
    const cutoff = this.now() - this.o.idleMs;
    for (const [id, e] of this.sessions) {
      if (e.lastActive > cutoff) continue;
      this.sessions.delete(id);
      void e.server.close().catch(() => undefined);
    }
  }

  private bearer(req: IncomingMessage): string | undefined {
    const h = req.headers.authorization;
    const m = typeof h === 'string' ? /^Bearer (\S+)$/i.exec(h) : null;
    return m?.[1];
  }

  private rateLimited(): boolean {
    const t = this.now();
    if (t - this.window.start >= 1000) this.window = { start: t, count: 0 };
    return ++this.window.count > this.o.rps;
  }

  private async readBody(req: IncomingMessage): Promise<string> {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > this.o.maxRequestBytes) throw new BodyTooLarge();
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      const b = chunk as Buffer;
      size += b.length;
      if (size > this.o.maxRequestBytes) throw new BodyTooLarge();
      chunks.push(b);
    }
    return Buffer.concat(chunks).toString('utf8');
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Defence against DNS rebinding: only loopback Host and Origin names are served.
    if (!this.hostAllowed(req.headers.host)) return send(res, 403, 'forbidden host');
    if (req.headers.origin !== undefined && !this.originAllowed(req.headers.origin))
      return send(res, 403, 'forbidden origin');
    const client = clientKey(
      req.socket.remoteAddress,
      req.headers['x-forwarded-for'],
      this.o.trustProxy === true,
    );
    const path = (req.url ?? '').split('?')[0] ?? '';
    if (this.o.oauth?.handles(path)) return this.o.oauth.handle(req, res, path, client);
    if (path === '/status') {
      if (req.method !== 'GET') return send(res, 405, 'method not allowed');
      // A public gateway shows who is connected only to a request it can authenticate. A request
      // that offers a credential is counted, rate limited and, if wrong, recorded as a failure,
      // exactly as on /mcp; one that offers none gets the minimal page without a count.
      const offered = this.isPublic && req.headers.authorization !== undefined;
      if (offered) {
        if (this.failedAuth.limited(client)) {
          res.setHeader('retry-after', String(Math.ceil(FAILED_AUTH_WINDOW_MS / 1000)));
          return send(res, 429, 'too many failed attempts');
        }
        if (this.clientRate.exceeded(client)) {
          res.setHeader('retry-after', '1');
          return send(res, 429, 'too many requests');
        }
      }
      const principal = this.isPublic ? this.authenticate(req) : undefined;
      if (offered && !principal) this.failedAuth.record(client);
      const detailed = !this.isPublic || principal !== undefined;
      // A grant sees only its own (world, user); a credential with no selector sees all.
      const sel = principal?.selector;
      const worlds = detailed
        ? this.o.registry
            .list()
            .filter((c) => !sel || (c.worldId === sel.worldId && c.userId === sel.userId))
            .map((c) => ({
              worldId: c.worldId,
              userId: c.userId,
              userName: c.info.userName,
            }))
        : [];
      return send(
        res,
        200,
        renderStatus({
          version: this.o.version,
          uptimeMs: this.now() - this.o.startedAt,
          worlds,
          ...(detailed ? {} : { minimal: true }),
        }),
        'text/html',
      );
    }
    if (path !== '/mcp') return send(res, 404, 'not found');
    // Failed attempts are counted per client and checked before the token is, so a guesser is
    // stopped without being able to learn anything from the answer. Only a request that offered
    // a credential can fail: a credential-free request is OAuth discovery, throttled on its own.
    const offered = req.headers.authorization !== undefined;
    let principal: HttpPrincipal | undefined;
    if (offered || !this.failedAuth.limited(client)) {
      if (offered && this.failedAuth.limited(client)) {
        res.setHeader('retry-after', String(Math.ceil(FAILED_AUTH_WINDOW_MS / 1000)));
        return send(res, 429, 'too many failed attempts');
      }
      principal = this.authenticate(req);
      if (!principal && offered) this.failedAuth.record(client);
    }
    if (!principal) {
      if (!offered) {
        const wait = this.discovery.hit(client);
        if (wait > 0) {
          res.setHeader('retry-after', String(Math.ceil(wait / 1000)));
          return send(res, 429, 'too many requests');
        }
      }
      res.setHeader(
        'www-authenticate',
        this.o.oauth ? `Bearer resource_metadata="${this.o.oauth.resourceMetadataUrl}"` : 'Bearer',
      );
      return send(res, 401, 'unauthorized');
    }
    if (this.isPublic && this.clientRate.exceeded(client)) {
      res.setHeader('retry-after', '1');
      return send(res, 429, 'too many requests');
    }
    if (this.rateLimited()) {
      res.setHeader('retry-after', '1');
      return send(res, 429, 'too many requests');
    }
    const sid = req.headers['mcp-session-id'];
    if (typeof sid === 'string') {
      const e = this.sessions.get(sid);
      // A session id never works with another credential.
      if (!e || e.principalKey !== principal.key) return rpcError(res, 404, 'unknown session');
      e.lastActive = this.now();
      // A GET is the long-lived server-to-client stream, open for as long as the client is: it
      // is not work in progress, so it must not pin the session against eviction. A POST counts
      // from its first byte, so a slow body cannot be evicted mid-upload.
      const work = req.method === 'GET' ? 0 : 1;
      e.inFlight += work;
      try {
        let body: unknown;
        if (req.method === 'POST') {
          const parsed = await this.parseBody(req, res);
          if (parsed === undefined) return;
          body = parsed.value;
        }
        await e.transport.handleRequest(req, res, body);
      } finally {
        e.inFlight -= work;
        e.lastActive = this.now();
      }
      return;
    }
    if (req.method !== 'POST') return rpcError(res, 400, 'missing Mcp-Session-Id header');
    const parsed = await this.parseBody(req, res);
    if (parsed === undefined) return;
    if (!isInitializeRequest(parsed.value)) {
      return rpcError(res, 400, 'a session starts with an initialize request');
    }
    // Fail closed: a public session is bound to the (world, user) its credential grants. A
    // principal with no selector would otherwise fall back to follow mode, so it is refused (403).
    if (this.isPublic && !principal.selector) {
      return rpcError(res, 403, 'this credential does not grant a Foundry user');
    }
    if (!this.admit(principal.key, client)) return rpcError(res, 503, 'too many sessions');
    this.pending++;
    this.pendingByPrincipal.set(
      principal.key,
      (this.pendingByPrincipal.get(principal.key) ?? 0) + 1,
    );
    this.pendingByClient.set(client, (this.pendingByClient.get(client) ?? 0) + 1);
    let server: ReturnType<HttpServerOptions['createSession']> | undefined;
    try {
      server = this.o.createSession({ principal });
      const session = server;
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          this.sessions.set(id, {
            transport,
            server: session,
            lastActive: this.now(),
            principalKey: principal.key,
            clientKey: client,
            inFlight: 0,
          });
        },
      });
      transport.onclose = () => {
        if (transport.sessionId) this.sessions.delete(transport.sessionId);
      };
      await session.connect(transport);
      await transport.handleRequest(req, res, parsed.value);
      // A rejected handshake never registered; do not leak its session server.
      if (!transport.sessionId) await session.close().catch(() => undefined);
    } catch (err) {
      // Release the session server's hub handlers, which close() alone does not when the
      // transport never attached.
      if (server) {
        const attached = server.transport !== undefined;
        await server.close().catch(() => undefined);
        if (!attached) server.onclose?.();
      }
      throw err;
    } finally {
      this.pending--;
      const np = (this.pendingByPrincipal.get(principal.key) ?? 1) - 1;
      if (np <= 0) this.pendingByPrincipal.delete(principal.key);
      else this.pendingByPrincipal.set(principal.key, np);
      const n = (this.pendingByClient.get(client) ?? 1) - 1;
      if (n <= 0) this.pendingByClient.delete(client);
      else this.pendingByClient.set(client, n);
    }
  }

  /**
   * Make room for a new session of `principalKey`. When a cap is full, the principal's own
   * least-recently-active idle session is closed; another principal's never is. False means 503.
   */
  private admit(principalKey: string, client: string): boolean {
    // Plan first, evict after: a refusal must not cost the requester a session.
    const victims = new Map<string, EvictReason>();
    const count = (match: (e: Entry) => boolean, pending: number): number => {
      let n = pending;
      for (const [id, e] of this.sessions) if (match(e) && !victims.has(id)) n++;
      return n;
    };
    const plan = (c: string | undefined, reason: EvictReason): boolean => {
      const id = this.pickVictim(principalKey, c, victims);
      if (id === undefined) return false;
      victims.set(id, reason);
      return true;
    };
    // Local clients all share one principal key, so only the global cap applies to them.
    if (
      this.isPublic &&
      count(
        (e) => e.principalKey === principalKey,
        this.pendingByPrincipal.get(principalKey) ?? 0,
      ) >= MAX_HTTP_SESSIONS_PER_PRINCIPAL &&
      !plan(undefined, 'principal-cap')
    )
      return false;
    if (
      this.isPublic &&
      count((e) => e.clientKey === client, this.pendingByClient.get(client) ?? 0) >=
        MAX_HTTP_SESSIONS_PER_CLIENT &&
      !plan(client, 'client-cap')
    )
      return false;
    if (
      this.sessions.size - victims.size + this.pending >= this.o.maxSessions &&
      !plan(undefined, 'global-cap')
    )
      return false;
    for (const [id, reason] of victims) this.evict(id, principalKey, reason);
    return true;
  }

  private pickVictim(
    principalKey: string,
    client: string | undefined,
    skip: ReadonlyMap<string, unknown>,
  ): string | undefined {
    let pick: [string, Entry] | undefined;
    for (const [id, e] of this.sessions) {
      if (e.principalKey !== principalKey || e.inFlight > 0 || skip.has(id)) continue;
      if (client !== undefined && e.clientKey !== client) continue;
      if (!pick || e.lastActive < pick[1].lastActive) pick = [id, e];
    }
    return pick?.[0];
  }

  private evict(id: string, principalKey: string, reason: EvictReason): void {
    const e = this.sessions.get(id);
    if (!e) return;
    this.sessions.delete(id);
    void e.server.close().catch(() => undefined);
    const kind = principalKey.startsWith('oauth:')
      ? 'oauth'
      : principalKey === 'local'
        ? 'local'
        : 'other';
    const idle = Math.max(0, Math.round(this.now() - e.lastActive));
    this.o.log?.(`http session evicted: principal=${kind} reason=${reason} idle_ms=${idle}`);
  }

  private principalSessions(principalKey: string): number {
    let n = this.pendingByPrincipal.get(principalKey) ?? 0;
    for (const e of this.sessions.values()) if (e.principalKey === principalKey) n++;
    return n;
  }

  private clientSessions(client: string): number {
    let n = this.pendingByClient.get(client) ?? 0;
    for (const e of this.sessions.values()) if (e.clientKey === client) n++;
    return n;
  }

  /** Read and parse a JSON body; replies and returns undefined when it cannot. */
  private async parseBody(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<{ value: unknown } | undefined> {
    let text: string;
    try {
      text = await this.readBody(req);
    } catch (err) {
      if (err instanceof BodyTooLarge) {
        res.setHeader('connection', 'close');
        send(res, 413, 'request too large');
        return undefined;
      }
      throw err;
    }
    try {
      return { value: JSON.parse(text) as unknown };
    } catch {
      rpcError(res, 400, 'invalid JSON');
      return undefined;
    }
  }
}
