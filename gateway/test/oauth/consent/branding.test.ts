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

const PRIVACY = 'https://example.org/privacy?x=1';
const SOURCE = 'https://example.org/source';

const LINK_SETS: [string, { privacyUrl?: string; sourceUrl?: string }][] = [
  ['neither URL set', {}],
  ['both URLs set', { privacyUrl: PRIVACY, sourceUrl: SOURCE }],
];

describe('consent styling', () => {
  it.each(LINK_SETS)(
    'every consent page links only the same-origin stylesheet (%s)',
    async (_n, links) => {
      r = await consentRig(links);
      const both = 'sourceUrl' in links;
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
        expect(p.body).not.toMatch(/<style|style=|<img|<script|\ssrc=|url\(|<use|xlink:/i);
        const foot = /<footer[\s\S]*<\/footer>/.exec(p.body)?.[0] ?? '';
        const outside = p.body.replace(foot, '');
        expect(outside).not.toMatch(/<svg|ascend/i);
        const hrefs = [...p.body.matchAll(/\bhref="([^"]*)"/gi)]
          .map((m) => m[1]!)
          .filter((h) => /^[a-z]+:\/\//i.test(h));
        if (!both) {
          expect(hrefs).toEqual([]);
          expect(p.body).not.toMatch(/<svg|ascend/i);
        } else {
          expect(hrefs.sort()).toEqual([PRIVACY, SOURCE].sort());
          const inFoot = [...foot.matchAll(/\bhref="(https?:\/\/[^"]*)"/gi)].map((m) => m[1]!);
          expect(inFoot.sort()).toEqual([PRIVACY, SOURCE].sort());
          expect(foot.match(/<svg/g)).toHaveLength(2);
          expect(p.body.match(/<svg/g)).toHaveLength(2);
          expect(foot).toMatch(/<svg/);
        }
      }
    },
  );

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

  it.each(LINK_SETS)(
    'keeps the CSP exactly as specified on every consent response (%s)',
    async (_n, links) => {
      r = await consentRig(links);
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
    },
  );

  it.each(LINK_SETS)(
    'step-1 responses stay byte-identical across users (%s)',
    async (_n, links) => {
      r = await consentRig(links);
      const u1 = await pairModule(r.h, 'u1');
      modules.push(u1);
      const bodies: string[] = [];
      for (const user of ['u1', 'nobody']) {
        const page = await openConsent(r);
        const res = await postConsent(r, page, {
          action: 'send',
          world: 'w1',
          user,
          scope: 'read',
        });
        bodies.push(res.body.replaceAll(page.rid, 'RID').replaceAll(page.csrf, 'CSRF'));
      }
      expect(bodies[1]).toBe(bodies[0]);
    },
  );
});
