import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { BoundedMap, FailureWindows } from '../../http/limits.js';
import { publicHostMatches } from '../../http/public-url.js';
import type { OAuthRepository, Scope } from '../repository.js';
import {
  CONSENT_HEADERS,
  renderCodePage,
  renderMessagePage,
  renderRequestPage,
  type FormView,
} from './render.js';

export { CONSENT_HEADERS, CODE_SENT_TEXT } from './render.js';

/** The one-time code is valid this long. */
export const CONSENT_CODE_TTL_MS = 5 * 60_000;
/** Wrong entries allowed before the consent request is void. */
export const MAX_WRONG_CODES = 5;
/** Codes one consent request may have sent; stops it being used to ring a user's window. */
export const MAX_CODE_SENDS = 3;
/** A consent request lives this long from /authorize. */
export const CONSENT_REQUEST_TTL_MS = 15 * 60_000;
export const MAX_PENDING_CONSENTS = 500;
/** Code sends per client key. */
export const CODE_SEND_LIMIT = { max: 10, windowMs: 60_000 } as const;
export const CONSENT_PATH = '/authorize/consent';
const MAX_TYPED_LENGTH = 200;
const CODE_DIGITS = 8;
const COOKIE_PREFIX = '__Host-agcsrf-';
const RID_PATTERN = /^[0-9a-f]{32}$/;

const sha = (s: string): Buffer => createHash('sha256').update(s).digest();
const sameBytes = (a: Buffer, b: Buffer): boolean => a.length === b.length && timingSafeEqual(a, b);

/** What /authorize validated and the consent request keeps until the human approves. */
export interface ConsentSeed {
  clientId: string;
  clientName: string;
  redirectUri: string;
  codeChallenge: string;
  scopes: readonly Scope[];
  state: string | undefined;
}

interface Pending extends ConsentSeed {
  id: string;
  csrf: string;
  createdAt: number;
  sends: number;
  wrong: number;
  /** The resolved (world, user) of the last send; undefined when it resolved to nobody. */
  target?: { worldId: string; userId: string };
  chosen: Scope[];
  codeHash?: Buffer;
  codeExpiresAt: number;
}

/** What the gateway wires in once it exists: who is connected, and the shared failure bucket. */
export interface ConsentWiring {
  registry: {
    get(worldId: string, userId: string): { send(data: string): void; closed?: boolean } | undefined;
  };
  failures: FailureWindows;
}

export interface ConsentPagesOptions {
  /** The external origin, e.g. `https://gw.example.com`. */
  publicUrl: string;
  repo: OAuthRepository;
  now: () => number;
  /** Create the grant and authorization code; returns where to send the browser. */
  finish(seed: ConsentSeed, approved: { worldId: string; userId: string; scopes: Scope[] }): string;
}

function send(
  res: ServerResponse,
  status: number,
  body: string,
  extra: Record<string, string | string[]> = {},
): void {
  if (res.headersSent) return;
  res.writeHead(status, { ...CONSENT_HEADERS, ...extra });
  res.end(body);
}

/** The consent page: world, Foundry user and scopes, then a one-time code shown only in that user's client. */
export class ConsentPages {
  private readonly pending = new BoundedMap<Pending>(MAX_PENDING_CONSENTS);
  private readonly origin: string;
  private readonly sends: FailureWindows;
  private wiring: ConsentWiring | undefined;
  private failures: FailureWindows;

  constructor(private readonly o: ConsentPagesOptions) {
    this.origin = new URL(o.publicUrl).origin;
    this.sends = new FailureWindows(CODE_SEND_LIMIT.max, CODE_SEND_LIMIT.windowMs, o.now);
    this.failures = new FailureWindows(10, 60_000, o.now);
  }

  attach(w: ConsentWiring): void {
    this.wiring = w;
    this.failures = w.failures;
  }

  hostAllowed(req: IncomingMessage): boolean {
    return publicHostMatches(req.headers.host, this.o.publicUrl);
  }

  /** Refuse any Host that is not the public one (loopback included). True when it answered. */
  refuseHost(req: IncomingMessage, res: ServerResponse): boolean {
    if (this.hostAllowed(req)) return false;
    send(res, 403, renderMessagePage('Forbidden', 'This page is not served on this address.'));
    return true;
  }

  private cookie(p: Pending, clear = false): string {
    return `${COOKIE_PREFIX}${p.id}=${clear ? '' : p.csrf}; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=${clear ? 0 : Math.floor(CONSENT_REQUEST_TTL_MS / 1000)}`;
  }

  /** GET /authorize, once validated: open a consent request and show the first page. */
  begin(res: ServerResponse, seed: ConsentSeed): void {
    const p: Pending = {
      ...seed,
      id: randomBytes(16).toString('hex'),
      csrf: randomBytes(24).toString('base64url'),
      createdAt: this.o.now(),
      sends: 0,
      wrong: 0,
      chosen: [],
      codeExpiresAt: 0,
    };
    this.pending.set(p.id, p);
    send(res, 200, renderRequestPage(this.view(p)), { 'set-cookie': this.cookie(p) });
  }

  private view(p: Pending, notice?: string): FormView {
    return {
      rid: p.id,
      csrf: p.csrf,
      clientName: p.clientName,
      scopes: p.scopes,
      ...(notice ? { notice } : {}),
    };
  }

  private live(rid: string): Pending | undefined {
    const p = this.pending.get(rid);
    if (!p) return undefined;
    if (this.o.now() - p.createdAt >= CONSENT_REQUEST_TTL_MS) {
      this.pending.delete(rid);
      return undefined;
    }
    return p;
  }

