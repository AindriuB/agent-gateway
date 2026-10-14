import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { HttpPrincipal, OAuthRoutes } from '../http/server.js';
import { FailureWindows } from '../http/limits.js';
import type { ConsentStep } from './consent.js';
import {
  CONSENT_PATH,
  ConsentPages,
  type ConsentSeed,
  type ConsentWiring,
} from './consent/index.js';
import { SCOPES, type OAuthClient, type OAuthRepository, type Scope } from './repository.js';

export const ACCESS_TOKEN_TTL_MS = 60 * 60_000;
export const AUTH_CODE_TTL_MS = 60_000;
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60_000;
export const MAX_OAUTH_CLIENTS = 200;
/** A client that registered but never got a grant is deleted to make room after this long. */
export const UNUSED_CLIENT_AGE_MS = 24 * 60 * 60_000;
export const REGISTER_LIMIT = { max: 5, windowMs: 60 * 60_000 } as const;
export const TOKEN_LIMIT = { max: 30, windowMs: 60_000 } as const;
export const AUTHORIZE_LIMIT = { max: 30, windowMs: 60_000 } as const;
export const MAX_REDIRECT_URIS = 5;
export const MAX_REDIRECT_URI_LENGTH = 512;
export const MAX_CLIENT_NAME_LENGTH = 100;
/** Registration, token and authorize requests are small; anything larger is refused. */
export const MAX_OAUTH_BODY_BYTES = 16 * 1024;
const MAX_STATE_LENGTH = 1024;
/** `last_used_at` is written at most this often per grant. */
const TOUCH_INTERVAL_MS = 60_000;

const hash = (s: string): string => createHash('sha256').update(s).digest('hex');
const newSecret = (): string => randomBytes(32).toString('hex');
const sameHash = (a: string, b: string): boolean => {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && timingSafeEqual(x, y);
};

export interface OAuthServerOptions {
  repo: OAuthRepository;
  /** The external origin, e.g. `https://gw.example.com` (already normalised by config). */
  publicUrl: string;
  /** Replaces the consent page with a programmatic decision; tests and embedders only. */
  consent?: ConsentStep;
  now?: () => number;
  maxClients?: number;
}

class OAuthError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    description?: string,
  ) {
    super(description ?? code);
  }
}

class BodyTooLarge extends Error {}

const baseHeaders = {
  'x-content-type-options': 'nosniff',
  'cache-control': 'no-store',
  pragma: 'no-cache',
};

function json(
  res: ServerResponse,
  status: number,
  body: unknown,
  extra: Record<string, string> = {},
): void {
  if (res.headersSent) return;
  res.writeHead(status, {
    ...baseHeaders,
    'content-type': 'application/json; charset=utf-8',
    ...extra,
  });
  res.end(JSON.stringify(body));
}

const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function errorPage(res: ServerResponse, message: string): void {
  if (res.headersSent) return;
  res.writeHead(400, {
    ...baseHeaders,
    'content-type': 'text/html; charset=utf-8',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
    'x-frame-options': 'DENY',
  });
  res.end(
    `<!doctype html><meta charset="utf-8"><title>Authorization error</title><p>${escapeHtml(message)}</p>`,
  );
}

/** Registered redirect URIs: https, or http on a loopback host; no fragment; bounded. */
function validRedirectUri(uri: unknown): uri is string {
  if (typeof uri !== 'string' || uri.length === 0 || uri.length > MAX_REDIRECT_URI_LENGTH)
    return false;
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  if (uri.includes('#') || u.hash) return false;
  if (u.username || u.password) return false;
  if (u.protocol === 'https:') return true;
  return u.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(u.hostname);
}

/** Trim to printable characters and the name cap; the result is still untrusted text. */
function cleanName(v: unknown): string {
  if (typeof v !== 'string') return '';
  return [...v.replace(/[\p{C}\p{Zl}\p{Zp}]/gu, '').trim()]
    .slice(0, MAX_CLIENT_NAME_LENGTH)
    .join('');
}

function parseScopes(raw: string | null | undefined): Scope[] {
  if (raw === null || raw === undefined || raw.trim() === '') return ['read'];
  if (raw.length > 200) throw new OAuthError(400, 'invalid_scope');
  const out: Scope[] = [];
  for (const s of raw.split(/ +/).filter(Boolean)) {
    if (!(SCOPES as readonly string[]).includes(s)) throw new OAuthError(400, 'invalid_scope');
    if (!out.includes(s as Scope)) out.push(s as Scope);
  }
  return out.length ? out : ['read'];
}

