import { createSessionServer } from '../../../src/mcp/session.js';
import { HttpServer } from '../../../src/http/index.js';
import { OAuthServer } from '../../../src/oauth/index.js';
import { startServer, type Harness } from '../../link/helpers.js';
import { fixtureTool } from '../../routing/harness.js';
import { PUBLIC, REDIRECT, call, pkce, type Reply } from '../helpers.js';

export interface ConsentRig {
  h: Harness;
  http: HttpServer;
  oauth: OAuthServer;
  port: number;
  clock: { t: number };
}

/** A public gateway with the real consent page (no test consent step). */
export async function consentRig(
  links: { privacyUrl?: string; sourceUrl?: string } = {},
  /** Task 98: wire the headless lookup the way app.ts does; `flag` is the flag/env agent. */
  headless?: { flag?: { worldId: string; userId: string } },
): Promise<ConsentRig> {
  const h = await startServer();
  const clock = { t: 1_000_000 };
  const oauth = new OAuthServer({
    repo: h.store.oauth,
    publicUrl: PUBLIC,
    now: () => clock.t,
    ...links,
    ...(headless
      ? {
          headless: {
            isAgent: (w: string, u: string) =>
              (headless.flag?.worldId === w && headless.flag.userId === u) ||
              h.store.headless.getByIdentity(w, u) !== undefined,
            ownerOf: (w: string, u: string) =>
              headless.flag?.worldId === w && headless.flag.userId === u
                ? undefined
                : (h.store.headless.getByIdentity(w, u)?.ownerUserId ?? undefined),
          },
        }
      : {}),
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
        tools: [fixtureTool],
        callTimeoutMs: 5000,
      }),
    maxRequestBytes: 100_000,
    rps: 1000,
    maxSessions: 16,
    idleMs: 60_000,
    now: () => clock.t,
  });
  const port = await http.listen();
  return { h, http, oauth, port, clock };
}

export async function stopRig(r: ConsentRig | undefined): Promise<void> {
  await r?.http.close();
  await r?.h.server.close();
  r?.h.store.close();
}

export const form = (p: Record<string, string | string[]>): string => {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(p))
    for (const x of Array.isArray(v) ? v : [v]) u.append(k, x);
  return u.toString();
};

export interface Page {
  reply: Reply;
  rid: string;
  csrf: string;
  cookie: string;
  clientId: string;
  verifier: string;
}

const field = (html: string, name: string): string =>
  new RegExp(`name="${name}" value="([^"]*)"`).exec(html)?.[1] ?? '';

/** Register a client and open the consent page for it. */
export async function openConsent(
  r: ConsentRig,
  clientName = 'Claude',
  scope = 'read write',
): Promise<Page> {
  const reg = await call(r.port, 'POST', '/register', {
    body: JSON.stringify({ redirect_uris: [REDIRECT], client_name: clientName }),
    headers: { 'content-type': 'application/json' },
  });
  const clientId = reg.json().client_id as string;
  const { verifier, challenge } = pkce();
  const reply = await call(
    r.port,
    'GET',
    `/authorize?${form({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: REDIRECT,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state: 's1',
      scope,
    })}`,
  );
  const sc = reply.headers['set-cookie'];
  const cookie = (Array.isArray(sc) ? sc[0] : sc)?.split(';')[0] ?? '';
  return {
    reply,
    rid: field(reply.body, 'rid'),
    csrf: field(reply.body, 'csrf'),
    cookie,
    clientId,
    verifier,
  };
}

export function postConsent(
  r: ConsentRig,
  page: Page,
  fields: Record<string, string | string[]>,
  over: { cookie?: string | null; origin?: string | null; host?: string; csrf?: string } = {},
): Promise<Reply> {
  const headers: Record<string, string> = {
    'content-type': 'application/x-www-form-urlencoded',
  };
  const cookie = over.cookie === undefined ? page.cookie : over.cookie;
  if (cookie) headers.cookie = cookie;
  const origin = over.origin === undefined ? PUBLIC : over.origin;
  if (origin) headers.origin = origin;
  return call(r.port, 'POST', '/authorize/consent', {
    body: form({ rid: page.rid, csrf: over.csrf ?? page.csrf, ...fields }),
    headers,
    ...(over.host ? { host: over.host } : {}),
  });
}

/** Walk the whole consent flow for `userId` (whose module is connected) and return its tokens. */
export async function grantVia(
  r: ConsentRig,
  m: { tc: { next(t?: string): Promise<unknown> } },
  userId: string,
  clientName = 'Claude',
  scope = 'read',
): Promise<{ access: string; refresh: string }> {
  const page = await openConsent(r, clientName, scope);
  await postConsent(r, page, {
    action: 'send',
    world: 'w1',
    user: userId,
    scope: scope.split(' '),
  });
  const { code } = (await m.tc.next('consentCode')) as { code: string };
  const done = await postConsent(r, page, { action: 'verify', code });
  const authCode = new URL(done.headers.location as string).searchParams.get('code')!;
  const tok = await call(r.port, 'POST', '/token', {
    body: form({
      grant_type: 'authorization_code',
      code: authCode,
      redirect_uri: REDIRECT,
      code_verifier: page.verifier,
      client_id: page.clientId,
    }),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  const b = tok.json();
  return { access: b.access_token as string, refresh: b.refresh_token as string };
}

export const mcpWith = (r: ConsentRig, token: string): Promise<Reply> =>
  call(r.port, 'GET', '/mcp', { headers: { authorization: `Bearer ${token}` } });
