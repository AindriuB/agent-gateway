// @vitest-environment happy-dom
import type { Token, Tokens } from 'marked';
import { describe, expect, it } from 'vitest';
import { htmlToMarkdown } from '../../src/serialise/index.js';
import { BOUNDARIES, PROBES, SPACING, SPLIT_TAGS } from './corpus.js';
import {
  autolinkOk,
  exactMissing,
  marked as defaultMarked,
  renderChecked,
  mditLinkify,
  mditPlain,
} from './paging-oracle.js';

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
  const found = tokensOfType(defaultMarked.lexer(md), 'html');
  expect(
    found.map((t) => t.raw),
    `html token from ${JSON.stringify(html)} => ${JSON.stringify(md)}`,
  ).toEqual([]);
  // Whole-document output under default marked, and markdown-it with linkify on and off.
  expect(
    defaultMarked.parse(md) as string,
    `marked output from ${JSON.stringify(html)} => ${JSON.stringify(md)}`,
  ).not.toMatch(
    /<(?!\/?(?:p|h[1-6]|ul|ol|li|blockquote|pre|code|em|strong|a|br|hr|table|thead|tbody|tr|th|td|del)\b)/i,
  );
  for (const [name, it] of [
    ['linkify', mditLinkify],
    ['plain', mditPlain],
  ] as const) {
    expect(
      renderChecked(md, it).problems,
      `markdown-it ${name} from ${JSON.stringify(html)} => ${JSON.stringify(md)}`,
    ).toEqual([]);
  }
}

/** Parse markdown with marked and return every link/image it finds. */
function linksOf(md: string): Tokens.Link[] {
  const out: Token[] = [];
  walk(defaultMarked.lexer(md), out);
  // CommonMark decodes entities and backslash escapes in link targets; do so for any marked left raw.
  const ta = document.createElement('textarea');
  return (out as Tokens.Link[])
    .filter((l) => {
      // A link made from typed text by GFM autolinking is fine if it is plain http(s)/mailto.
      const auto = l.type === 'link' && l.raw === l.text;
      if (auto) expect(autolinkOk(l.href), `autolink ${l.raw}`).toBe(true);
      return !auto;
    })
    .map((l) => {
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
  out = out.replace(
    /@UUID\[([^\]]+)\](?:\{([^}]*)\})?/g,
    (_m, id: string, label?: string) => `${label || id} (${id})`,
  );
  return out.split(/\s+/).filter(Boolean);
}

/** Word tokens of the markdown as a reader sees it (marked -> HTML -> text). */
function outputWords(md: string): string[] {
  const rendered = defaultMarked.parse(md) as string;
  const spaced = rendered
    .replace(/<(?!\/?(?:strong|em|a|code|b|i)\b)[^>]*>/g, ' ')
    .replace(/<[^>]*>/g, '');
  const ta = document.createElement('textarea');
  ta.innerHTML = spaced.replace(/</g, '&lt;');
  return ta.value.split(/\s+/).filter(Boolean);
}

/** The input's words must all survive, in order and exactly (extra output words are allowed). */
function checkText(html: string): void {
  const md = htmlToMarkdown(html);
  const lost = exactMissing(inputWords(html), outputWords(md));
  expect(
    lost,
    `word ${JSON.stringify(lost)} lost or glued in ${JSON.stringify(html)} => ${JSON.stringify(md)}`,
  ).toBeNull();
}

describe('markdown serialiser oracle (marked)', () => {
  it.each(SPACING.map((p) => [p.slice(0, 70), p] as const))('text preserved: %s', (_n, html) => {
    checkText(html);
    check(html);
  });

  it.each(BOUNDARIES.map((p) => [p.slice(0, 90), p] as const))(
    'words kept apart at br and block boundaries: %s',
    (_n, html) => {
      checkText(html);
    },
  );

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
