import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { AutoDenyConsent } from '../../src/oauth/index.js';
import { ACCESS_TOKEN_TTL_MS, AUTH_CODE_TTL_MS } from '../../src/oauth/server.js';
import { initBody, pkce, REDIRECT, RESOURCE, rig, stop, type Rig } from '../oauth/helpers.js';

let r: Rig | undefined;
afterEach(async () => {
  await stop(r);
  r = undefined;
});

const base = (c: { id: string }, extra: Record<string, string> = {}) => {
  const p = pkce();
  return {
    p,
    params: {
      response_type: 'code',
      client_id: c.id,
      redirect_uri: REDIRECT,
      code_challenge: p.challenge,
      code_challenge_method: 'S256',
      state: 'st',
      ...extra,
    },
  };
};

const codeOf = (loc: unknown): string => new URL(String(loc)).searchParams.get('code') ?? 'MISSING';

const exchange = (
  rr: Rig,
  c: { id: string; secret?: string },
  code: string,
  verifier: string,
  extra: Record<string, string> = {},
) =>
  rr.token({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT,
    code_verifier: verifier,
    client_id: c.id,
    ...(c.secret ? { client_secret: c.secret } : {}),
    ...extra,
  });

describe('/authorize', () => {
  it.each([
    ['a missing code_challenge', { code_challenge: '' }, 'invalid_request'],
    ['method plain', { code_challenge_method: 'plain' }, 'invalid_request'],
    ['a missing method', { code_challenge_method: '' }, 'invalid_request'],
    ['response_type token', { response_type: 'token' }, 'unsupported_response_type'],
    ['an unknown scope', { scope: 'admin' }, 'invalid_scope'],
  ])('refuses %s with a redirect carrying the error and state', async (_n, over, error) => {
    r = await rig();
    const c = await r.client();
    const { params } = base(c, over);
    for (const k of Object.keys(params) as (keyof typeof params)[])
      if (params[k] === '') delete (params as Record<string, string>)[k];
    const res = await r.authorize(params);
    expect(res.status).toBe(302);
    const u = new URL(res.headers.location as string);
    expect(`${u.origin}${u.pathname}`).toBe(REDIRECT);
    expect(u.searchParams.get('error')).toBe(error);
    expect(u.searchParams.get('state')).toBe('st');
    expect(r.consent.requests).toHaveLength(0);
  });

  it('shows an error page, never a redirect, for a redirect_uri that is not exactly registered', async () => {
    r = await rig();
    const c = await r.client();
    for (const uri of [
      `${REDIRECT}/`,
      `${REDIRECT}?x=1`,
      'https://evil.example/cb',
      'https://client.example',
    ]) {
      const res = await r.authorize(base(c, { redirect_uri: uri }).params);
      expect(res.status).toBe(400);
      expect(res.headers.location).toBeUndefined();
      expect(res.headers['content-type']).toContain('text/html');
    }
    const unknown = await r.authorize(base({ id: 'nope' }).params);
    expect(unknown.status).toBe(400);
    expect(unknown.headers.location).toBeUndefined();
  });

  it('the error page echoes no request text', async () => {
    r = await rig();
    const res = await r.authorize(
      base({ id: '<script>alert(1)</script>' }, { redirect_uri: '"><img src=x>' }).params,
    );
    expect(res.body).not.toContain('<script>');
    expect(res.body).not.toContain('<img');
  });

  it('with the default AutoDenyConsent redirects with access_denied and the state', async () => {
    r = await rig();
    // Rebuild the authorization server with the shipped default consent.
    const { OAuthServer } = await import('../../src/oauth/index.js');
    const denying = new OAuthServer({
      repo: r.h.store.oauth,
      publicUrl: 'https://gw.example.com',
      consent: new AutoDenyConsent(),
    });
    const c = await r.client();
    const { fakeRes, out } = capture();
    await denying.handle(
      {
        method: 'GET',
        url: `/authorize?${new URLSearchParams(base(c).params)}`,
        headers: {},
      } as never,
      fakeRes as never,
      '/authorize',
      'k',
    );
    expect(out.status).toBe(302);
    const u = new URL(out.headers.location as string);
    expect(u.searchParams.get('error')).toBe('access_denied');
    expect(u.searchParams.get('state')).toBe('st');
  });

  it('the shipped default is auto-deny', async () => {
    const { OAuthServer } = await import('../../src/oauth/index.js');
    r = await rig();
    const dflt = new OAuthServer({ repo: r.h.store.oauth, publicUrl: 'https://gw.example.com' });
    const c = await r.client();
    const { fakeRes, out } = capture();
    await dflt.handle(
      {
        method: 'GET',
        url: `/authorize?${new URLSearchParams(base(c).params)}`,
        headers: {},
      } as never,
      fakeRes as never,
      '/authorize',
      'k',
    );
    expect(new URL(out.headers.location as string).searchParams.get('error')).toBe('access_denied');
  });

  it('the consent step can narrow scopes but not widen them', async () => {
    r = await rig();
    const c = await r.client();
    r.consent.next = () => ({
      approve: { worldId: 'w1', userId: 'u1', scopes: ['read', 'destructive'] },
    });
    const tok = await r.login(c, 'read write');
    expect(tok.scope).toBe('read');
  });
});

