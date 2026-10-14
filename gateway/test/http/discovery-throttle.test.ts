import { afterEach, describe, expect, it } from 'vitest';
import { DISCOVERY_WINDOW_MS, MAX_DISCOVERY_PER_CLIENT } from '../../src/http/limits.js';
import { call, initBody, rig, stop, type Rig } from '../oauth/helpers.js';

let r: Rig | undefined;
afterEach(async () => {
  await stop(r);
  r = undefined;
});

const XFF = (ip: string) => ({ 'x-forwarded-for': ip });
const A = '9.9.9.9';
const post = (rr: Rig, headers: Record<string, string>) =>
  call(rr.port, 'POST', '/mcp', {
    body: initBody,
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...headers,
    },
  });
const anon = (rr: Rig, ip = A) => post(rr, XFF(ip));
const withAuth = (rr: Rig, authorization: string, ip = A) =>
  post(rr, { ...XFF(ip), authorization });

async function lockOut(rr: Rig): Promise<void> {
  for (let i = 0; i < 10; i++) expect((await withAuth(rr, 'Bearer wrong')).status).toBe(401);
}

describe('credential-free /mcp discovery', () => {
  it('is not a failed authentication', async () => {
    r = await rig({ http: { trustProxy: true } });
    for (let i = 0; i < 12; i++) {
      r.clock.t += 1000;
      const res = await anon(r);
      expect(res.status).toBe(401);
      expect(String(res.headers['www-authenticate'])).toContain('resource_metadata=');
    }
    const c = await r.client();
    const tok = await r.login(c);
    r.clock.t += 1000;
    const ok = await post(r, { ...XFF(A), authorization: `Bearer ${tok.access_token}` });
    expect(ok.status).toBe(200);
  });

  it('keeps the invalid-token lockout', async () => {
    r = await rig({ http: { trustProxy: true } });
    const c = await r.client();
    const tok = await r.login(c);
    await lockOut(r);
    const eleventh = await withAuth(r, 'Bearer wrong');
    expect(eleventh.status).toBe(429);
    expect(eleventh.headers['retry-after']).toBeDefined();
    expect((await withAuth(r, `Bearer ${tok.access_token}`)).status).toBe(429);
    r.clock.t += 61_000;
    expect((await withAuth(r, 'Bearer wrong')).status).toBe(401);
  });

  it.each(['', 'Basic abc'])('counts a malformed credential (%j) as a failure', async (h) => {
    r = await rig({ http: { trustProxy: true } });
    for (let i = 0; i < 10; i++) expect((await withAuth(r, h)).status).toBe(401);
    expect((await withAuth(r, h)).status).toBe(429);
  });

  it('still answers a locked-out client with no credentials, without authenticating', async () => {
    let calls = 0;
    r = await rig({
      http: {
        trustProxy: true,
        authenticate: () => {
          calls++;
          return undefined;
        },
      },
    });
    await lockOut(r);
    const before = calls;
    const res = await anon(r);
    expect(res.status).toBe(401);
    expect(String(res.headers['www-authenticate'])).toContain('resource_metadata=');
    expect(calls).toBe(before);
  });

  it('is throttled per client key and the window rolls', async () => {
    r = await rig({ http: { trustProxy: true } });
    for (let i = 0; i < MAX_DISCOVERY_PER_CLIENT; i++) expect((await anon(r)).status).toBe(401);
    const over = await anon(r);
    expect(over.status).toBe(429);
    expect(over.headers['retry-after']).toBeDefined();
    expect(over.headers['www-authenticate']).toBeUndefined();
    expect((await anon(r, '8.8.8.8')).status).toBe(401);
    r.clock.t += DISCOVERY_WINDOW_MS + 1;
    expect((await anon(r)).status).toBe(401);
  });

  it('does not feed the failed-auth lockout', async () => {
    r = await rig({ http: { trustProxy: true } });
    for (let i = 0; i < MAX_DISCOVERY_PER_CLIENT; i++) await anon(r);
    expect((await withAuth(r, 'Bearer wrong')).status).toBe(401);
  });
});
