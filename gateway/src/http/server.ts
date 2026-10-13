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

export interface HttpServerOptions {
  host: string;
  port: number;
  token: HttpToken;
  registry: LinkRegistry;
  version: string;
  startedAt: number;
  /** One fresh session server per HTTP MCP session. */
  createSession: () => McpServer;
  maxRequestBytes: number;
  rps: number;
  maxSessions: number;
  idleMs: number;
  now?: () => number;
}

interface Entry {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  lastActive: number;
}

class BodyTooLarge extends Error {}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

function hostName(hostHeader: string | undefined): string | undefined {
  if (!hostHeader) return undefined;
  try {
    return new URL(`http://${hostHeader}`).hostname;
  } catch {
    return undefined;
  }
}

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
  private window = { start: 0, count: 0 };
  private readonly now: () => number;

  constructor(private readonly o: HttpServerOptions) {
    this.now = o.now ?? Date.now;
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
    const host = hostName(req.headers.host);
    if (!host || !LOOPBACK_HOSTS.has(host)) return send(res, 403, 'forbidden host');
    if (req.headers.origin !== undefined) {
      const origin = hostName(req.headers.origin.replace(/^[a-z]+:\/\//i, ''));
      if (!origin || !LOOPBACK_HOSTS.has(origin)) return send(res, 403, 'forbidden origin');
    }
    const path = (req.url ?? '').split('?')[0];
    if (path === '/status') {
      if (req.method !== 'GET') return send(res, 405, 'method not allowed');
      const worlds = this.o.registry.list().map((c) => ({
        worldId: c.worldId,
        userId: c.userId,
        userName: c.info.userName,
      }));
      return send(
        res,
        200,
        renderStatus({
          version: this.o.version,
          uptimeMs: this.now() - this.o.startedAt,
          worlds,
        }),
        'text/html',
      );
    }
    if (path !== '/mcp') return send(res, 404, 'not found');
    if (!this.o.token.verify(this.bearer(req))) {
      res.setHeader('www-authenticate', 'Bearer');
      return send(res, 401, 'unauthorized');
    }
    if (this.rateLimited()) {
      res.setHeader('retry-after', '1');
      return send(res, 429, 'too many requests');
    }
    const sid = req.headers['mcp-session-id'];
    if (typeof sid === 'string') {
      const e = this.sessions.get(sid);
      if (!e) return rpcError(res, 404, 'unknown session');
      e.lastActive = this.now();
      let body: unknown;
      if (req.method === 'POST') {
        const parsed = await this.parseBody(req, res);
        if (parsed === undefined) return;
        body = parsed.value;
      }
      await e.transport.handleRequest(req, res, body);
      e.lastActive = this.now();
      return;
    }
    if (req.method !== 'POST') return rpcError(res, 400, 'missing Mcp-Session-Id header');
    const parsed = await this.parseBody(req, res);
    if (parsed === undefined) return;
    if (!isInitializeRequest(parsed.value)) {
      return rpcError(res, 400, 'a session starts with an initialize request');
    }
    if (this.sessions.size + this.pending >= this.o.maxSessions) {
      return rpcError(res, 503, 'too many sessions');
    }
    this.pending++;
    try {
      const server = this.o.createSession();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          this.sessions.set(id, { transport, server, lastActive: this.now() });
        },
      });
      transport.onclose = () => {
        if (transport.sessionId) this.sessions.delete(transport.sessionId);
      };
      await server.connect(transport);
      await transport.handleRequest(req, res, parsed.value);
      // A rejected handshake never registered; do not leak its session server.
      if (!transport.sessionId) await server.close().catch(() => undefined);
    } finally {
      this.pending--;
    }
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
