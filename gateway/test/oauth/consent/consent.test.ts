import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { PUBLIC, REDIRECT, call } from '../helpers.js';
import { pairModule, type FakeModule } from '../../routing/harness.js';
import { CONSENT_CODE_TTL_MS, CODE_SENT_TEXT, MAX_WRONG_CODES } from '../../../src/oauth/index.js';
import { consentRig, openConsent, postConsent, stopRig, type ConsentRig } from './rig.js';

let r: ConsentRig | undefined;
const modules: FakeModule[] = [];
afterEach(async () => {
  modules.splice(0).forEach((m) => m.tc.ws.terminate());
  await stopRig(r);
  r = undefined;
});

const codeFrame = async (m: FakeModule): Promise<{ code: string; clientName: string }> =>
  (await m.tc.next('consentCode')) as unknown as { code: string; clientName: string };

describe('user resolution and the code', () => {
  it('sends the code only to the chosen user, and the answer is the same for everyone', async () => {
    r = await consentRig();
    const u1 = await pairModule(r.h, 'u1', { userName: 'Alice' });
    const u2 = await pairModule(r.h, 'u2', { userName: 'Bob' });
    modules.push(u1, u2);
    // An offline user: paired, never connected.
    r.h.store.createPairing({
      id: 'p3',
      tokenHash: 'h3',
      worldId: 'w1',
      userId: 'u3',
      userName: 'Carol',
      origin: 'http://localhost:30000',
    });
    const answers: { status: number; body: string }[] = [];
    for (const user of ['u1', 'Carol', 'nobody']) {
      const page = await openConsent(r);
      const a = await postConsent(r, page, { action: 'send', world: 'w1', user, scope: 'read' });
      // Bodies carry the per-request id and token; compare with those removed.
      answers.push({
        status: a.status,
        body: a.body.replaceAll(page.rid, 'RID').replaceAll(page.csrf, 'CSRF'),
      });
    }
    expect(answers[0]!.status).toBe(200);
    expect(answers[0]!.body).toContain(CODE_SENT_TEXT);
    expect(answers[1]).toEqual(answers[0]);
    expect(answers[2]).toEqual(answers[0]);
    const frame = await codeFrame(u1);
    expect(frame.code).toMatch(/^\d{8}$/);
    expect(frame.clientName).toBe('Claude');
    expect(u2.tc.messages.filter((m) => m.type === 'consentCode')).toHaveLength(0);
  });

  it('resolves a name shared by two pairings to nobody and sends no code', async () => {
    r = await consentRig();
    const a = await pairModule(r.h, 'ua', { userName: 'Gamemaster' });
    const b = await pairModule(r.h, 'ub', { userName: 'Gamemaster' });
    modules.push(a, b);
    const page = await openConsent(r);
    const res = await postConsent(r, page, {
      action: 'send',
      world: 'w1',
      user: 'Gamemaster',
      scope: 'read',
    });
    expect(res.body).toContain(CODE_SENT_TEXT);
    await new Promise((x) => setTimeout(x, 50));
    for (const m of [a, b])
      expect(m.tc.messages.filter((x) => x.type === 'consentCode')).toHaveLength(0);
    // The ids still work.
    const page2 = await openConsent(r);
    await postConsent(r, page2, { action: 'send', world: 'w1', user: 'ua', scope: 'read' });
    expect((await codeFrame(a)).code).toMatch(/^\d{8}$/);
  });

  it('approves with the right code, binds the grant to the user, and redirects', async () => {
    r = await consentRig();
    const u1 = await pairModule(r.h, 'u1', { userName: 'Alice' });
    modules.push(u1);
    const page = await openConsent(r);
    await postConsent(r, page, {
      action: 'send',
      world: 'w1',
      user: 'Alice',
      scope: ['read', 'write'],
    });
    const { code } = await codeFrame(u1);
    const done = await postConsent(r, page, { action: 'verify', code });
    expect(done.status).toBe(302);
    const loc = new URL(done.headers.location as string);
    expect(loc.origin + loc.pathname).toBe(REDIRECT);
    expect(loc.searchParams.get('state')).toBe('s1');
    const authCode = loc.searchParams.get('code')!;
    const tok = await call(r.port, 'POST', '/token', {
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: authCode,
        redirect_uri: REDIRECT,
        code_verifier: page.verifier,
        client_id: page.clientId,
      }).toString(),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(tok.status).toBe(200);
    expect(tok.json().scope).toBe('read write');
    const grants = r.h.store.oauth.listLiveGrants('w1', 'u1');
    expect(grants).toHaveLength(1);
    expect(grants[0]!.scopes).toEqual(['read', 'write']);
    expect(r.h.store.oauth.listLiveGrants('w1', 'u2')).toHaveLength(0);
    // The request is spent: replaying the code is refused.
    expect((await postConsent(r, page, { action: 'verify', code })).status).toBe(400);
  });

  it('cannot widen the scopes beyond the request', async () => {
    r = await consentRig();
    const u1 = await pairModule(r.h, 'u1');
    modules.push(u1);
    const page = await openConsent(r, 'C', 'read');
    await postConsent(r, page, {
      action: 'send',
      world: 'w1',
      user: 'u1',
      scope: ['read', 'destructive', 'code'],
    });
    const { code } = await codeFrame(u1);
    await postConsent(r, page, { action: 'verify', code });
    expect(r.h.store.oauth.listLiveGrants('w1', 'u1')[0]!.scopes).toEqual(['read']);
  });

  it('refuses a code after five minutes', async () => {
    r = await consentRig();
    const u1 = await pairModule(r.h, 'u1');
    modules.push(u1);
    const page = await openConsent(r);
    await postConsent(r, page, { action: 'send', world: 'w1', user: 'u1', scope: 'read' });
    const { code } = await codeFrame(u1);
    r.clock.t += CONSENT_CODE_TTL_MS + 1;
    const late = await postConsent(r, page, { action: 'verify', code });
    expect(late.status).toBe(400);
    expect(r.h.store.oauth.listLiveGrants('w1', 'u1')).toHaveLength(0);
  });

  it('counts wrong codes, voids the request after five, and the right code no longer works', async () => {
    r = await consentRig();
    const u1 = await pairModule(r.h, 'u1');
    modules.push(u1);
    const page = await openConsent(r);
    await postConsent(r, page, { action: 'send', world: 'w1', user: 'u1', scope: 'read' });
    const { code } = await codeFrame(u1);
    const wrong = code === '00000000' ? '11111111' : '00000000';
    for (let i = 0; i < MAX_WRONG_CODES; i++) {
      const res = await postConsent(r, page, { action: 'verify', code: wrong });
      expect(res.status).toBe(400);
    }
    const after = await postConsent(r, page, { action: 'verify', code });
    expect(after.status).toBe(400);
    expect(after.headers.location).toBeUndefined();
    expect(r.h.store.oauth.listLiveGrants('w1', 'u1')).toHaveLength(0);
  });

  it('wrong entries fill the per-client failure bucket shared with /mcp', async () => {
    r = await consentRig();
    const u1 = await pairModule(r.h, 'u1');
    modules.push(u1);
    for (let n = 0; n < 2; n++) {
      const page = await openConsent(r);
      await postConsent(r, page, { action: 'send', world: 'w1', user: 'u1', scope: 'read' });
      for (let i = 0; i < MAX_WRONG_CODES; i++)
        await postConsent(r, page, { action: 'verify', code: 'x' });
    }
    const mcp = await call(r.port, 'POST', '/mcp', {
      headers: { authorization: 'Bearer nope', 'content-type': 'application/json' },
      body: '{}',
    });
    expect(mcp.status).toBe(429);
  });
});

