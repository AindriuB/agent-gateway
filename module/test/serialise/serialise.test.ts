// @vitest-environment happy-dom
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, describe, expect, it } from 'vitest';
import {
  domToMarkdown,
  htmlToMarkdown,
  page,
  serialiseDocument,
  SERIALISE_CONFIG,
} from '../../src/serialise/index.js';
import { installFoundry, type FoundryStub } from '../stubs/foundry.js';

let stub: FoundryStub;
afterEach(() => stub?.uninstall());

const doc = {
  name: 'Bob',
  flags: { core: { a: 1 }, dnd5e: { b: 2 }, 'agent-gateway': { c: 3 }, other: { d: 4 } },
};

function setup(optIn: boolean) {
  stub = installFoundry(14);
  (globalThis as any).game.system = { id: 'dnd5e' };
  stub.registeredSettings.set('agent-gateway.includeOtherModuleData', {
    name: '',
    scope: 'world',
    config: true,
    type: Boolean,
    default: optIn,
  });
}

describe('serialiseDocument', () => {
  it('strips other modules flags by default', () => {
    setup(false);
    const out = serialiseDocument({ toObject: () => doc }, { includeOtherModuleData: false });
    expect(Object.keys(out.flags as object).sort()).toEqual(['agent-gateway', 'core', 'dnd5e']);
    expect(serialiseDocument(doc)).toEqual(out);
  });
  it('keeps everything when GM opted in', () => {
    setup(true);
    const out = serialiseDocument(doc, { includeOtherModuleData: true });
    expect(Object.keys(out.flags as object)).toContain('other');
    expect(Object.keys(serialiseDocument(doc).flags as object)).toContain('other');
  });
  it('does not mutate the source', () => {
    setup(false);
    serialiseDocument(doc, { includeOtherModuleData: false });
    expect(doc.flags.other).toBeDefined();
  });
});

