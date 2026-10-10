// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { htmlToMarkdown, inlineText, stripSecrets } from '../../src/serialise/index.js';
import { HOSTILE_NAMES, expectInertSpan } from '../stubs/inert.js';

describe('inlineText', () => {
  it.each(HOSTILE_NAMES)('is an inert single-line span: %j', (name) => {
    const out = inlineText(name);
    expect(out).not.toMatch(/\n/);
    expectInertSpan(`Name: ${out}`);
    expectInertSpan(out);
  });
  it('collapses newlines and whitespace', () => {
    expect(inlineText('  a \n\n b\t c ')).toBe('a b c');
  });
  it('keeps ordinary names readable', () => {
    expect(inlineText("Bob's Tavern (2nd floor)")).toBe("Bob's Tavern (2nd floor)");
  });
});

describe('stripSecrets', () => {
  const dom = (html: string) => {
    const d = new DOMParser().parseFromString(html, 'text/html');
    return d.body;
  };
  it('removes any element whose class list contains secret, with its subtree', () => {
    const body = dom(
      '<p>pub</p><section class="secret"><p>hidden</p></section><div class="x secret y">gone</div><p class="secretive">keep</p>',
    );
    stripSecrets(body);
    const md = htmlToMarkdown(body.innerHTML);
    expect(md).toContain('pub');
    expect(md).toContain('keep');
    expect(md).not.toContain('hidden');
    expect(md).not.toContain('gone');
  });
  it('removes nested secrets', () => {
    const body = dom(
      '<div><section class="secret"><div class="secret">inner</div>outer</section><ul><li>a</li><li class="secret">b</li></ul></div>',
    );
    stripSecrets(body);
    const md = htmlToMarkdown(body.innerHTML);
    expect(md).not.toMatch(/inner|outer|\bb\b/);
    expect(md).toContain('a');
  });
  it('ignores a non-element root', () => {
    expect(() => stripSecrets(document.createTextNode('x'))).not.toThrow();
  });
});
