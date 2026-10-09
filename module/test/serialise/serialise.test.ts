// @vitest-environment happy-dom
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, describe, expect, it } from 'vitest';
import {
  domToMarkdown,
  htmlToDocument,
  htmlToMarkdown,
  page,
  PageCursorError,
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
  const nested = () => ({
    _id: 'a1',
    flags: { core: { k: 1 }, other: { secret: 1 } },
    system: { flags: { other: 'keep' } },
    items: [
      {
        _id: 'i1',
        flags: { other: { secret: 2 }, dnd5e: { ok: 1 } },
        effects: [{ _id: 'e1', flags: { other: { secret: 3 }, 'agent-gateway': { ok: 1 } } }],
      },
    ],
    tokens: [{ _id: 't1', flags: { other: { secret: 4 }, core: { ok: 1 } } }],
    pages: [{ _id: 'p1', flags: { other: { secret: 5 } } }],
  });
  it('filters flags on embedded documents', () => {
    setup(false);
    const out = serialiseDocument(nested(), { includeOtherModuleData: false }) as any;
    expect(Object.keys(out.items[0].flags)).toEqual(['dnd5e']);
    expect(Object.keys(out.items[0].effects[0].flags)).toEqual(['agent-gateway']);
    expect(Object.keys(out.tokens[0].flags)).toEqual(['core']);
    expect(out.pages[0].flags).toEqual({});
    expect(JSON.stringify(out)).not.toContain('secret');
    expect(out.system.flags).toEqual({ other: 'keep' });
  });
  it('filters prototypeToken flags (no _id) but not system flags', () => {
    setup(false);
    const out = serialiseDocument(
      {
        _id: 'a1',
        flags: {},
        prototypeToken: { flags: { other: { secret: 1 }, core: { ok: 1 } } },
        system: {
          flags: { other: 'keep' },
          deep: { list: [{ _id: 'x', flags: { other: 'keep2' } }] },
        },
      },
      { includeOtherModuleData: false },
    ) as any;
    expect(Object.keys(out.prototypeToken.flags)).toEqual(['core']);
    expect(out.system.flags).toEqual({ other: 'keep' });
    expect(out.system.deep.list[0].flags).toEqual({ other: 'keep2' });
    expect(JSON.stringify(out)).not.toContain('secret');
  });
  it('keeps prototypeToken flags when opted in', () => {
    setup(true);
    const out = serialiseDocument(
      { prototypeToken: { flags: { other: { secret: 1 } } } },
      { includeOtherModuleData: true },
    ) as any;
    expect(out.prototypeToken.flags.other).toBeDefined();
  });
  it('keeps embedded flags when opted in', () => {
    setup(true);
    const out = serialiseDocument(nested(), { includeOtherModuleData: true }) as any;
    expect(out.items[0].effects[0].flags.other).toBeDefined();
    expect(out.tokens[0].flags.other).toBeDefined();
  });
  it('filters deeply nested embedded documents without overflowing', () => {
    setup(false);
    let node: any = { _id: 'leaf', flags: { other: { secret: 1 } } };
    for (let i = 0; i < 1500; i++) node = { _id: `n${i}`, flags: { other: 1 }, child: [node] };
    const out = serialiseDocument(
      { toObject: () => node },
      { includeOtherModuleData: false },
    ) as any;
    let cur = out;
    let depth = 0;
    while (cur.child) {
      expect(cur.flags).toEqual({});
      cur = cur.child[0];
      depth++;
    }
    expect(depth).toBe(1500);
    expect(cur.flags).toEqual({});
  });
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
    expect(htmlToMarkdown('<span>a &amp; b</span>')).toBe('a \\& b');
  });
  it('drops script, style, template and noscript content', () => {
    const out = htmlToMarkdown(
      '<script>alert(1)</script><style>p{x:y}</style><template>tpl</template><noscript>ns</noscript><p>hi</p>',
    );
    expect(out).toBe('hi');
  });
  it('keeps a literal < in text', () => {
    expect(htmlToMarkdown('<p>a < b and c > d</p>')).toBe('a \\< b and c > d');
  });
  it('keeps single-quoted and unquoted hrefs', () => {
    expect(htmlToMarkdown("<a href='http://a.example/x'>one</a>")).toBe(
      '[one](http://a.example/x)',
    );
    expect(htmlToMarkdown('<a href=http://b.example/y>two</a>')).toBe('[two](http://b.example/y)');
  });
  // Minimum of several runs per size: background CPU load only ever adds time,
  // so the minimum is the least noisy estimate of the true cost.
  const RUNS = 7;
  const minTime = (run: () => number) => Math.min(...Array.from({ length: RUNS }, run));
  // [name, input builder, small n, large n (4x), min baseline ms, max allowed 4x ratio]
  // Linear code gives a ratio near 4; quadratic gives near 16. Table inputs that
  // exercise our flattener are timed on a pre-parsed DOM in the next test.
  it.each([
    ['unclosed anchors', (n: number) => '<a href="'.repeat(n), 8000, 32000, 5, 8],
    ['unclosed bold', (n: number) => '<b>'.repeat(n), 8000, 32000, 20, 8],
    ['unclosed UUIDs', (n: number) => '@UUID['.repeat(n), 32000, 128000, 2, 8],
    ['unclosed UUID labels', (n: number) => '@UUID[x]{'.repeat(n), 32000, 128000, 2, 8],
    [
      'long space run in pre',
      (n: number) => '<pre>' + ' '.repeat(n) + 'x</pre>',
      32000,
      128000,
      2,
      8,
    ],
    ['repeated spans of a space', (n: number) => '<span> </span>'.repeat(n), 8000, 32000, 5, 8],
    [
      'mixed closed and unclosed UUID labels',
      (n: number) => '@UUID[x]{a}@UUID[y]{'.repeat(n / 2),
      32000,
      128000,
      2,
      8,
    ],
  ] as const)(
    'adversarial input (%s) scales sub-quadratically',
    { timeout: 60000 },
    (_n, make, ns, nl, floor, max) => {
      const time = (n: number) => {
        const input = make(n);
        const t = performance.now();
        htmlToMarkdown(input);
        return performance.now() - t;
      };
      time(500); // warm up
      const small = Math.max(
        minTime(() => time(ns)),
        floor,
      );
      const large = minTime(() => time(nl));
      expect(large).toBeLessThan(5000);
      expect(large).toBeLessThan(small * max);
    },
  );
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
  ] as const)('flattening %s scales sub-quadratically', { timeout: 60000 }, (_n, make, ns, nl) => {
    // Parse once per size (parsing is slow and untimed); walking is read-only.
    const timeOn = (n: number) => {
      const b = new DOMParser().parseFromString(make(n), 'text/html').body;
      return () => {
        const t = performance.now();
        domToMarkdown(b);
        return performance.now() - t;
      };
    };
    timeOn(200)(); // warm up
    const small = Math.max(minTime(timeOn(ns)), 3);
    const large = minTime(timeOn(nl));
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
  it('keeps boundary whitespace outside inline delimiters', () => {
    expect(htmlToMarkdown('<p><strong>Hello </strong>world</p>')).toBe('**Hello** world');
    expect(htmlToMarkdown('<p>Hello<b> world</b></p>')).toBe('Hello **world**');
    expect(htmlToMarkdown('<p>a<em> b </em>c</p>')).toBe('a *b* c');
    expect(htmlToMarkdown('<p>a<i> b</i></p>')).toBe('a *b*');
    expect(htmlToMarkdown('<p>a<code> b </code>c</p>')).toBe('a b c');
    expect(htmlToMarkdown('<p>a <a href="http://x.y/">link </a>b</p>')).toBe(
      'a [link](http://x.y/) b',
    );
    expect(htmlToMarkdown('<p>a<a href="http://x.y/"> link</a></p>')).toBe('a [link](http://x.y/)');
    expect(htmlToMarkdown('<p><strong><em>a </em></strong>b</p>')).toBe('***a*** b');
    expect(htmlToMarkdown('<p>a<strong> </strong>b</p>')).toBe('a b');
    expect(htmlToMarkdown('<p>a <a href="javascript:1">x </a>b</p>')).toBe('a x b');
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
  const all = (source: Parameters<typeof page>[0], limit?: number): string[] => {
    const out: string[] = [];
    let cursor: string | null = null;
    do {
      const p = page(source, cursor, limit);
      expect(p.chunk.length).toBeGreaterThan(0);
      out.push(p.chunk);
      cursor = p.nextCursor;
    } while (cursor);
    return out;
  };
  const pagesOf = (html: string, limit: number) => all(htmlToDocument(html), limit);

  it('exposes blocks of atomic segments', () => {
    const d = htmlToDocument(
      '<h2>T</h2><p>a <b>bold one</b> <a href="http://x.y/">link text</a></p><ul><li>i</li></ul>',
    );
    expect(d.blocks.map((b) => b.kind)).toEqual(['heading', 'paragraph', 'item']);
    const p = d.blocks[1]!;
    expect(p.segs.map((s) => s.md)).toEqual([
      'a ',
      '**bold one**',
      ' ',
      '[link text](http://x.y/)',
    ]);
    expect(p.segs[1]!.plain).toBe('bold one');
    expect(htmlToMarkdown('<h2>T</h2><p>x</p>')).toBe('## T\n\nx');
  });
  it('packs whole blocks and uses the configured default size', () => {
    const html = '<p>aaa bbb</p><p>ccc ddd</p><p>eee fff</p>';
    expect(pagesOf(html, 20)).toEqual(['aaa bbb\n\nccc ddd', 'eee fff']);
    expect(pagesOf(html, 7)).toEqual(['aaa bbb', 'ccc ddd', 'eee fff']);
    const words = Array.from({ length: 4000 }, () => 'word').join(' ');
    const first = page(htmlToDocument(`<p>${words}</p>`));
    expect(first.chunk.length).toBeLessThanOrEqual(SERIALISE_CONFIG.defaultPageSize);
    expect(first.nextCursor).not.toBeNull();
  });
  it('splits a large block only between segments and never inside one', () => {
    const html = '<p>one <b>two three</b> <a href="http://x.y/">four five</a> six</p>';
    expect(pagesOf(html, 14)).toEqual(['one', '**two three**', 'four five six']); // the link is larger than a page: plain words
    expect(pagesOf(html, 30)).toEqual(['one **two three**', '[four five](http://x.y/) six']);
    expect(pagesOf('<p>aaaaaaaaaa bbb</p>', 4)).toEqual(['aaaaaaaaaa', 'bbb']); // an atom larger than the limit stands alone
  });
  it('emits a span larger than the limit as plain escaped words', () => {
    const pages = pagesOf('<p><b>alpha beta gamma delta</b></p>', 12);
    expect(pages).toEqual(['alpha beta', 'gamma delta']);
    const link = pagesOf('<p><a href="http://x.y/p">alpha *beta* gamma</a></p>', 12);
    expect(link.join(' ')).toBe('alpha \\*beta\\* gamma');
  });
  it('escapes line starts so a page never opens a heading, quote, list or rule', () => {
    const starts = ['#', '>', '-', '+', '1.', '2)', '===', '---', '~~~', ':--', '*', '_', '`'];
    for (const w of starts) {
      const pages = pagesOf(`<p>aaa ${w} bbb</p>`, 5);
      expect(pages[1], w).not.toMatch(/^(#|>|-|\+|\d+[.)]|=|~|:)/);
      expect(pages.join(' ').replace(/\\/g, ''), w).toBe(`aaa ${w} bbb`);
    }
    const br = htmlToMarkdown('<p>a<br># b<br>- c<br>1. d<br>> e</p>');
    expect(br).toBe('a\n\\# b\n\\- c\n1\\. d\n\\> e');
  });
  it('keeps entities, escapes and links whole at the cut', () => {
    const pages = pagesOf('<p>&amp;lt; &amp;#60; \\&lt;img&gt; [x](u) ![a](u)</p>', 6);
    expect(pages.every((p) => !/^[<&]/.test(p))).toBe(true);
    expect(pages.join(' ')).toBe('\\&lt; \\&#60; \\\\\\<img> \\[x\\](u) \\!\\[a\\](u)');
  });
  it('repeats the marker of a continued heading, item and quote', () => {
    expect(pagesOf('<h2>aaa bbb</h2>', 8)).toEqual(['## aaa', '## bbb']);
    expect(pagesOf('<ol><li>aaa bbb</li><li>ccc</li></ol>', 8)).toEqual([
      '1. aaa',
      '1. bbb',
      '2. ccc',
    ]);
    expect(pagesOf('<blockquote>aaa bbb</blockquote>', 7)).toEqual(['> aaa', '> bbb']);
    expect(htmlToMarkdown('<h2>Cost #</h2>')).toBe('## Cost \\#');
  });
  it('indents nested items relative to the page', () => {
    const html = '<ul><li>a<ul><li>b<ul><li>c</li></ul></li></ul></li></ul>';
    expect(htmlToMarkdown(html)).toBe('- a\n  - b\n    - c');
    expect(pagesOf(html, 4)).toEqual(['- a', '- b', '- c']);
  });
  it('closes and reopens a code fence between lines', () => {
    const html = '<pre>line1\n```\nline3\nline4</pre>';
    expect(htmlToMarkdown(html)).toBe('````\nline1\n```\nline3\nline4\n````');
    expect(pagesOf(html, 20)).toEqual([
      '````\nline1\n```\n````',
      '````\nline3\n````',
      '````\nline4\n````',
    ]);
    expect(pagesOf(html, 30)).toEqual(['````\nline1\n```\nline3\n````', '````\nline4\n````']);
  });
  it('repeats the table header on a continuation page', () => {
    const html =
      '<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr><tr><td>3</td><td>4</td></tr></table>';
    const pages = pagesOf(html, 40);
    expect(pages).toEqual([
      '| A | B |\n| --- | --- |\n| 1 | 2 |',
      '| A | B |\n| --- | --- |\n| 3 | 4 |',
    ]);
  });
  it('treats a plain string as text, not markdown', () => {
    expect(page('# not a heading\n\n- nor <b>this</b>').chunk).toBe(
      '\\# not a heading\n\n\\- nor \\<b>this\\</b>',
    );
  });
  it('returns an opaque cursor and rejects invalid or forged ones', () => {
    const d = htmlToDocument('<p>aaa bbb ccc</p>');
    const first = page(d, null, 4);
    expect(first.nextCursor).toMatch(/^p1\.[0-9a-f]{8}\.\d+\.\d+\.\d+$/);
    expect(page(d, first.nextCursor, 4).chunk).toBe('bbb');
    expect(page(d, '', 4).chunk).toBe('aaa');
    const bad = [
      '3',
      'zzz',
      '-1',
      'NaN',
      '1.9',
      'p1.00000000.0.1.0',
      first.nextCursor!.replace(/\.\d+\.\d+\.\d+$/, '.0.99.0'),
      first.nextCursor!.replace(/\.\d+\.\d+\.\d+$/, '.5.0.0'),
      first.nextCursor!.replace(/\.\d+\.\d+\.\d+$/, '.0.2.1'),
      `${first.nextCursor}9999999999`,
      page(htmlToDocument('<p>different</p> <p>doc more</p>'), null, 5).nextCursor ?? 'x',
    ];
    for (const c of bad) expect(() => page(d, c, 4), c).toThrow(PageCursorError);
    expect(() => page(d, 5 as unknown as string, 4)).toThrow(PageCursorError);
  });
});