describe('pairing changes between send and verify', () => {
  it('creates no grant when the pairing was revoked after the code was sent', async () => {
    r = await consentRig();
    const u1 = await pairModule(r.h, 'u1');
    modules.push(u1);
    const page = await openConsent(r);
    await postConsent(r, page, { action: 'send', world: 'w1', user: 'u1', scope: 'read' });
    const { code } = await codeFrame(u1);
    const pairing = r.h.store.listActivePairings().find((p) => p.userId === 'u1')!;
    r.h.store.revokePairing(pairing.id);
    const res = await postConsent(r, page, { action: 'verify', code });
    expect(res.status).toBe(400);
    expect(res.headers.location).toBeUndefined();
    const db = new DatabaseSync(r.h.dbPath, { readOnly: true });
    expect((db.prepare('SELECT count(*) AS n FROM oauth_grants').get() as { n: number }).n).toBe(0);
    db.close();
  });
});

describe('CSRF', () => {
  const send = { action: 'send', world: 'w1', user: 'u1', scope: 'read' };
  it('refuses a POST without the cookie', async () => {
    r = await consentRig();
    const page = await openConsent(r);
    expect((await postConsent(r, page, send, { cookie: null })).status).toBe(403);
  });
  it('refuses a mismatched token', async () => {
    r = await consentRig();
    const page = await openConsent(r);
    expect((await postConsent(r, page, send, { csrf: 'other' })).status).toBe(403);
  });
  it('refuses a missing Origin', async () => {
    r = await consentRig();
    const page = await openConsent(r);
    expect((await postConsent(r, page, send, { origin: null })).status).toBe(403);
  });
  it('refuses a foreign Origin', async () => {
    r = await consentRig();
    const u1 = await pairModule(r.h, 'u1');
    modules.push(u1);
    const page = await openConsent(r);
    const res = await postConsent(r, page, send, { origin: 'https://evil.example' });
    expect(res.status).toBe(403);
    await new Promise((x) => setTimeout(x, 50));
    expect(u1.tc.messages.filter((m) => m.type === 'consentCode')).toHaveLength(0);
  });
});

