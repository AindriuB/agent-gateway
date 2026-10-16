import { describe, expect, it } from 'vitest';
import { renderRequestPage } from '../../../src/oauth/consent/render.js';
import { SCOPES, type Scope } from '../../../src/oauth/repository.js';

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
});