/** OAuth 2.1 authorization server for remote MCP clients: authorization code with S256 PKCE. */
export class OAuthServer implements OAuthRoutes {
  readonly issuer: string;
  readonly resource: string;
  readonly resourceMetadataUrl: string;
  private readonly repo: OAuthRepository;
  private readonly consent: ConsentStep | undefined;
  private readonly pages: ConsentPages | undefined;
  private readonly now: () => number;
  private readonly maxClients: number;
  private readonly registerRate: FailureWindows;
  private readonly tokenRate: FailureWindows;
  private readonly authorizeRate: FailureWindows;

  constructor(o: OAuthServerOptions) {
    this.issuer = new URL(o.publicUrl).origin;
    this.resource = `${this.issuer}/mcp`;
    this.resourceMetadataUrl = `${this.issuer}/.well-known/oauth-protected-resource`;
    this.repo = o.repo;
    this.consent = o.consent;
    this.now = o.now ?? Date.now;
    this.pages = o.consent
      ? undefined
      : new ConsentPages({
          publicUrl: o.publicUrl,
          repo: o.repo,
          now: this.now,
          finish: (seed, approved) => this.finishConsent(seed, approved),
        });
    this.maxClients = o.maxClients ?? MAX_OAUTH_CLIENTS;
    this.registerRate = new FailureWindows(REGISTER_LIMIT.max, REGISTER_LIMIT.windowMs, this.now);
    this.tokenRate = new FailureWindows(TOKEN_LIMIT.max, TOKEN_LIMIT.windowMs, this.now);
    this.authorizeRate = new FailureWindows(
      AUTHORIZE_LIMIT.max,
      AUTHORIZE_LIMIT.windowMs,
      this.now,
    );
  }

  handles(path: string): boolean {
    return (
      path === '/.well-known/oauth-authorization-server' ||
      path === '/.well-known/oauth-protected-resource' ||
      path === '/.well-known/oauth-protected-resource/mcp' ||
      path === '/register' ||
      path === '/authorize' ||
      path === CONSENT_PATH ||
      path === '/token'
    );
  }

  /** Called by the HTTP server: the link registry and the shared failed-attempt bucket. */
  attach(wiring: ConsentWiring): void {
    this.pages?.attach(wiring);
  }

  /** The principal for a bearer access token, or undefined. Read per request, so revocation is immediate. */
  authenticate(bearer: string | undefined): HttpPrincipal | undefined {
    if (!bearer || bearer.length > 256) return undefined;
    const rec = this.repo.getAccess(hash(bearer));
    if (!rec) return undefined;
    const t = this.now();
    if (rec.token.expiresAt <= t || rec.token.audience !== this.resource) return undefined;
    if (t - (rec.grant.lastUsedAt ?? 0) >= TOUCH_INTERVAL_MS) this.repo.touchGrant(rec.grant.id, t);
    return {
      key: `oauth:${rec.grant.id}`,
      selector: { worldId: rec.grant.worldId, userId: rec.grant.userId },
      scopes: rec.grant.scopes,
    };
  }

  async handle(
    req: IncomingMessage,
    res: ServerResponse,
    path: string,
    client: string,
  ): Promise<void> {
    try {
      const method = req.method ?? 'GET';
      if (path.startsWith('/.well-known/')) {
        if (method !== 'GET' && method !== 'HEAD')
          return json(res, 405, { error: 'invalid_request' });
        return json(res, 200, this.metadata(path));
      }
      const want =
        path === '/register' || path === '/token' || path === CONSENT_PATH ? 'POST' : 'GET';
      if (method !== want) return json(res, 405, { error: 'invalid_request' }, { allow: want });
      if (path === '/register') return await this.register(req, res, client);
      if (path === '/token') return await this.token(req, res, client);
      if (path === CONSENT_PATH) return await this.consentPost(req, res, client);
      return await this.authorize(req, res, client);
    } catch (e) {
      if (e instanceof BodyTooLarge) return json(res, 413, { error: 'invalid_request' });
      if (e instanceof OAuthError) {
        return json(
          res,
          e.status,
          { error: e.code, ...(e.message !== e.code ? { error_description: e.message } : {}) },
          e.status === 429 || e.status === 503 ? { 'retry-after': '60' } : {},
        );
      }
      throw e;
    }
  }

