import { afterEach, describe, expect, it } from 'vitest';
import { renderRequestPage } from '../../../src/oauth/consent/render.js';
import { SCOPES, type Scope } from '../../../src/oauth/repository.js';
import { CODE_SENT_TEXT } from '../../../src/oauth/index.js';
import { consentRig, openConsent, postConsent, stopRig, type ConsentRig } from './rig.js';

let r: ConsentRig | undefined;
afterEach(async () => {
  await stopRig(r);
  r = undefined;
});

const page = (scopes: readonly Scope[]): string =>
  renderRequestPage({ rid: 'r', csrf: 'c', clientName: 'Claude', scopes, links: {} });

const input = (html: string, scope: string): string => {
  const m = new RegExp(`<input type="checkbox" name="scope" value="${scope}"[^>]*>`).exec(html);
  expect(m, `box for ${scope}`).not.toBeNull();
  return m![0];
};

describe('consent scope defaults', () => {
  it('ticks read and write but not destructive or code', () => {
    const html = page(SCOPES);
    expect(input(html, 'read')).toContain(' checked');
    expect(input(html, 'write')).toContain(' checked');
    expect(input(html, 'destructive')).not.toContain('checked');
    expect(input(html, 'code')).not.toContain('checked');
  });

  it('renders destructive and code unticked when only they are requested', () => {
    const html = page(['destructive', 'code']);
    expect(input(html, 'destructive')).not.toContain('checked');
    expect(input(html, 'code')).not.toContain('checked');
    expect(html).toContain('<form method="post" action="/authorize/consent"');
    expect(html).toContain('type="submit"');
  });

  it('posting the defaults for a destructive+code request asks for a permission', async () => {
    r = await consentRig();
    const page = await openConsent(r, 'C', 'destructive code');
    const none = await postConsent(r, page, { action: 'send', world: 'w1', user: 'u1' });
    expect(none.status).toBe(200);
    expect(none.body).toContain('Choose at least one permission.');
    expect(none.body).not.toContain(CODE_SENT_TEXT);
    const some = await postConsent(r, page, {
      action: 'send',
      world: 'w1',
      user: 'u1',
      scope: 'destructive',
    });
    expect(some.status).toBe(200);
    expect(some.body).toContain(CODE_SENT_TEXT);
  });
});
