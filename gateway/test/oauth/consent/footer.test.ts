import { afterEach, describe, expect, it } from 'vitest';
import { call } from '../helpers.js';
import { GITHUB_PATH } from '../../../src/oauth/consent/marks.js';
import { COOKIE_PREFIX } from '../../../src/oauth/consent/render.js';
import { consentRig, openConsent, postConsent, stopRig, type ConsentRig } from './rig.js';

let r: ConsentRig | undefined;
afterEach(async () => {
  await stopRig(r);
  r = undefined;
});

const PRIVACY = 'https://example.org/privacy?x=1';
const SOURCE = 'https://example.org/source';
const footerOf = (body: string): string => /<footer>[\s\S]*<\/footer>/.exec(body)?.[0] ?? '';

async function pages(rig: ConsentRig) {
  const page = await openConsent(rig);
  const code = await postConsent(rig, page, {
    action: 'send',
    world: 'w',
    user: 'u',
    scope: 'read',
  });
  const expired = await postConsent(rig, page, {}, { cookie: null });
  const forbidden = await postConsent(rig, page, {}, { origin: null });
  const unknown = await postConsent(rig, { ...page, rid: '0'.repeat(32) }, {});
  return [page.reply, code, expired, forbidden, unknown];
}

describe('consent footer', () => {
  it('ends every HTML page with exactly one footer after main; JSON has none', async () => {
    r = await consentRig();
    for (const p of await pages(r)) {
      if (!p.headers['content-type']?.includes('text/html')) {
        expect(p.body).not.toContain('<footer');
        continue;
      }
      expect(p.body.match(/<footer/g)).toHaveLength(1);
      expect(p.body.indexOf('<footer')).toBeGreaterThan(p.body.indexOf('</main>'));
    }
    const html = (await pages(r)).filter((p) => p.headers['content-type']?.includes('text/html'));
    expect(html.length).toBeGreaterThanOrEqual(4);
    const j = await call(r.port, 'POST', '/token', { body: '' });
    expect(j.body).not.toContain('<footer');
  });

  it('always names the cookie and its purpose', async () => {
    r = await consentRig();
    const f = footerOf((await openConsent(r)).reply.body);
    expect(f).toContain(COOKIE_PREFIX);
    expect(f).toContain('strictly necessary');
    expect(f).toContain('tracking');
  });

  it('shows the privacy link only when set', async () => {
    r = await consentRig({ privacyUrl: PRIVACY });
    const f = footerOf((await openConsent(r)).reply.body);
    expect(f).toContain(`<a href="${PRIVACY}" rel="noopener noreferrer">Privacy</a>`);
    await stopRig(r);
    r = await consentRig();
    expect((await openConsent(r)).reply.body).not.toContain('>Privacy<');
  });

  it('shows the source link with one decorative mark only when set', async () => {
    r = await consentRig({ sourceUrl: SOURCE });
    const f = footerOf((await openConsent(r)).reply.body);
    const a = /<a href="https:\/\/example\.org\/source"[^>]*>[\s\S]*?<\/a>/.exec(f)?.[0] ?? '';
    expect(a).toContain('rel="noopener noreferrer"');
    expect(a).toContain('aria-label="Source code on GitHub');
    expect(a).not.toMatch(/ascend/i);
    expect(a).toContain('Source code</span>');
    const svgs = a.match(/<svg[\s\S]*?<\/svg>/g) ?? [];
    expect(svgs).toHaveLength(1);
    for (const s of svgs) {
      expect(s).toContain('aria-hidden="true"');
      expect(s).toContain('focusable="false"');
      expect(s).toContain('fill="currentColor"');
      expect(s).not.toMatch(/style=|<style|<title|\sid=|href|<use/);
    }
    expect(svgs[0]).toContain(`d="${GITHUB_PATH}"`);
    await stopRig(r);
    r = await consentRig();
    const none = (await openConsent(r)).reply.body;
    expect(none).not.toContain('<svg');
    expect(none).not.toContain('Source code');
  });

  it('escapes both URLs it writes into href', async () => {
    const privacy = new URL('https://a"b.example/privacy').href;
    const source = new URL('https://c"d.example/source').href;
    expect(privacy).toContain('"');
    r = await consentRig({ privacyUrl: privacy, sourceUrl: source });
    const body = (await openConsent(r)).reply.body;
    expect(body).toContain('href="https://a&quot;b.example/privacy"');
    expect(body).toContain('href="https://c&quot;d.example/source"');
    expect(body).not.toContain('a"b.example');
    expect(body).not.toContain('c"d.example');
  });
});
