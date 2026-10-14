import { afterEach, describe, expect, it } from 'vitest';
import { REDIRECT, call } from '../helpers.js';
import { pairModule, type FakeModule } from '../../routing/harness.js';
import { CONSENT_STYLE_PATH } from '../../../src/oauth/index.js';
import { consentRig, openConsent, postConsent, stopRig, type ConsentRig } from './rig.js';

let r: ConsentRig | undefined;
const modules: FakeModule[] = [];
afterEach(async () => {
  modules.splice(0).forEach((m) => m.tc.ws.terminate());
  await stopRig(r);
  r = undefined;
});

const csp = (origin = ''): string =>
  `default-src 'none'; style-src 'self'; form-action 'self'${origin}; frame-ancestors 'none'; base-uri 'none'`;

describe('consent styling', () => {
  it('every consent page links only the same-origin stylesheet and nothing external', async () => {
    r = await consentRig();
    const u1 = await pairModule(r.h, 'u1');
    modules.push(u1);
    const page = await openConsent(r);
    const pages = [
      page.reply,
      await postConsent(r, page, { action: 'send', world: 'w1', user: 'u1', scope: [] }),
      await postConsent(r, page, { action: 'send', world: 'w1', user: 'u1', scope: 'read' }),
      await postConsent(r, page, { action: 'verify', code: 'x' }),
      await postConsent(r, page, {}, { origin: null }),
    ];
    for (const p of pages) {
      expect(p.headers['content-type']).toContain('text/html');
      const links = [...p.body.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]);
      expect(links).toEqual([`<link rel="stylesheet" href="${CONSENT_STYLE_PATH}">`]);
      expect(p.body).not.toMatch(/<style|style=|<img|<svg|<script/i);
      const urls = [...p.body.matchAll(/\b(?:src|href)="([^"]*)"|url\(([^)]*)\)/gi)];
      for (const m of urls) expect(m[1] ?? m[2]).not.toMatch(/^[a-z]+:\/\//i);
      expect(p.body).not.toMatch(/ascend/i);
    }
  });

  it('serves a static same-origin stylesheet with the consent headers', async () => {
    r = await consentRig();
    const a = await call(r.port, 'GET', CONSENT_STYLE_PATH);
    const b = await call(r.port, 'GET', CONSENT_STYLE_PATH);
    expect(a.status).toBe(200);
    expect(a.headers['content-type']).toContain('text/css');
    expect(a.headers['x-frame-options']).toBe('DENY');
    expect(a.headers['referrer-policy']).toBe('same-origin');
    expect(a.headers['cache-control']).toBe('no-store');
    expect(a.headers['content-security-policy']).toBe(csp());
    expect(b.body).toBe(a.body);
    const dark = /@media \(prefers-color-scheme: dark\)\s*\{[^@]*--background:\s*#0B1220/.exec(
      a.body,
    );
    expect(dark).not.toBeNull();
    expect(a.body.split('@media')[0]).toContain('--background: #F8FAFC');
    expect(a.body).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    expect(a.body).not.toMatch(/https?:\/\/|@import|@font-face|url\(/i);
    expect(a.body).not.toMatch(/ascend/i);
  });

  it('answers 403 for the stylesheet on a non-public Host', async () => {
    r = await consentRig();
    const res = await call(r.port, 'GET', CONSENT_STYLE_PATH, { host: `127.0.0.1:${r.port}` });
    expect(res.status).toBe(403);
    expect(res.headers['x-frame-options']).toBe('DENY');
  });

  it('keeps the CSP exactly as specified on every consent response', async () => {
    r = await consentRig();
    const page = await openConsent(r);
    const origin = ` ${new URL(REDIRECT).origin}`;
    expect(page.reply.headers['content-security-policy']).toBe(csp(origin));
    const send = await postConsent(r, page, {
      action: 'send',
      world: 'w',
      user: 'u',
      scope: 'read',
    });
    expect(send.headers['content-security-policy']).toBe(csp(origin));
    const bad = await postConsent(r, page, {}, { origin: null });
    expect(bad.headers['content-security-policy']).toBe(csp());
  });

  it('step-1 responses stay byte-identical across users', async () => {
    r = await consentRig();
    const u1 = await pairModule(r.h, 'u1');
    modules.push(u1);
    const bodies: string[] = [];
    for (const user of ['u1', 'nobody']) {
      const page = await openConsent(r);
      const res = await postConsent(r, page, { action: 'send', world: 'w1', user, scope: 'read' });
      bodies.push(res.body.replaceAll(page.rid, 'RID').replaceAll(page.csrf, 'CSRF'));
    }
    expect(bodies[1]).toBe(bodies[0]);
  });
});