  private cookieValue(req: IncomingMessage, name: string): string | undefined {
    const raw = req.headers.cookie;
    if (typeof raw !== 'string') return undefined;
    for (const part of raw.split(';')) {
      const eq = part.indexOf('=');
      if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
    }
    return undefined;
  }

  /** POST /authorize/consent. `body` is the already size-limited form text. */
  submit(req: IncomingMessage, res: ServerResponse, client: string, body: string): void {
    const forbidden = (): void =>
      send(res, 403, renderMessagePage('Forbidden', 'This request was refused.'));
    if (this.refuseHost(req, res)) return;
    // A missing Origin is refused: a browser always sends it on a cross-origin or form POST.
    if (req.headers.origin !== this.origin) return forbidden();
    const form = new URLSearchParams(body);
    const rid = form.get('rid') ?? '';
    const csrf = form.get('csrf') ?? '';
    if (!RID_PATTERN.test(rid)) return forbidden();
    const cookie = this.cookieValue(req, COOKIE_PREFIX + rid);
    if (!cookie || !csrf || !sameBytes(sha(cookie), sha(csrf))) return forbidden();
    const p = this.live(rid);
    if (!p || !sameBytes(sha(p.csrf), sha(csrf))) {
      return send(
        res,
        400,
        renderMessagePage('Request expired', 'Start again from the application.'),
      );
    }
    const action = form.get('action');
    if (action === 'send') return this.sendCode(res, client, p, form);
    if (action === 'verify') return this.verify(res, client, p, form);
    forbidden();
  }

  private sendCode(
    res: ServerResponse,
    client: string,
    p: Pending,
    form: URLSearchParams,
  ): void {
    if (this.sends.limited(client)) {
      return send(res, 429, renderMessagePage('Slow down', 'Too many requests. Try again later.'), {
        'retry-after': '60',
      });
    }
    if (p.sends >= MAX_CODE_SENDS) return this.voidRequest(res, p);
    const chosen = form.getAll('scope').filter((s): s is Scope => p.scopes.includes(s as Scope));
    if (chosen.length === 0) {
      return send(res, 200, renderRequestPage(this.view(p, 'Choose at least one permission.')), {
        'set-cookie': this.cookie(p),
      });
    }
    this.sends.record(client);
    p.sends++;
    p.chosen = [...new Set(chosen)];
    p.target = this.resolve(form.get('world') ?? '', form.get('user') ?? '');
    p.codeHash = undefined;
    p.codeExpiresAt = 0;
    if (p.target) {
      const code = String(randomInt(0, 10 ** CODE_DIGITS)).padStart(CODE_DIGITS, '0');
      p.codeHash = sha(code);
      p.codeExpiresAt = this.o.now() + CONSENT_CODE_TTL_MS;
      this.deliver(p, code);
    }
    // Same body and status whoever was named, or whether they are online.
    send(res, 200, renderCodePage(this.view(p)), { 'set-cookie': this.cookie(p) });
  }

  /** The Foundry user id, or a name that exactly one active pairing in that world has. */
  private resolve(world: string, typed: string): Pending['target'] {
    const w = world.trim();
    const u = typed.trim();
    if (!w || !u || w.length > MAX_TYPED_LENGTH || u.length > MAX_TYPED_LENGTH) return undefined;
    const paired = this.o.repo.activePairedUsers(w);
    const byId = paired.find((r) => r.userId === u);
    if (byId) return { worldId: w, userId: byId.userId };
    const named = paired.filter((r) => r.userName !== '' && r.userName === u);
    return named.length === 1 && named[0]
      ? { worldId: w, userId: named[0].userId }
      : undefined;
  }

  /** The code goes to the chosen user's own link connection and nowhere else. */
  private deliver(p: Pending, code: string): void {
    const t = p.target;
    const conn = t ? this.wiring?.registry.get(t.worldId, t.userId) : undefined;
    if (!conn || conn.closed) return;
    try {
      conn.send(
        JSON.stringify({
          type: 'consentCode',
          code,
          clientName: p.clientName,
          scopes: p.chosen,
          expiresAt: p.codeExpiresAt,
        }),
      );
    } catch {
      /* The user's window is gone; the page says the same either way. */
    }
  }

  private verify(res: ServerResponse, client: string, p: Pending, form: URLSearchParams): void {
    if (this.failures.limited(client)) {
      return send(res, 429, renderMessagePage('Slow down', 'Too many wrong codes. Try again later.'), {
        'retry-after': '60',
      });
    }
    const typed = (form.get('code') ?? '').replace(/[\s-]/g, '');
    const ok =
      typed.length > 0 &&
      typed.length <= 32 &&
      p.codeHash !== undefined &&
      p.target !== undefined &&
      p.codeExpiresAt > this.o.now() &&
      sameBytes(sha(typed), p.codeHash);
    if (!ok || !p.target) {
      p.wrong++;
      this.failures.record(client);
      if (p.wrong >= MAX_WRONG_CODES) return this.voidRequest(res, p);
      return send(
        res,
        400,
        renderCodePage(this.view(p, 'That code is wrong or has expired.')),
        { 'set-cookie': this.cookie(p) },
      );
    }
    this.pending.delete(p.id);
    const location = this.o.finish(p, { ...p.target, scopes: p.chosen });
    send(res, 302, '', { location, 'set-cookie': this.cookie(p, true) });
  }

  private voidRequest(res: ServerResponse, p: Pending): void {
    this.pending.delete(p.id);
    send(
      res,
      400,
      renderMessagePage('Request cancelled', 'Too many attempts. Start again from the application.'),
      { 'set-cookie': this.cookie(p, true) },
    );
  }
}