describe('htmlToMarkdown', () => {
  it('headings, emphasis, links', () => {
    expect(
      htmlToMarkdown(
        '<h2>Title</h2><p>A <strong>bold</strong> and <em>it</em> <a href="http://x.y">link</a>.</p>',
      ),
    ).toBe('## Title\n\nA **bold** and *it* [link](http://x.y/).');
  });
  it('lists', () => {
    expect(htmlToMarkdown('<ul><li>one</li><li>two</li></ul><ol><li>a</li><li>b</li></ol>')).toBe(
      '- one\n- two\n\n1. a\n2. b',
    );
  });
  it('tables', () => {
    expect(
      htmlToMarkdown('<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>'),
    ).toBe('| A | B |\n| --- | --- |\n| 1 | 2 |');
  });
  it('UUID enrichers keep label and uuid', () => {
    expect(htmlToMarkdown('<p>See @UUID[Actor.abc123]{Goblin} and @UUID[Item.xyz]</p>')).toBe(
      'See Goblin (Actor.abc123) and Item.xyz (Item.xyz)',
    );
  });
  it('decodes entities and strips unknown tags', () => {
    expect(htmlToMarkdown('<span>a &amp; b</span>')).toBe('a & b');
  });
  it('drops script, style, template and noscript content', () => {
    const out = htmlToMarkdown(
      '<script>alert(1)</script><style>p{x:y}</style><template>tpl</template><noscript>ns</noscript><p>hi</p>',
    );
    expect(out).toBe('hi');
  });
  it('keeps a literal < in text', () => {
    expect(htmlToMarkdown('<p>a < b and c > d</p>')).toBe('a < b and c > d');
  });
  it('keeps single-quoted and unquoted hrefs', () => {
    expect(htmlToMarkdown("<a href='http://a.example/x'>one</a>")).toBe(
      '[one](http://a.example/x)',
    );
    expect(htmlToMarkdown('<a href=http://b.example/y>two</a>')).toBe('[two](http://b.example/y)');
  });
  // [name, input builder, small n, large n (4x), min baseline ms, max allowed 4x ratio]
  // Linear code gives a ratio near 4; quadratic gives near 16. Table inputs that
  // exercise our flattener are timed on a pre-parsed DOM in the next test.
  it.each([
    ['unclosed anchors', (n: number) => '<a href="'.repeat(n), 8000, 32000, 5, 8],
    ['unclosed bold', (n: number) => '<b>'.repeat(n), 8000, 32000, 20, 8],
    ['unclosed UUIDs', (n: number) => '@UUID['.repeat(n), 32000, 128000, 2, 8],
  ] as const)('adversarial input (%s) scales sub-quadratically', (_n, make, ns, nl, floor, max) => {
    const time = (n: number) => {
      const t = performance.now();
      htmlToMarkdown(make(n));
      return performance.now() - t;
    };
    time(500); // warm up
    const small = Math.max(time(ns), floor);
    const large = time(nl);
    expect(large).toBeLessThan(5000);
    expect(large).toBeLessThan(small * max);
  });
  // Parsed outside the timed region so only our walker is measured.
  const nested = (n: number) =>
    '<table><tr><td>x'.repeat(n) + 'leaf' + '</td></tr></table>'.repeat(n);
  const wide = (n: number) =>
    '<table><tr><td>o<table>' +
    '<tr><td>k</td><td>v</td></tr>'.repeat(n) +
    '</table></td></tr></table>';
  it.each([
    ['deeply nested tables', nested, 2000, 8000],
    ['wide nested table', wide, 5000, 20000],
  ] as const)('flattening %s scales sub-quadratically', (_n, make, ns, nl) => {
    const body = (n: number) => new DOMParser().parseFromString(make(n), 'text/html').body;
    const time = (n: number) => {
      const b = body(n);
      const t = performance.now();
      domToMarkdown(b);
      return performance.now() - t;
    };
    time(200); // warm up
    const small = Math.max(time(ns), 3);
    const large = time(nl);
    expect(large).toBeLessThan(3000);
    expect(large).toBeLessThan(small * 8);
  });
  it('renders nested tables linearly, inner content once', () => {
    expect(
      htmlToMarkdown(
        '<table><tr><td>a<table><tr><td>inner</td></tr></table></td></tr></table>',
      ).split('inner').length - 1,
    ).toBe(1);
    const deep = (n: number) =>
      '<table><tr><td>x'.repeat(n) + 'leaf' + '</td></tr></table>'.repeat(n);
    const t = performance.now();
    const out = htmlToMarkdown(deep(25));
    expect(performance.now() - t).toBeLessThan(2000);
    expect(out.length).toBeLessThan(deep(25).length);
    expect(out.split('leaf').length - 1).toBe(1);
  });
  it('separates flattened nested table cells and rows', () => {
    expect(
      htmlToMarkdown('<table><tr><td>a<table><tr><td>inner</td></tr></table></td></tr></table>'),
    ).toBe('| a \\[inner\\] |\n| --- |');
    const out = htmlToMarkdown(
      '<table><tr><td>Stats<table><tr><td>Str</td><td>18</td><td>+4</td></tr><tr><td>Dex</td><td>12</td><td>+1</td></tr></table></td></tr></table>',
    );
    expect(out).toContain('Str / 18 / +4; Dex / 12 / +1');
  });
  it('pads nested tables at every depth', () => {
    const t = (inner: string) => `<table><tr><td>${inner}</td></tr></table>`;
    expect(
      htmlToMarkdown(
        '<table><tr><td>x<table><tr><td>a<table><tr><td>b</td><td>c</td></tr></table></td><td>d</td></tr></table></td></tr></table>',
      ),
    ).toBe('| x \\[a \\[b / c\\] / d\\] |\n| --- |');
    expect(htmlToMarkdown(t('p' + t('q' + t('r'))))).toBe('| p \\[q \\[r\\]\\] |\n| --- |');
    const five = t('a' + t('b' + t('c' + t('d' + t('e')))));
    expect(htmlToMarkdown(five)).toBe('| a \\[b \\[c \\[d \\[e\\]\\]\\]\\] |\n| --- |');
  });
  it('keeps literal separators in cell text', () => {
    const out = htmlToMarkdown(
      '<table><tr><td>x<table><tr><td>See p. 12;</td><td>;;</td><td>a/</td></tr></table></td></tr></table>',
    );
    expect(out).toContain('See p. 12; / ;; / a/');
  });
  it('expands UUIDs inside flattened nested tables', () => {
    expect(
      htmlToMarkdown(
        '<table><tr><td>x<table><tr><td>@UUID[Actor.q]{Q}</td></tr></table></td></tr></table>',
      ),
    ).toContain('Q (Actor.q)');
  });
  it('keeps whitespace between inline siblings under body', () => {
    expect(htmlToMarkdown('<strong>Name:</strong> <em>Bob</em>')).toBe('**Name:** *Bob*');
    expect(
      htmlToMarkdown('<a href="http://a.example">one</a> <a href="http://b.example">two</a>'),
    ).toBe('[one](http://a.example/) [two](http://b.example/)');
  });
  it('blocks obfuscated script schemes in hrefs', () => {
    expect(htmlToMarkdown('<a href="java&#x09;script:alert(1)">x</a>')).toBe('x');
    expect(htmlToMarkdown('<a href=" JavaScript:alert(1)">y</a>')).toBe('y');
  });
  it('allows only http, https, mailto and relative link targets', () => {
    for (const bad of ['file:///etc/passwd', 'ftp://h/x', 'custom-app:open', 'FILE:///x'])
      expect(htmlToMarkdown(`<a href="${bad}">t</a>`)).toBe('t');
    expect(htmlToMarkdown('<a href="mailto:a@b.c">m</a>')).toBe('[m](mailto:a@b.c)');
    expect(htmlToMarkdown('<a href="HTTPS://e.example">h</a>')).toBe('[h](https://e.example/)');
    expect(htmlToMarkdown('<a href="/rel/x">r</a>')).toBe('[r](/rel/x)');
    expect(htmlToMarkdown('<a href="#frag">f</a>')).toBe('[f](#frag)');
  });
  it('keeps hostile characters inside one link target', () => {
    expect(htmlToMarkdown('<a href="https://e.example/a)b">e</a>')).toBe(
      '[e](https://e.example/a%29b)',
    );
    expect(htmlToMarkdown('<a href="https://e.example/a b(c)<d>">e</a>')).toBe(
      '[e](https://e.example/a%20b%28c%29%3Cd%3E)',
    );
  });
  it('escapes markdown syntax in text so only real anchors are links', () => {
    expect(htmlToMarkdown('<p>[x](javascript:1)</p>')).toBe('\\[x\\](javascript:1)');
    expect(htmlToMarkdown('<p>a *b* _c_ `d` <i>e</i> \\</p>')).toBe(
      'a \\*b\\* \\_c\\_ \\`d\\` *e* \\\\',
    );
    expect(htmlToMarkdown('<table><tr><td>[x](file:///y)</td></tr></table>')).toBe(
      '| \\[x\\](file:///y) |\n| --- |',
    );
    expect(htmlToMarkdown('<p>&lt;script&gt;x&lt;/script&gt;</p>')).toBe('\\<script>x\\</script>');
    expect(htmlToMarkdown('<p>[<a href="http://a.example">z</a>](q)</p>')).toBe(
      '\\[[z](http://a.example/)\\](q)',
    );
  });
});

describe('page', () => {
  it('pages with nextCursor', () => {
    const a = page('abcdefg', undefined, 3);
    expect(a).toEqual({ chunk: 'abc', nextCursor: '3' });
    const b = page('abcdefg', a.nextCursor, 3);
    expect(b).toEqual({ chunk: 'def', nextCursor: '6' });
    expect(page('abcdefg', b.nextCursor, 3)).toEqual({ chunk: 'g', nextCursor: null });
  });
  it('uses the configured default size', () => {
    const text = 'x'.repeat(SERIALISE_CONFIG.defaultPageSize + 5);
    expect(page(text).chunk.length).toBe(SERIALISE_CONFIG.defaultPageSize);
    expect(page(text).nextCursor).not.toBeNull();
  });
  it('tolerates a junk cursor', () => {
    expect(page('abc', 'zzz', 2).chunk).toBe('ab');
  });
});