function capture() {
  const out = { status: 0, headers: {} as Record<string, unknown>, body: '' };
  const fakeRes = {
    headersSent: false,
    writeHead(s: number, h: Record<string, unknown>) {
      out.status = s;
      out.headers = h;
    },
    end(b?: string) {
      out.body = b ?? '';
    },
  };
  return { fakeRes, out };
}

describe('audience', () => {
  it('refuses a foreign resource at /authorize and /token with invalid_target', async () => {
    r = await rig();
    const c = await r.client();
    const a = await r.authorize(base(c, { resource: 'https://evil.example/mcp' }).params);
    expect(new URL(a.headers.location as string).searchParams.get('error')).toBe('invalid_target');
    const { p, params } = base(c);
    const ok = await r.authorize(params);
    const t = await exchange(r, c, codeOf(ok.headers.location), p.verifier, {
      resource: 'https://evil.example/mcp',
    });
    expect(t.status).toBe(400);
    expect(t.json().error).toBe('invalid_target');
  });

  it('binds an absent resource to the canonical one, and accepts it when given', async () => {
    r = await rig();
    const c = await r.client();
    await r.login(c);
    const given = await r.authorize(base(c, { resource: RESOURCE }).params);
    expect(new URL(given.headers.location as string).searchParams.get('code')).toBeTruthy();
    const db = new DatabaseSync(r.h.dbPath);
    const aud = db.prepare('SELECT DISTINCT audience FROM oauth_tokens').all();
    db.close();
    expect(aud).toEqual([{ audience: RESOURCE }]);
  });

  it('refuses at /mcp a token whose stored audience differs', async () => {
    r = await rig();
    const c = await r.client();
    const tok = await r.login(c);
    expect((await r.mcp(tok.access_token!, initBody)).status).toBe(200);
    const db = new DatabaseSync(r.h.dbPath);
    db.prepare("UPDATE oauth_tokens SET audience = 'https://evil.example/mcp'").run();
    db.close();
    expect((await r.mcp(tok.access_token!, initBody)).status).toBe(401);
  });
});