describe('headers, Host and secrets', () => {
  it('sets the anti-framing headers on every consent response', async () => {
    r = await consentRig();
    const page = await openConsent(r);
    const replies = [
      page.reply,
      await postConsent(r, page, { action: 'send', world: 'w1', user: 'u1', scope: 'read' }),
      await postConsent(r, page, { action: 'verify', code: 'x' }),
      await postConsent(r, page, {}, { origin: null }),
    ];
    const csp = (origin = '') =>
      `default-src 'none'; style-src 'self'; form-action 'self'${origin}; frame-ancestors 'none'; base-uri 'none'`;
    // The three pages that can lead to the 302 name the registered redirect origin; the 403 does not.
    const withRedirect = new Set(replies.slice(0, 3));
    for (const rep of replies) {
      expect(rep.headers['x-frame-options']).toBe('DENY');
      expect(rep.headers['content-security-policy']).toBe(
        csp(withRedirect.has(rep) ? ` ${new URL(REDIRECT).origin}` : ''),
      );
      // Guards the Chrome `Origin: null` regression: `no-referrer` makes the same-origin POST fail the strict Origin check.
      expect(rep.headers['referrer-policy']).toBe('same-origin');
      expect(rep.headers['cache-control']).toBe('no-store');
      expect(rep.body).not.toMatch(/<script|<link|src=/i);
    }
    expect(String(page.reply.headers['set-cookie'])).toMatch(
      /^__Host-agcsrf-[0-9a-f]{32}=.*Secure; HttpOnly; SameSite=Strict; Path=\/$|Path=\//,
    );
  });

  it('puts the same headers on the 405, 413 and 429 JSON answers of the consent route', async () => {
    r = await consentRig();
    const expectSecured = (rep: { headers: Record<string, unknown> }): void => {
      expect(rep.headers['x-frame-options']).toBe('DENY');
      expect(rep.headers['referrer-policy']).toBe('same-origin');
      expect(rep.headers['content-security-policy']).toContain("frame-ancestors 'none'");
      expect(rep.headers['cache-control']).toBe('no-store');
    };
    const get = await call(r.port, 'GET', '/authorize/consent');
    expect(get.status).toBe(405);
    expectSecured(get);
    const big = await call(r.port, 'POST', '/authorize/consent', {
      body: 'x'.repeat(20_000),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(big.status).toBe(413);
    expectSecured(big);
    let limited: Awaited<ReturnType<typeof call>> | undefined;
    for (let i = 0; i < 40 && limited?.status !== 429; i++)
      limited = await call(r.port, 'POST', '/authorize/consent', { body: 'a=b' });
    expect(limited?.status).toBe(429);
    expectSecured(limited!);
  });

  it('writes no grant before approval: GET /authorize and the unapproved steps add no row', async () => {
    r = await consentRig();
    const u1 = await pairModule(r.h, 'u1');
    modules.push(u1);
    const db = new DatabaseSync(r.h.dbPath, { readOnly: true });
    const count = (): number =>
      (db.prepare('SELECT count(*) AS n FROM oauth_grants').get() as { n: number }).n;
    const page = await openConsent(r);
    expect(page.rid).not.toBe('');
    expect(count()).toBe(0);
    await postConsent(r, page, { action: 'send', world: 'w1', user: 'u1', scope: 'read' });
    await postConsent(r, page, { action: 'verify', code: 'wrong' });
    expect(count()).toBe(0);
    // A second GET with the live request id in the query changes nothing either.
    await call(r.port, 'GET', `/authorize?rid=${page.rid}&client_id=${page.clientId}`);
    expect(count()).toBe(0);
    db.close();
  });

  it('answers 403 on any Host but the public one, loopback included', async () => {
    r = await consentRig();
    const page = await openConsent(r);
    const get = await call(r.port, 'GET', '/authorize?client_id=x', { host: '127.0.0.1' });
    expect(get.status).toBe(403);
    expect(get.headers['x-frame-options']).toBe('DENY');
    const post = await postConsent(
      r,
      page,
      { action: 'send', world: 'w1', user: 'u1', scope: 'read' },
      { host: `127.0.0.1:${r.port}` },
    );
    expect(post.status).toBe(403);
  });

  it('never carries the live pairing code', async () => {
    r = await consentRig();
    const u1 = await pairModule(r.h, 'u1');
    modules.push(u1);
    const live = r.h.codes.generate();
    const page = await openConsent(r);
    const seen = [
      page.reply.body,
      String(page.reply.headers['set-cookie']),
      (await postConsent(r, page, { action: 'send', world: 'w1', user: 'u1', scope: 'read' })).body,
    ];
    const frame = JSON.stringify(await codeFrame(u1));
    const bad = await postConsent(r, page, { action: 'verify', code: 'x' });
    seen.push(bad.body, frame);
    const { code } = JSON.parse(frame) as { code: string };
    const done = await postConsent(r, page, { action: 'verify', code });
    seen.push(String(done.headers.location), done.body);
    for (const s of seen) expect(s).not.toContain(live);
    expect(live).toMatch(/-/);
  });

  it('escapes the client name and shows no typed text', async () => {
    r = await consentRig();
    const page = await openConsent(r, '<script>alert(1)</script>');
    expect(page.reply.body).not.toContain('<script>');
    expect(page.reply.body).toContain('&lt;script&gt;');
    const res = await postConsent(r, page, {
      action: 'send',
      world: '<script>w</script>',
      user: '<script>u</script>',
      scope: 'read',
    });
    expect(res.body).not.toContain('<script>');
    expect(res.body).not.toContain('&lt;script&gt;w');
    expect(PUBLIC).toBeTruthy();
  });
});
