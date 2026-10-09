// @vitest-environment happy-dom
import { Marked, type Token, type Tokens } from 'marked';
import { describe, expect, it } from 'vitest';
import { htmlToMarkdown } from '../../src/serialise/index.js';

const ALLOWED = new Set(['http:', 'https:', 'mailto:']);
const BASE = 'https://relative.invalid/';

/** Decode a href the way a browser sees it: DOM attribute value, then URL parsing. */
function allowed(href: string): boolean {
  try {
    const u = new URL(href, BASE);
    return u.origin === new URL(BASE).origin || ALLOWED.has(u.protocol);
  } catch {
    return false;
  }
}

function walk(tokens: Token[], out: Token[]): void {
  for (const t of tokens) {
    if (t.type === 'link' || t.type === 'image') out.push(t);
    const c = t as {
      tokens?: Token[];
      items?: Token[];
      header?: { tokens: Token[] }[];
      rows?: { tokens: Token[] }[][];
    };
    if (c.tokens) walk(c.tokens, out);
    if (c.items) walk(c.items, out);
    if (c.header) for (const h of c.header) walk(h.tokens, out);
    if (c.rows) for (const r of c.rows) for (const cell of r) walk(cell.tokens, out);
  }
}

/** Parse markdown with marked and return every link/image it finds. */
function linksOf(md: string): Tokens.Link[] {
  const out: Token[] = [];
  walk(new Marked({ gfm: true, tokenizer: { url: () => undefined } }).lexer(md), out);
  // CommonMark decodes entities and backslash escapes in link targets; do so for any marked left raw.
  const ta = document.createElement('textarea');
  return (out as Tokens.Link[]).map((l) => {
    ta.innerHTML = l.href.replace(/</g, '&lt;');
    return { ...l, href: ta.value.replace(/\\([!-/:-@[-`{-~])/g, '$1') };
  });
}

/** Hrefs of real anchors in the input, as the browser's DOM reports them. */
function anchorsOf(html: string): string[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return Array.from(doc.querySelectorAll('a[href]')).map((a) => a.getAttribute('href')!);
}

function check(html: string): void {
  const md = htmlToMarkdown(html);
  const found = linksOf(md);
  const anchors = anchorsOf(html);
  const hasImg = /<img\b/i.test(html);
  for (const l of found) {
    expect(l.type, `image from ${JSON.stringify(html)} => ${JSON.stringify(md)}`).toBe('link');
    expect(hasImg).toBe(false);
    // Must be a real anchor in the input with an allowed scheme, and the same target.
    const norm = (h: string) => {
      const u = new URL(h, BASE).href;
      try {
        return decodeURIComponent(u);
      } catch {
        return u;
      }
    };
    const match = anchors.some((a) => allowed(a) && norm(a) === norm(l.href));
    expect(match, `link ${l.href} from ${JSON.stringify(html)} => ${JSON.stringify(md)}`).toBe(
      true,
    );
    expect(allowed(l.href), `link ${l.href}`).toBe(true);
  }
  // Never more links than anchors the author wrote.
  expect(found.length).toBeLessThanOrEqual(anchors.length);
}

const PROBES = [
  '<a href="javascript\\:alert(1)">x</a>',
  '<a href="&amp;#106;avascript:alert(1)">x</a>',
  '<a href="&amp;#x6A;avascript:alert(1)">x</a>',
  '<a href="http://good.example/\\">a</a>@evil.example/p',
  '<a href="http://good.example/\\">a</a> @evil.example/p)',
  '<p>[x](javascript:1)</p>',
  `${'<div>'.repeat(120)}[x](javascript:1)${'</div>'.repeat(120)}`,
  `${'<div>'.repeat(120)}<a href="javascript:1">x</a>[y](javascript:2)${'</div>'.repeat(120)}`,
  '!<a href="http://a.example/p">img</a>',
  '<b>!</b><a href="http://a.example/p">img</a>',
  '<a href="javascript:alert(1)">x</a>',
  '<a href=" jav&#x09;ascript:alert(1)">x</a>',
  '<a href="data:text/html,x">x</a>',
  '<a href="vbscript:x">x</a>',
  '<a href="//evil.example/p">x</a>',
  '<a href="http://a.example/a)b(c">x</a>',
  '<a href="http://a.example/<x>">x</a>',
  '<a href="http://a.example/a b">x [y] z</a>',
  '<a href="mailto:a@b.c">m</a>',
  '<a href="/rel/x\\y">r</a>',
  '<a href="#frag">f</a>',
  '<a href="&colon;">x</a>',
  '<a href="java&Tab;script&colon;1">x</a>',
  '<p>![alt](http://evil.example/i.png)</p>',
  '<img src="http://evil.example/i.png" alt="a">',
  '<a href="http://a.example">[x](http://evil.example)</a>',
  '<a href="http://a.example">](http://evil.example) [</a>',
  '<table><tr><td>[x](javascript:1)</td></tr></table>',
  '<table><tr><td><table><tr><td><a href="javascript:1">q</a>[x](javascript:2)</td></tr></table></td></tr></table>',
  '<p>@UUID[x](javascript:1)</p>',
  '<p>@UUID[a]{[b](javascript:1)}</p>',
];

describe('markdown serialiser oracle (marked)', () => {
  it.each(PROBES.map((p) => [p.slice(0, 70), p] as const))('probe: %s', (_n, html) => {
    check(html);
  });

  it('holds for generated combinations', () => {
    const schemes = [
      'http:',
      'https:',
      'mailto:',
      'javascript:',
      'data:',
      'vbscript:',
      '',
      '//',
      'JaVa\tScript:',
    ];
    const tails = [
      'a.example/p',
      'x(1)',
      'a)b',
      '\\',
      '\\:',
      '&amp;#106;',
      '&#106;avascript:1',
      '<z>',
      'a b',
      '[q]',
      '%28',
      '',
    ];
    const wrappers = [
      (s: string) => s,
      (s: string) => `!${s}`,
      (s: string) => `[${s}](javascript:1)`,
      (s: string) => `<b>${s}</b>`,
      (s: string) => `${'<i>'.repeat(110)}${s}${'</i>'.repeat(110)}`,
    ];
    const texts = ['x', '[x]', '](y)', '!', '[x](javascript:1)', '&#91;x&#93;(javascript:1)', '\\'];
    let n = 0;
    for (const sc of schemes)
      for (const tl of tails)
        for (const tx of texts)
          for (const w of wrappers) {
            check(w(`<a href="${sc}${tl}">${tx}</a>@evil.example/p [z](javascript:3)`));
            n++;
          }
    expect(n).toBeGreaterThan(1000);
  });
});