  private metadata(path: string): unknown {
    if (path === '/.well-known/oauth-authorization-server')
      return {
        issuer: this.issuer,
        authorization_endpoint: `${this.issuer}/authorize`,
        token_endpoint: `${this.issuer}/token`,
        registration_endpoint: `${this.issuer}/register`,
        scopes_supported: [...SCOPES],
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
        code_challenge_methods_supported: ['S256'],
      };
    return {
      resource: this.resource,
      authorization_servers: [this.issuer],
      scopes_supported: [...SCOPES],
      bearer_methods_supported: ['header'],
    };
  }

  private async readBody(req: IncomingMessage): Promise<string> {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > MAX_OAUTH_BODY_BYTES) throw new BodyTooLarge();
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > MAX_OAUTH_BODY_BYTES) throw new BodyTooLarge();
      chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks).toString('utf8');
  }

  private limit(w: FailureWindows, key: string): void {
    if (w.limited(key)) throw new OAuthError(429, 'too_many_requests');
    w.record(key);
  }

  // ---- /register (RFC 7591) ----

  private async register(req: IncomingMessage, res: ServerResponse, client: string): Promise<void> {
    this.limit(this.registerRate, client);
    let meta: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(await this.readBody(req));
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error();
      meta = parsed as Record<string, unknown>;
    } catch (e) {
      if (e instanceof BodyTooLarge) throw e;
      throw new OAuthError(400, 'invalid_client_metadata', 'the body must be a JSON object');
    }
    const uris = meta.redirect_uris;
    if (!Array.isArray(uris) || uris.length === 0 || uris.length > MAX_REDIRECT_URIS)
      throw new OAuthError(
        400,
        'invalid_redirect_uri',
        `redirect_uris must hold 1 to ${MAX_REDIRECT_URIS} URIs`,
      );
    if (!uris.every(validRedirectUri))
      throw new OAuthError(
        400,
        'invalid_redirect_uri',
        'each redirect URI must be https (or http on a loopback host), without a fragment, and at most 512 characters',
      );
    const method = meta.token_endpoint_auth_method ?? 'none';
    if (method !== 'none' && method !== 'client_secret_post')
      throw new OAuthError(
        400,
        'invalid_client_metadata',
        'unsupported token_endpoint_auth_method',
      );
    const within = (v: unknown, ok: string[]): boolean =>
      v === undefined ||
      (Array.isArray(v) && v.every((x) => typeof x === 'string' && ok.includes(x)));
    if (!within(meta.grant_types, ['authorization_code', 'refresh_token']))
      throw new OAuthError(400, 'invalid_client_metadata', 'unsupported grant_types');
    if (!within(meta.response_types, ['code']))
      throw new OAuthError(400, 'invalid_client_metadata', 'unsupported response_types');

    const t = this.now();
    if (this.repo.countClients() >= this.maxClients) {
      this.repo.pruneClients(t - UNUSED_CLIENT_AGE_MS);
      if (this.repo.countClients() >= this.maxClients)
        throw new OAuthError(503, 'temporarily_unavailable');
    }
    const id = randomUUID();
    const secret = method === 'client_secret_post' ? newSecret() : undefined;
    const name = cleanName(meta.client_name);
    const redirectUris = [...new Set(uris as string[])];
    this.repo.createClient({
      id,
      secretHash: secret ? hash(secret) : null,
      name,
      redirectUris,
      createdAt: t,
    });
    json(res, 201, {
      client_id: id,
      ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
      client_id_issued_at: Math.floor(t / 1000),
      client_name: name,
      redirect_uris: redirectUris,
      token_endpoint_auth_method: method,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    });
  }

  // ---- /authorize ----

  private async consentPost(
    req: IncomingMessage,
    res: ServerResponse,
    client: string,
  ): Promise<void> {
    const pages = this.pages;
    if (!pages) return json(res, 404, { error: 'invalid_request' });
    if (pages.refuseHost(req, res)) return;
    this.limit(this.authorizeRate, client);
    pages.submit(req, res, client, await this.readBody(req));
  }

  /** Approved at the consent page: store the grant and its one-time code; return the redirect. */
  private finishConsent(
    seed: ConsentSeed,
    approved: { worldId: string; userId: string; scopes: Scope[] },
  ): string {
    // The consent step can narrow what was asked for, never widen it.
    const granted = approved.scopes.filter((s) => seed.scopes.includes(s));
    const u = new URL(seed.redirectUri);
    if (seed.state !== undefined) u.searchParams.set('state', seed.state);
    if (granted.length === 0) {
      u.searchParams.set('error', 'access_denied');
      return u.toString();
    }
    const t = this.now();
    const grantId = randomUUID();
    this.repo.createGrant({
      id: grantId,
      clientId: seed.clientId,
      worldId: approved.worldId,
      userId: approved.userId,
      scopes: granted,
      createdAt: t,
    });
    const code = newSecret();
    this.repo.insertCode({
      codeHash: hash(code),
      grantId,
      redirectUri: seed.redirectUri,
      codeChallenge: seed.codeChallenge,
      resource: this.resource,
      expiresAt: t + AUTH_CODE_TTL_MS,
    });
    this.repo.touchClient(seed.clientId, t);
    u.searchParams.set('code', code);
    return u.toString();
  }

  private async authorize(
    req: IncomingMessage,
    res: ServerResponse,
    client: string,
  ): Promise<void> {
    this.limit(this.authorizeRate, client);
    // The consent page answers only on the public host, so it is never served on a rebinding name.
    if (this.pages?.refuseHost(req, res)) return;
    const q = new URL(req.url ?? '/', 'http://localhost').searchParams;
    const registered = this.repo.getClient(q.get('client_id') ?? '');
    const redirectUri = q.get('redirect_uri');
    // Until the redirect URI is known to be exactly registered, nothing is ever redirected.
    if (!registered || redirectUri === null || !registered.redirectUris.includes(redirectUri))
      return errorPage(res, 'The client or its redirect URI is not registered.');
    const state = q.get('state') ?? undefined;
    const back = (params: Record<string, string>): void => {
      const u = new URL(redirectUri);
      for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
      if (state !== undefined) u.searchParams.set('state', state);
      res.writeHead(302, { ...baseHeaders, location: u.toString() });
      res.end();
    };
    try {
      if (state !== undefined && state.length > MAX_STATE_LENGTH)
        throw new OAuthError(400, 'invalid_request');
      if (q.get('response_type') !== 'code') throw new OAuthError(400, 'unsupported_response_type');
      const challenge = q.get('code_challenge');
      if (!challenge || !/^[A-Za-z0-9_-]{43}$/.test(challenge))
        throw new OAuthError(400, 'invalid_request', 'a valid S256 code_challenge is required');
      if (q.get('code_challenge_method') !== 'S256')
        throw new OAuthError(400, 'invalid_request', 'code_challenge_method must be S256');
      const resource = q.get('resource');
      if (resource !== null && resource !== this.resource)
        throw new OAuthError(400, 'invalid_target');
      const scopes = parseScopes(q.get('scope'));
      if (!this.consent) {
        this.pages?.begin(res, {
          clientId: registered.id,
          clientName: registered.name,
          redirectUri,
          codeChallenge: challenge,
          scopes,
          state,
        });
        return;
      }
      const decision = await this.consent.decide({
        clientId: registered.id,
        clientName: registered.name,
        redirectUri,
        scopes,
        resource: this.resource,
        state,
      });
      if ('deny' in decision) return back({ error: 'access_denied' });
      // The consent step can narrow what was asked for, never widen it.
      const granted = decision.approve.scopes.filter((s) => scopes.includes(s));
      if (granted.length === 0) return back({ error: 'access_denied' });
      const t = this.now();
      const grantId = randomUUID();
      this.repo.createGrant({
        id: grantId,
        clientId: registered.id,
        worldId: decision.approve.worldId,
        userId: decision.approve.userId,
        scopes: granted,
        createdAt: t,
      });
      const code = newSecret();
      this.repo.insertCode({
        codeHash: hash(code),
        grantId,
        redirectUri,
        codeChallenge: challenge,
        resource: this.resource,
        expiresAt: t + AUTH_CODE_TTL_MS,
      });
      this.repo.touchClient(registered.id, t);
      back({ code });
    } catch (e) {
      if (e instanceof OAuthError) return back({ error: e.code });
      return back({ error: 'server_error' });
    }
  }

  // ---- /token ----

  private async token(req: IncomingMessage, res: ServerResponse, client: string): Promise<void> {
    this.limit(this.tokenRate, client);
    const form = new URLSearchParams(await this.readBody(req));
    const registered = this.authenticateClient(form);
    const grantType = form.get('grant_type');
    const resource = form.get('resource');
    if (resource !== null && resource !== this.resource)
      throw new OAuthError(400, 'invalid_target');
    if (grantType === 'authorization_code') return this.redeemCode(res, registered, form);
    if (grantType === 'refresh_token') return this.refresh(res, registered, form);
    throw new OAuthError(400, 'unsupported_grant_type');
  }

  private authenticateClient(form: URLSearchParams): OAuthClient {
    const bad = new OAuthError(401, 'invalid_client');
    const found = this.repo.getClient(form.get('client_id') ?? '');
    if (!found) throw bad;
    if (found.secretHash) {
      const secret = form.get('client_secret');
      if (!secret || !sameHash(hash(secret), found.secretHash)) throw bad;
    }
    return found;
  }

  private redeemCode(res: ServerResponse, c: OAuthClient, form: URLSearchParams): void {
    const code = form.get('code');
    const verifier = form.get('code_verifier');
    const redirectUri = form.get('redirect_uri');
    if (!code || !verifier || redirectUri === null) throw new OAuthError(400, 'invalid_request');
    const grantErr = new OAuthError(400, 'invalid_grant');
    const row = this.repo.getCode(hash(code));
    if (!row) throw grantErr;
    const grant = this.repo.getGrant(row.grantId);
    if (!grant || grant.clientId !== c.id) throw grantErr;
    const t = this.now();
    // A code seen twice means it leaked: everything issued from it dies.
    if (row.usedAt !== null || !this.repo.useCode(row.codeHash, t)) {
      this.repo.revokeFamily(grant.id, t);
      throw grantErr;
    }
    if (row.expiresAt <= t || grant.revokedAt !== null) throw grantErr;
    if (redirectUri !== row.redirectUri) throw grantErr;
    if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) throw grantErr;
    const expected = createHash('sha256').update(verifier).digest('base64url');
    if (expected.length !== row.codeChallenge.length) throw grantErr;
    if (!timingSafeEqual(Buffer.from(expected), Buffer.from(row.codeChallenge))) throw grantErr;
    this.repo.touchClient(c.id, t);
    this.issue(res, grant.id, grant.scopes, row.resource);
  }

  private refresh(res: ServerResponse, c: OAuthClient, form: URLSearchParams): void {
    const presented = form.get('refresh_token');
    if (!presented) throw new OAuthError(400, 'invalid_request');
    const grantErr = new OAuthError(400, 'invalid_grant');
    const oldHash = hash(presented);
    const row = this.repo.getToken(oldHash);
    if (!row || row.kind !== 'refresh') throw grantErr;
    const grant = this.repo.getGrant(row.grantId);
    if (!grant || grant.clientId !== c.id) throw grantErr;
    const t = this.now();
    // A rotated-out token is a replay: the whole family is revoked.
    if (row.replacedBy !== null) {
      this.repo.revokeFamily(row.familyId, t);
      throw grantErr;
    }
    if (row.revokedAt !== null || row.expiresAt <= t || grant.revokedAt !== null) throw grantErr;
    const asked = form.get('scope');
    const scopes = asked === null ? grant.scopes : parseScopes(asked);
    if (!scopes.every((s) => grant.scopes.includes(s))) throw new OAuthError(400, 'invalid_scope');
    const next = this.mint('refresh', grant.id, row.audience);
    if (!this.repo.rotateRefresh(oldHash, next.hash)) {
      this.repo.revokeFamily(row.familyId, t);
      throw grantErr;
    }
    this.repo.touchClient(c.id, t);
    const access = this.mint('access', grant.id, row.audience);
    // The access token carries every scope of the grant, so that is what is reported.
    this.respond(res, access.secret, next.secret, grant.scopes);
  }

  /** Store a fresh token's hash and return it with the secret that is shown once. */
  private mint(kind: 'access' | 'refresh', grantId: string, audience: string) {
    const secret = newSecret();
    const h = hash(secret);
    this.repo.insertToken({
      tokenHash: h,
      kind,
      grantId,
      familyId: grantId,
      audience,
      expiresAt: this.now() + (kind === 'access' ? ACCESS_TOKEN_TTL_MS : REFRESH_TOKEN_TTL_MS),
    });
    return { secret, hash: h };
  }

  private issue(res: ServerResponse, grantId: string, scopes: Scope[], audience: string): void {
    this.respond(
      res,
      this.mint('access', grantId, audience).secret,
      this.mint('refresh', grantId, audience).secret,
      scopes,
    );
  }

  private respond(res: ServerResponse, access: string, refresh: string, scopes: Scope[]): void {
    json(res, 200, {
      access_token: access,
      token_type: 'Bearer',
      expires_in: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
      refresh_token: refresh,
      scope: scopes.join(' '),
    });
  }
}
