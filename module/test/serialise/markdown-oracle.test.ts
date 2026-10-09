// @vitest-environment happy-dom
import { Marked, type Token, type Tokens } from 'marked';
import { describe, expect, it } from 'vitest';
import { htmlToMarkdown, page } from '../../src/serialise/index.js';

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

function isAbs(h: string): boolean {
  try {
    return new URL(h, BASE).origin !== new URL(BASE).origin;
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

/** Every token of the given type, at any depth (blocks, inlines, list items, table cells). */
function tokensOfType(tokens: Token[], type: string, out: Token[] = []): Token[] {
  for (const t of tokens) {
    if (t.type === type) out.push(t);
    const c = t as {
      tokens?: Token[];
      items?: Token[];
      header?: { tokens: Token[] }[];
      rows?: { tokens: Token[] }[][];
    };
    if (c.tokens) tokensOfType(c.tokens, type, out);
    if (c.items) tokensOfType(c.items, type, out);
    if (c.header) for (const h of c.header) tokensOfType(h.tokens, type, out);
    if (c.rows) for (const r of c.rows) for (const cell of r) tokensOfType(cell.tokens, type, out);
  }
  return out;
}

/** The serialiser never emits raw HTML, so a reader must find no html token at all. */
function noHtml(html: string, md: string): void {
  const found = tokensOfType(
    new Marked({ gfm: true, tokenizer: { url: () => undefined } }).lexer(md),
    'html',
  );
  expect(
    found.map((t) => t.raw),
    `html token from ${JSON.stringify(html)} => ${JSON.stringify(md)}`,
  ).toEqual([]);
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
  noHtml(html, md);
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
    // Exact meaning: a relative input never gains a host; an absolute one keeps its parsed host and `&`s.
    const src = anchors.find((a) => allowed(a) && norm(a) === norm(l.href))!;
    const amps = (x: string) => x.split('&').length;
    if (isAbs(src)) {
      expect(new URL(l.href).host, `host of ${l.href}`).toBe(new URL(src, BASE).host);
    } else {
      expect(l.href.startsWith('//'), `protocol-relative ${l.href}`).toBe(false);
      expect(new URL(l.href, BASE).origin, `host of ${l.href}`).toBe(new URL(BASE).origin);
    }
    expect(amps(l.href), `ampersands in ${l.href}`).toBe(amps(new URL(src, BASE).href));
  }
  // Never more links than anchors the author wrote.
  expect(found.length).toBeLessThanOrEqual(anchors.length);
}

const INLINE = new Set([
  'a',
  'b',
  'strong',
  'i',
  'em',
  'code',
  'span',
  'u',
  'sub',
  'sup',
  'mark',
  'small',
  's',
]);
const DROPPED = new Set(['script', 'style', 'template', 'noscript']);

/** Whitespace-normalised word tokens of the input's text, skipping dropped subtrees. */
function inputWords(html: string): string[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  let out = '';
  const go = (n: Node): void => {
    if (n.nodeType === 3) out += n.nodeValue ?? '';
    else if (n.nodeType === 1) {
      const tag = (n as Element).tagName.toLowerCase();
      if (DROPPED.has(tag)) return;
      const sep = INLINE.has(tag) ? '' : ' ';
      out += sep;
      n.childNodes.forEach(go);
      out += sep;
    }
  };
  go(doc.body);
  out = out.replace(/@UUID\[[^\]]*\](?:\{([^}]*)\})?/g, ' $1 ');
  return out.split(/\s+/).filter(Boolean);
}

/** Word tokens of the markdown as a reader sees it (marked -> HTML -> text). */
function outputWords(md: string): string[] {
  const rendered = new Marked({ gfm: true, tokenizer: { url: () => undefined } }).parse(
    md,
  ) as string;
  const spaced = rendered
    .replace(/<(?!\/?(?:strong|em|a|code|b|i)\b)[^>]*>/g, ' ')
    .replace(/<[^>]*>/g, '');
  const ta = document.createElement('textarea');
  ta.innerHTML = spaced.replace(/</g, '&lt;');
  return ta.value.split(/\s+/).filter(Boolean);
}

