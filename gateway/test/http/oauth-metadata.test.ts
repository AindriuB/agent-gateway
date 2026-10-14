import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { HttpServer } from '../../src/http/index.js';
import { startServer } from '../link/helpers.js';
import { REDIRECT, call, initBody, rig, stop, type Rig } from '../oauth/helpers.js';

let r: Rig | undefined;
afterEach(async () => {
  await stop(r);
  r = undefined;
});

describe('metadata', () => {
  it('serves RFC 8414 and RFC 9728 documents under the public URL', async () => {
    r = await rig();
    const as = await call(r.port, 'GET', '/.well-known/oauth-authorization-server');
    expect(as.status).toBe(200);
    expect(as.json()).toMatchObject({
      issuer: 'https://gw.example.com',
      authorization_endpoint: 'https://gw.example.com/authorize',
      token_endpoint: 'https://gw.example.com/token',
      registration_endpoint: 'https://gw.example.com/register',
      code_challenge_methods_supported: ['S256'],
      scopes_supported: ['read', 'write', 'destructive', 'code'],
    });
    for (const p of [
      '/.well-known/oauth-protected-resource',
      '/.well-known/oauth-protected-resource/mcp',
    ]) {
      const pr = await call(r.port, 'GET', p);
      expect(pr.json()).toMatchObject({
        resource: 'https://gw.example.com/mcp',
        authorization_servers: ['https://gw.example.com'],
      });
    }
  });

  it('is 404 without a public URL', async () => {
    const h = await startServer();
    const http = new HttpServer({
      host: '127.0.0.1',
      port: 0,
      registry: h.registry,
      version: '1',
      startedAt: Date.now(),
      createSession: () => {
        throw new Error('unused');
      },
      maxRequestBytes: 1000,
      rps: 100,
      maxSessions: 2,
      idleMs: 1000,
    });
    const port = await http.listen();
    try {
      for (const p of [
        '/.well-known/oauth-authorization-server',
        '/.well-known/oauth-protected-resource',
        '/register',
        '/authorize',
        '/token',
      ])
        expect((await call(port, 'GET', p, { host: `127.0.0.1:${port}` })).status).toBe(404);
    } finally {
      await http.close();
      await h.server.close();
      h.store.close();
    }
  });

  it('a 401 from /mcp points at the protected-resource metadata', async () => {
    r = await rig();
    const res = await r.mcp('nope', initBody);
    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toBe(
      'Bearer resource_metadata="https://gw.example.com/.well-known/oauth-protected-resource"',
    );
  });
});

describe('registration', () => {
  it('accepts none and client_secret_post, storing the secret only as a hash', async () => {
    r = await rig();
    const pub = await r.register({ redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none' });
    expect(pub.status).toBe(201);
    expect(pub.json().client_secret).toBeUndefined();
    const conf = await r.register({
      redirect_uris: [REDIRECT],
      token_endpoint_auth_method: 'client_secret_post',
    });
    expect(conf.status).toBe(201);
    const secret = conf.json().client_secret as string;
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    const db = new DatabaseSync(r.h.dbPath);
    const rows = db.prepare('SELECT secret_hash FROM oauth_clients').all() as {
      secret_hash: string | null;
    }[];
    db.close();
    expect(rows.map((x) => x.secret_hash).filter(Boolean)).toHaveLength(1);
    expect(rows.some((x) => x.secret_hash === secret)).toBe(false);
    expect(rows.find((x) => x.secret_hash)!.secret_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each([
    ['an http non-loopback URI', ['http://client.example/cb']],
    ['a fragment', ['https://client.example/cb#x']],
    ['more than 5 URIs', Array.from({ length: 6 }, (_, i) => `https://c.example/${i}`)],
    ['a URI over 512 characters', [`https://c.example/${'a'.repeat(512)}`]],
    ['a non-URL', ['not a url']],
    ['no URIs', []],
  ])('refuses %s', async (_name, uris) => {
    r = await rig();
    const res = await r.register({ redirect_uris: uris });
    expect(res.status).toBe(400);
    expect(res.json().error).toBe('invalid_redirect_uri');
  });

  it('accepts loopback http URIs and refuses unsupported auth methods', async () => {
    r = await rig();
    const ok = await r.register({
      redirect_uris: ['http://127.0.0.1:8080/cb', 'http://localhost/cb', 'http://[::1]:9/cb'],
    });
    expect(ok.status).toBe(201);
    const bad = await r.register({
      redirect_uris: [REDIRECT],
      token_endpoint_auth_method: 'client_secret_basic',
    });
    expect(bad.status).toBe(400);
    expect(bad.json().error).toBe('invalid_client_metadata');
  });

  it('stores the client name trimmed to 100 printable characters', async () => {
    r = await rig();
    const res = await r.register({
      redirect_uris: [REDIRECT],
      client_name: `  A\u0000‮B\n${'x'.repeat(200)}`,
    });
    const name = res.json().client_name as string;
    expect(name.length).toBe(100);
    expect(name.startsWith('AB')).toBe(true);
    expect(name).not.toMatch(/[\u0000-\u001f‮]/);
    expect(r.h.store.oauth.getClient(res.json().client_id as string)!.name).toBe(name);
  });
});