describe('codes and tokens', () => {
  it('a code is single use; its replay is invalid_grant and revokes what the first use issued', async () => {
    r = await rig();
    const c = await r.client();
    const { p, params } = base(c);
    const code = codeOf((await r.authorize(params)).headers.location);
    const first = await exchange(r, c, code, p.verifier);
    expect(first.status).toBe(200);
    const access = first.json().access_token as string;
    expect((await r.mcp(access, initBody)).status).toBe(200);
    const again = await exchange(r, c, code, p.verifier);
    expect(again.status).toBe(400);
    expect(again.json().error).toBe('invalid_grant');
    expect((await r.mcp(access, initBody)).status).toBe(401);
    // The refresh token from the first use is dead too.
    const refresh = await r.token({
      grant_type: 'refresh_token',
      refresh_token: first.json().refresh_token as string,
      client_id: c.id,
    });
    expect(refresh.json().error).toBe('invalid_grant');
  });

  it('a code expires after 60 s', async () => {
    r = await rig();
    const c = await r.client();
    const { p, params } = base(c);
    const code = codeOf((await r.authorize(params)).headers.location);
    r.clock.t += AUTH_CODE_TTL_MS;
    const res = await exchange(r, c, code, p.verifier);
    expect(res.json().error).toBe('invalid_grant');
  });

  it('a wrong verifier, redirect_uri or client fails, and the first two burn the code', async () => {
    r = await rig();
    const c = await r.client();
    const other = await r.client();
    const { p, params } = base(c);
    const code = codeOf((await r.authorize(params)).headers.location);
    expect((await exchange(r, other, code, p.verifier)).json().error).toBe('invalid_grant');
    expect((await exchange(r, c, code, pkce().verifier)).json().error).toBe('invalid_grant');
    // Burned by the bad verifier: even the right one now fails.
    expect((await exchange(r, c, code, p.verifier)).json().error).toBe('invalid_grant');
    const code2 = codeOf((await r.authorize(params)).headers.location);
    const bad = await exchange(r, c, code2, p.verifier, { redirect_uri: `${REDIRECT}/` });
    expect(bad.json().error).toBe('invalid_grant');
  });

  it('a confidential client must present its secret', async () => {
    r = await rig();
    const c = await r.client({ token_endpoint_auth_method: 'client_secret_post' });
    const { p, params } = base(c);
    const code = codeOf((await r.authorize(params)).headers.location);
    const noSecret = await exchange(r, { id: c.id }, code, p.verifier);
    expect(noSecret.status).toBe(401);
    expect(noSecret.json().error).toBe('invalid_client');
    const wrong = await exchange(r, { id: c.id, secret: 'f'.repeat(64) }, code, p.verifier);
    expect(wrong.status).toBe(401);
    expect((await exchange(r, c, code, p.verifier)).status).toBe(200);
  });

  it('refresh rotates; the old token fails and presenting it again revokes the family', async () => {
    r = await rig();
    const c = await r.client();
    const t1 = await r.login(c);
    const refresh = (token: string) =>
      r!.token({ grant_type: 'refresh_token', refresh_token: token, client_id: c.id });
    const second = await refresh(t1.refresh_token!);
    expect(second.status).toBe(200);
    const t2 = second.json() as Record<string, string>;
    expect(t2.refresh_token).not.toBe(t1.refresh_token);
    expect((await r.mcp(t2.access_token!, initBody)).status).toBe(200);
    const replay = await refresh(t1.refresh_token!);
    expect(replay.status).toBe(400);
    expect(replay.json().error).toBe('invalid_grant');
    // The reuse killed the newest access and refresh tokens as well.
    expect((await r.mcp(t2.access_token!, initBody)).status).toBe(401);
    expect((await refresh(t2.refresh_token!)).json().error).toBe('invalid_grant');
  });

  it('refresh cannot widen scope and a refresh token is not an access token', async () => {
    r = await rig();
    const c = await r.client();
    const t = await r.login(c, 'read');
    const wide = await r.token({
      grant_type: 'refresh_token',
      refresh_token: t.refresh_token!,
      client_id: c.id,
      scope: 'read write',
    });
    expect(wide.json().error).toBe('invalid_scope');
    expect((await r.mcp(t.refresh_token!, initBody)).status).toBe(401);
  });

  it('a refresh with a narrower scope reports the scope the new token actually carries', async () => {
    r = await rig();
    const c = await r.client();
    const t = await r.login(c, 'read write');
    const res = await r.token({
      grant_type: 'refresh_token',
      refresh_token: t.refresh_token!,
      client_id: c.id,
      scope: 'read',
    });
    expect(res.status).toBe(200);
    // The access token carries every grant scope, so the response says so.
    expect(res.json().scope).toBe('read write');
    const principal = r.oauth.authenticate(res.json().access_token as string);
    expect(principal?.scopes).toEqual(['read', 'write']);
  });

  it('a refresh token is bound to its client', async () => {
    r = await rig();
    const c = await r.client();
    const other = await r.client();
    const t = await r.login(c);
    const res = await r.token({
      grant_type: 'refresh_token',
      refresh_token: t.refresh_token!,
      client_id: other.id,
    });
    expect(res.json().error).toBe('invalid_grant');
  });

  it('an access token expires after ACCESS_TOKEN_TTL_MS; a refresh token outlives it', async () => {
    r = await rig();
    const c = await r.client();
    const t = await r.login(c);
    r.clock.t += ACCESS_TOKEN_TTL_MS - 1;
    expect((await r.mcp(t.access_token!, initBody)).status).toBe(200);
    r.clock.t += 1;
    expect((await r.mcp(t.access_token!, initBody)).status).toBe(401);
    const again = await r.token({
      grant_type: 'refresh_token',
      refresh_token: t.refresh_token!,
      client_id: c.id,
    });
    expect(again.status).toBe(200);
    expect(t.expires_in).toBe(3600);
  });

  it('refuses unknown grant types and a refresh token past its 30 days', async () => {
    r = await rig();
    const c = await r.client();
    const t = await r.login(c);
    const bad = await r.token({ grant_type: 'password', client_id: c.id });
    expect(bad.json().error).toBe('unsupported_grant_type');
    r.clock.t += 31 * 24 * 60 * 60_000;
    const old = await r.token({
      grant_type: 'refresh_token',
      refresh_token: t.refresh_token!,
      client_id: c.id,
    });
    expect(old.json().error).toBe('invalid_grant');
  });

  it('keeps no token, code or client secret in clear text in the database', async () => {
    r = await rig();
    const c = await r.client({ token_endpoint_auth_method: 'client_secret_post' });
    const { p, params } = base(c);
    const code = codeOf((await r.authorize(params)).headers.location);
    const t = (await exchange(r, c, code, p.verifier)).json() as Record<string, string>;
    const secrets = [t.access_token!, t.refresh_token!, code, c.secret!];
    const db = new DatabaseSync(r.h.dbPath);
    const cols = [
      ['oauth_tokens', 'token_hash'],
      ['oauth_codes', 'code_hash'],
      ['oauth_clients', 'secret_hash'],
    ] as const;
    let seen = 0;
    for (const [table, col] of cols) {
      for (const row of db.prepare(`SELECT ${col} AS v FROM ${table}`).all() as { v: string }[]) {
        expect(row.v).toMatch(/^[0-9a-f]{64}$/);
        seen++;
      }
    }
    expect(seen).toBe(4);
    for (const table of ['oauth_tokens', 'oauth_codes', 'oauth_clients', 'oauth_grants']) {
      const dump = JSON.stringify(db.prepare(`SELECT * FROM ${table}`).all());
      for (const s of secrets) expect(dump).not.toContain(s);
    }
    db.close();
  });
});