/** The input's words must all survive, in order (extra output words are allowed). */
function checkText(html: string): void {
  const md = htmlToMarkdown(html);
  const out = outputWords(md);
  let i = 0;
  for (const w of inputWords(html)) {
    while (i < out.length && !out[i]!.includes(w)) i++; // bracket/UUID decoration may touch a word
    expect(
      i < out.length,
      `word ${JSON.stringify(w)} lost from ${JSON.stringify(html)} => ${JSON.stringify(md)}`,
    ).toBe(true);
    i++;
  }
}

const SPACING: string[] = [];
for (const tag of ['strong', 'b', 'em', 'i', 'code', 'span', 'u'])
  for (const [a, b] of [
    ['Hello ', 'world'],
    ['Hello', ' world'],
    [' Hello ', 'world'],
    ['Hello ', ' world'],
  ] as const)
    SPACING.push(
      `<p><${tag}>${a}</${tag}>${b}</p>`,
      `<p>${a.trim()}<${tag}>${b === 'world' ? ' ' : ''}${b}</${tag}>x</p>`,
    );
for (const [a, b] of [
  ['Hello ', 'world'],
  ['Hello', ' world'],
  [' Hello ', ' world'],
] as const)
  SPACING.push(
    `<p><a href="https://a.example/p">${a}</a>${b}</p>`,
    `<p>${a}<a href="https://a.example/p">${b}</a>!</p>`,
    `<p><a href="javascript:1">${a}</a>${b}</p>`,
  );
SPACING.push(
  '<p><strong><em>a </em></strong>b</p>',
  '<p>a<strong> <em> b</em> </strong>c</p>',
  '<p><strong> </strong>x</p>',
  '<p>a<em> </em>b</p>',
  '<p><b>a<br></b>b</p>',
  '<p>one <a href="https://a.example/">two </a><i>three </i><b>four</b></p>',
  '<p>@UUID[Actor.abc]{Name } here</p>',
  '<ul><li><b>x </b>y</li></ul>',
  '<table><tr><td><b>x </b>y</td><td>z</td></tr></table>',
  '<script>bad words</script><p>ok</p><style>.x{}</style>',
);

