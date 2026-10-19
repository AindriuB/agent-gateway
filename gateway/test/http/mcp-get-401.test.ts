import { afterEach, describe, expect, it } from 'vitest';
import { ACCESS_TOKEN_TTL_MS } from '../../src/oauth/server.js';
import { call, rig, stop, type Rig } from '../oauth/helpers.js';

// Pins what `GET /mcp` answers 401 for today (spike 156). It documents behaviour; it does not endorse it.
let r: Rig | undefined;
afterEach(async () => {
  await stop(r);
  r = undefined;
});

const get = (rr: Rig, headers: Record<string, string> = {}) =>
  call(rr.port, 'GET', '/mcp', {
    headers: { accept: 'text/event-stream', 'x-forwarded-for': '9.9.9.9', ...headers },
  });

const challenge = (h: unknown) => String(h);

describe('GET /mcp 401 replies', () => {
  it('no Authorization header: 401 with the resource_metadata challenge', async () => {
    r = await rig({ http: { trustProxy: true } });
    const res = await get(r);
    expect(res.status).toBe(401);
    expect(challenge(res.headers['www-authenticate'])).toMatch(/^Bearer resource_metadata="/);
  });

  it('expired access token: the same bare challenge, no error="invalid_token"', async () => {
    r = await rig({ http: { trustProxy: true } });
    const tok = await r.login(await r.client());
    r.clock.t += ACCESS_TOKEN_TTL_MS;
    const res = await get(r, { authorization: `Bearer ${tok.access_token}` });
    expect(res.status).toBe(401);
    expect(challenge(res.headers['www-authenticate'])).toMatch(/^Bearer resource_metadata="/);
    expect(challenge(res.headers['www-authenticate'])).not.toContain('invalid_token');
  });

  it('unknown token: 401, indistinguishable from the expired case', async () => {
    r = await rig({ http: { trustProxy: true } });
    const res = await get(r, { authorization: 'Bearer nope' });
    expect(res.status).toBe(401);
    expect(challenge(res.headers['www-authenticate'])).toMatch(/^Bearer resource_metadata="/);
  });

  it('a valid token is not refused', async () => {
    r = await rig({ http: { trustProxy: true } });
    const tok = await r.login(await r.client());
    const res = await get(r, { authorization: `Bearer ${tok.access_token}` });
    expect(res.status).not.toBe(401);
    expect(res.status).toBe(400); // no Mcp-Session-Id: past auth, refused for the missing session
  });
});
