import { createHash, randomBytes } from 'node:crypto';
import { request } from 'node:http';
import { createSessionServer } from '../../src/mcp/session.js';
import { HttpServer, type HttpServerOptions } from '../../src/http/index.js';
import {
  OAuthServer,
  type ConsentDecision,
  type ConsentRequest,
  type ConsentStep,
} from '../../src/oauth/index.js';
import { startServer, type Harness } from '../link/helpers.js';
import { fixtureTool } from '../routing/harness.js';

export const PUBLIC = 'https://gw.example.com';
export const RESOURCE = `${PUBLIC}/mcp`;
export const REDIRECT = 'https://client.example/cb';

export interface Reply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
  json(): Record<string, unknown>;
}

export function call(
  port: number,
  method: string,
  path: string,
  opts: { headers?: Record<string, string>; body?: string; host?: string } = {},
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path,
        method,
        headers: { host: opts.host ?? 'gw.example.com', ...opts.headers },
      },
      (res) => {
        let text = '';
        res.on('data', (c: Buffer) => (text += c.toString()));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: text,
            json: () => JSON.parse(text) as Record<string, unknown>,
          }),
        );
      },
    );
    req.on('error', reject);
    req.end(opts.body);
  });
}

/** A consent step the test controls: approves (w1, u1, the requested scopes) unless told not to. */
export class TestConsent implements ConsentStep {
  requests: ConsentRequest[] = [];
  next: (r: ConsentRequest) => ConsentDecision = (r) => ({
    approve: { worldId: 'w1', userId: 'u1', scopes: r.scopes },
  });
  decide(r: ConsentRequest): Promise<ConsentDecision> {
    this.requests.push(r);
    return Promise.resolve(this.next(r));
  }
}

export const pkce = () => {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
};

export interface Rig {
  h: Harness;
  http: HttpServer;
  oauth: OAuthServer;
  port: number;
  clock: { t: number };
  consent: TestConsent;
  register(body?: Record<string, unknown>, headers?: Record<string, string>): Promise<Reply>;
  /** Registers a client and returns its id (and secret for a confidential one). */
  client(extra?: Record<string, unknown>): Promise<{ id: string; secret?: string }>;
  authorize(params: Record<string, string>, headers?: Record<string, string>): Promise<Reply>;
  token(params: Record<string, string>, headers?: Record<string, string>): Promise<Reply>;
  /** Full code flow; returns the token response body. */
  login(c: { id: string; secret?: string }, scope?: string): Promise<Record<string, string>>;
  mcp(token: string, body?: string, headers?: Record<string, string>): Promise<Reply>;
}

export async function rig(
  over: {
    maxClients?: number;
    http?: Partial<HttpServerOptions>;
    tools?: Parameters<typeof createSessionServer>[0]['tools'];
  } = {},
): Promise<Rig> {
  const h = await startServer();
  const clock = { t: 1_000_000 };
  const consent = new TestConsent();
  const oauth = new OAuthServer({
    repo: h.store.oauth,
    publicUrl: PUBLIC,
    consent,
    now: () => clock.t,
    ...(over.maxClients ? { maxClients: over.maxClients } : {}),
  });
  const http = new HttpServer({
    host: '127.0.0.1',
    port: 0,
    publicUrl: PUBLIC,
    oauth,
    registry: h.registry,
    version: '9.9.9',
    startedAt: Date.now(),
    createSession: ({ principal }) =>
      createSessionServer({
        version: '0.0.0',
        registry: h.registry,
        selector: {
          world: principal.selector!.worldId,
          user: principal.selector!.userId,
          exactId: true,
        },
        ...(principal.scopes
          ? { allowedCategories: principal.scopes as ('read' | 'write' | 'destructive' | 'code')[] }
          : {}),
        knownIdentities: () =>
          h.store
            .listActivePairings()
            .map((p) => ({ worldId: p.worldId, userId: p.userId, userName: p.userName })),
        tools: over.tools ?? [fixtureTool],
        callTimeoutMs: 5000,
      }),
    maxRequestBytes: 100_000,
    rps: 1000,
    maxSessions: 16,
    idleMs: 60_000,
    now: () => clock.t,
    ...over.http,
  });
  const port = await http.listen();
  const form = (p: Record<string, string>) => new URLSearchParams(p).toString();
  const r: Rig = {
    h,
    http,
    oauth,
    port,
    clock,
    consent,
    register: (body = { redirect_uris: [REDIRECT] }, headers) =>
      call(port, 'POST', '/register', {
        body: JSON.stringify(body),
        headers: { 'content-type': 'application/json', ...headers },
      }),
    async client(extra = {}) {
      const res = await r.register({ redirect_uris: [REDIRECT], client_name: 'T', ...extra });
      const b = res.json();
      if (res.status !== 201) throw new Error(`register failed: ${res.body}`);
      return { id: b.client_id as string, ...(b.client_secret ? { secret: b.client_secret as string } : {}) };
    },
    authorize: (params, headers) =>
      call(port, 'GET', `/authorize?${form(params)}`, headers ? { headers } : {}),
    token: (params, headers) =>
      call(port, 'POST', '/token', {
        body: form(params),
        headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
      }),
    async login(c, scope) {
      const { verifier, challenge } = pkce();
      const a = await r.authorize({
        response_type: 'code',
        client_id: c.id,
        redirect_uri: REDIRECT,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state: 's1',
        ...(scope ? { scope } : {}),
      });
      const code = new URL(a.headers.location as string).searchParams.get('code');
      if (!code) throw new Error(`no code: ${a.status} ${String(a.headers.location)}`);
      const t = await r.token({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT,
        code_verifier: verifier,
        client_id: c.id,
        ...(c.secret ? { client_secret: c.secret } : {}),
      });
      if (t.status !== 200) throw new Error(`token failed: ${t.body}`);
      return t.json() as Record<string, string>;
    },
    mcp: (token, body, headers) =>
      call(port, body === undefined ? 'GET' : 'POST', '/mcp', {
        headers: {
          authorization: `Bearer ${token}`,
          ...(body === undefined
            ? {}
            : { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }),
          ...headers,
        },
        ...(body === undefined ? {} : { body }),
      }),
  };
  return r;
}

export async function stop(r: Rig | undefined): Promise<void> {
  await r?.http.close();
  await r?.h.server.close();
  r?.h.store.close();
}

export const initBody = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 't', version: '0' },
  },
});
