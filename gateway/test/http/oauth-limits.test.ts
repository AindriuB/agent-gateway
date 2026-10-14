import { afterEach, describe, expect, it } from 'vitest';
import { call, initBody, pkce, REDIRECT, rig, stop, type Rig } from '../oauth/helpers.js';

let r: Rig | undefined;
afterEach(async () => {
  await stop(r);
  r = undefined;
});

const XFF = (ip: string) => ({ 'x-forwarded-for': ip });

describe('rate limits, keyed by client', () => {
  it('the sixth /register in an hour is 429; another key still registers', async () => {
    r = await rig({ http: { trustProxy: true } });
    for (let i = 0; i < 5; i++)
      expect((await r.register(undefined, XFF('9.9.9.9'))).status).toBe(201);
    const sixth = await r.register(undefined, XFF('9.9.9.9'));
    expect(sixth.status).toBe(429);
    expect((await r.register(undefined, XFF('8.8.8.8'))).status).toBe(201);
    // The window rolls.
    r.clock.t += 60 * 60_000 + 1;
    // 127.0.0.1 peers are trusted for XFF only when the header is present; use the same key.
    expect((await r.register(undefined, XFF('9.9.9.9'))).status).toBe(201);
  });

  it('the 31st /token in a minute is 429; another key still gets an answer', async () => {
    r = await rig({ http: { trustProxy: true } });
    const bad = { grant_type: 'authorization_code', client_id: 'x' };
    for (let i = 0; i < 30; i++) expect((await r.token(bad, XFF('9.9.9.9'))).status).not.toBe(429);
    expect((await r.token(bad, XFF('9.9.9.9'))).status).toBe(429);
    expect((await r.token(bad, XFF('8.8.8.8'))).status).not.toBe(429);
  });

  it('the 31st /authorize in a minute is 429; another key still gets an answer', async () => {
    r = await rig({ http: { trustProxy: true } });
    const c = await r.client();
    const params = {
      response_type: 'code',
      client_id: c.id,
      redirect_uri: REDIRECT,
      code_challenge: pkce().challenge,
      code_challenge_method: 'S256',
    };
    for (let i = 0; i < 30; i++)
      expect((await r.authorize(params, XFF('9.9.9.9'))).status).toBe(302);
    expect((await r.authorize(params, XFF('9.9.9.9'))).status).toBe(429);
    expect((await r.authorize(params, XFF('8.8.8.8'))).status).toBe(302);
  });
});

describe('MAX_OAUTH_CLIENTS', () => {
  it('prunes clients older than 24 h with no grant, else answers 503 temporarily_unavailable', async () => {
    r = await rig({ maxClients: 3, http: { trustProxy: true } });
    const from = (n: number) => XFF(`10.0.0.${n}`);
    const a = await r.register(undefined, from(1));
    const b = await r.register(undefined, from(2));
    const kept = await r.register(undefined, from(3));
    expect([a.status, b.status, kept.status]).toEqual([201, 201, 201]);
    // Full and nothing is old enough: refused.
    const full = await r.register(undefined, from(4));
    expect(full.status).toBe(503);
    expect(full.json()).toEqual({ error: 'temporarily_unavailable' });
    // Give one client a grant, then let a day pass: the other two are pruned, the granted one stays.
    const granted = a.json().client_id as string;
    await r.login({ id: granted });
    r.clock.t += 24 * 60 * 60_000 + 1;
    const fresh = await r.register(undefined, from(5));
    expect(fresh.status).toBe(201);
    expect(r.h.store.oauth.getClient(granted)).toBeDefined();
    expect(r.h.store.oauth.getClient(b.json().client_id as string)).toBeUndefined();
    expect(r.h.store.oauth.getClient(kept.json().client_id as string)).toBeUndefined();
    expect(r.h.store.oauth.countClients()).toBe(2);
  });

  it('when every old client has a grant nothing can be pruned', async () => {
    r = await rig({ maxClients: 1 });
    const only = await r.client();
    await r.login(only);
    r.clock.t += 25 * 60 * 60_000;
    const res = await r.register();
    expect(res.status).toBe(503);
  });
});

describe('public /status authentication', () => {
  it('counts failures, then answers 429 even to a valid credential from that client', async () => {
    r = await rig({ http: { trustProxy: true } });
    const tok = await r.login(await r.client());
    const headers = (bearer: string) => ({ authorization: `Bearer ${bearer}`, ...XFF('7.7.7.7') });
    for (let i = 0; i < 10; i++)
      expect((await call(r.port, 'GET', '/status', { headers: headers('wrong') })).status).toBe(
        200,
      );
    const blocked = await call(r.port, 'GET', '/status', { headers: headers(tok.access_token!) });
    expect(blocked.status).toBe(429);
    // Another client is unaffected, and so is /mcp for the blocked one only after the window.
    const other = await call(r.port, 'GET', '/status', {
      headers: { authorization: `Bearer ${tok.access_token}`, ...XFF('6.6.6.6') },
    });
    expect(other.status).toBe(200);
    expect((await r.mcp(tok.access_token!, initBody, XFF('7.7.7.7'))).status).toBe(429);
  });

  it('does not count a request that offers no credential', async () => {
    r = await rig({ http: { trustProxy: true } });
    for (let i = 0; i < 30; i++)
      expect((await call(r.port, 'GET', '/status', { headers: XFF('5.5.5.5') })).status).toBe(200);
  });

  it('rate limits a client that keeps presenting credentials', async () => {
    r = await rig({ http: { trustProxy: true } });
    const tok = await r.login(await r.client());
    const statuses: number[] = [];
    for (let i = 0; i < 15; i++)
      statuses.push(
        (
          await call(r.port, 'GET', '/status', {
            headers: { authorization: `Bearer ${tok.access_token}`, ...XFF('4.4.4.4') },
          })
        ).status,
      );
    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(statuses.slice(10)).toContain(429);
  });
});