const SPLIT_TAGS = [
  '<p><span>&lt;</span>a href="javascript:alert(1)"&gt;click<span>&lt;</span>/a&gt;</p>',
  '<p><span>&lt;</span><span>a</span> href="javascript:alert(1)"&gt;x</p>',
  '<p>&lt;<b>a</b> href="javascript:alert(1)"&gt;x&lt;/<b>a</b>&gt;</p>',
  '<p>&lt;a hr<span>ef="javascript:alert(1)"</span>&gt;x</p>',
  '<p>&lt;a href=<span>"javascript:alert(1)"</span> onclick=<i>"x"</i>&gt;x</p>',
  '<p>&lt;<span>/</span>a&gt;</p>',
  '<p><span>&lt;</span>/<span>a</span>&gt;</p>',
  '<p><span>&lt;</span>!-- <span>hidden</span> --&gt;</p>',
  '<p>&lt;!<span>--</span> x --&gt;</p>',
  '<p><span>&lt;</span>![CDATA[<span>x</span>]]&gt;</p>',
  '<p>&lt;<span>![CDATA[</span>x]]&gt;</p>',
  '<p><span>&lt;</span>?php echo 1 ?&gt;</p>',
  '<p>&lt;?<span>xml</span> version="1.0"?&gt;</p>',
  '<p><span>&lt;</span>javascript:alert(1)&gt;</p>',
  '<p>&lt;<span>javascript:</span>alert(1)&gt;</p>',
  '<p><span>&lt;</span>https://evil.example/p&gt;</p>',
  '<p>&amp;lt;a href="javascript:alert(1)"&amp;gt;x</p>',
  '<p>&amp;<span>lt;</span>a href="javascript:alert(1)"&gt;x</p>',
  '<p>&amp;#60;a href="javascript:alert(1)"&gt;x</p>',
  '<p>&amp;#x3C;script&gt;alert(1)&amp;#x3C;/script&gt;</p>',
  '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>',
  '<p>&lt;div&gt;</p><p>x</p>',
  '<p>&lt;<span>img</span> src=x onerror=alert(1)&gt;</p>',
  '<ul><li>&lt;<b>a</b> href="javascript:1"&gt;x</li></ul>',
  '<table><tr><td>&lt;</td><td>a href="javascript:1"&gt;x&lt;</td><td>/a&gt;</td></tr></table>',
  '<table><tr><td><table><tr><td>&lt;</td><td>a href=x&gt;</td></tr></table></td></tr></table>',
  '<p>@UUID[Actor.a]{&lt;}a href="javascript:1"&gt;x</p>',
  '<p>&lt;@UUID[Actor.a]{a} href="javascript:1"&gt;x</p>',
  '<h2>&lt;<span>a</span> href=x&gt;</h2>',
  '<p>a &lt; b &amp; c &gt; d</p>',
];

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
  '<a href="/.//evil.example/p">x</a>',
  '<a href="/%2e//evil.example/p">x</a>',
  '<a href="/a/..//evil.example/p">x</a>',
  '<a href="https://a.example/p?a=1&amp;b=2">x</a>',
  '<a href="mailto:a@b.c?subject=s&amp;cc=d@e.f">x</a>',
  '<a href="https://[::1]:8080/p">x</a>',
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
  it.each(SPACING.map((p) => [p.slice(0, 70), p] as const))('text preserved: %s', (_n, html) => {
    checkText(html);
    check(html);
  });

  it.each(PROBES.map((p) => [p.slice(0, 70), p] as const))(
    'text preserved, probe: %s',
    (_n, html) => {
      checkText(html);
    },
  );

  it.each(SPLIT_TAGS.map((p) => [p.slice(0, 70), p] as const))(
    'split tags emit no html token: %s',
    (_n, html) => {
      check(html);
      checkText(html);
    },
  );

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
            // marked mis-parses links whose text holds escaped brackets, so text is checked without them.
            if (!/[[\]\\]|&#9/.test(tx))
              checkText(w(`<a href="${sc}${tl}">${tx}</a>@evil.example/p [z](javascript:3)`));
            n++;
          }
    expect(n).toBeGreaterThan(1000);
  }, 60000);
});

describe('paged markdown is safe page by page', () => {
  const inputs = [
    `<p>${'x'.repeat(7999)}&lt;img src=x onerror=alert(1)&gt;</p>`,
    `<p>${'x'.repeat(7999)}<span>&lt;img src=x onerror=alert(1)&gt;</span> [a] \\ \u{1F600}</p>`,
    '<p>a &lt;b&gt; &amp;lt; \\&lt;script&gt; [x](javascript:alert(1)) \u{1F600}&lt;i&gt;</p>'.repeat(
      40,
    ),
    '<p>\\\\&lt;b&gt; \\\\\\&lt;i&gt; <a href="https://a.example/">l</a> &lt;img src=x&gt;</p>'.repeat(
      40,
    ),
  ];
  for (const html of inputs) {
    it(`every page parses without html or bad links (${html.length} chars)`, () => {
      const md = htmlToMarkdown(html);
      for (const limit of [...Array.from({ length: 50 }, (_, i) => i + 1), 97, 1000, 8000]) {
        let cursor: string | null = null;
        let joined = '';
        do {
          const p = page(md, cursor, limit);
          joined += p.chunk;
          noHtml(html, p.chunk);
          for (const l of linksOf(p.chunk)) {
            expect(l.type).toBe('link');
            expect(allowed(l.href), `link ${l.href}`).toBe(true);
          }
          cursor = p.nextCursor;
        } while (cursor);
        expect(joined).toBe(md);
      }
    });
  }
  it('a page from any hand-made cursor is safe on its own', () => {
    for (const html of inputs.slice(1, 4)) {
      const md = htmlToMarkdown(html).slice(0, 400);
      for (const limit of [1, 3, 8, 50]) {
        for (let c = -1; c <= md.length + 1; c++) {
          const p = page(md, String(c), limit);
          noHtml(html, p.chunk);
          for (const l of linksOf(p.chunk)) expect(allowed(l.href), `link ${l.href}`).toBe(true);
        }
      }
    }
  });
});
