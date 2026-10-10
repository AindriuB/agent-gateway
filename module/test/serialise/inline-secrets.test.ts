// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import {
  escapeMd,
  htmlToMarkdown,
  inlineText,
  stripMarkers,
  stripSecrets,
} from '../../src/serialise/index.js';
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
  it('accepts any value', () => {
    expect(inlineText(undefined)).toBe('');
    expect(inlineText(null)).toBe('');
    expect(inlineText(42)).toBe('42');
    expect(inlineText({ toString: () => 'obj' })).toBe('obj');
    expect(inlineText(Object.create(null))).toBe('');
    expect(inlineText(Symbol('s'))).toBe('Symbol(s)');
  });
  it('caps long text at 200 characters with an ellipsis', () => {
    const out = inlineText('a'.repeat(500));
    expect(out).toBe(`${'a'.repeat(200)}...`);
    expect(inlineText('b'.repeat(600), 500)).toBe(`${'b'.repeat(500)}...`);
  });
  it('is a superset of the compendium helper: same output once the extra escapes are removed', () => {
    const reference = (value: unknown, cap = 200) => {
      const text = stripMarkers(String(value ?? ''))
        .replace(/\s+/g, ' ')
        .trim();
      return escapeMd(text.length > cap ? `${text.slice(0, cap)}...` : text);
    };
    for (const sample of [
      'Goblin',
      "Bob's *Tavern* [2]",
      'a\n\nb  c',
      'x'.repeat(300),
      'A_B <i> & `c` | d',
      'www.x.org',
      'me@x.org',
      'http://x.org',
      42,
    ]) {
      const mine = inlineText(sample).replace(/\\([:.@])/g, '$1');
      expect(mine).toBe(reference(sample));
    }
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
