// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import {
  documentToMarkdown,
  htmlToDocument,
  htmlToMarkdown,
  page,
  type MdDocument,
} from '../../src/serialise/index.js';
import { marked, mditLinkify, mditPlain, pageProblems, subjectOf } from './paging-oracle.js';

/** Every page of a document at one limit. */
function pagesOf(doc: MdDocument, limit?: number): string[] {
  const out: string[] = [];
  let cursor: string | null = null;
  do {
    const p = page(doc, cursor, limit);
    out.push(p.chunk);
    cursor = p.nextCursor;
  } while (cursor);
  return out;
}

/** Check pages and whole document with every reader configuration; return problems. */
function problemsOf(html: string, limit?: number): string[] {
  const doc = htmlToDocument(html);
  const full = documentToMarkdown(doc);
  const subject = subjectOf(html, full);
  const found: string[] = [];
  for (const chunk of [full, ...pagesOf(doc, limit)]) {
    for (const p of pageProblems(chunk, subject).problems)
      found.push(`${JSON.stringify(chunk.slice(0, 120))}: ${p}`);
  }
  return found;
}

describe('a literal ! never turns a following link into an image', () => {
  const noImage = (md: string) => {
    expect(md).not.toMatch(/(?<!\\)(?:\\\\)*!\[/);
    for (const r of [marked.parse(md) as string, mditPlain.render(md), mditLinkify.render(md)])
      expect(r).not.toMatch(/<img\b/i);
  };

  it('a plain-fallback span ending in ! followed by a link, at the default limit', () => {
    const words = Array.from({ length: 2000 }, () => 'word').join(' ');
    const html = `<p><strong>${words} wow!</strong><a href="https://tracker.example/p.gif">x</a></p>`;
    const doc = htmlToDocument(html);
    for (const chunk of pagesOf(doc)) noImage(chunk);
    expect(problemsOf(html)).toEqual([]);
  });

  it('a span ending in ! followed by a link, limit 20', () => {
    const html = '<p><strong>aaaaaaaaaaaa wow!</strong><a href="http://a/">x</a></p>';
    const chunks = pagesOf(htmlToDocument(html), 20);
    for (const c of chunks) noImage(c);
    expect(problemsOf(html, 20)).toEqual([]);
  });

  it('a bare ! link text followed by a link, limit 15 (page was exactly ![x](http://a/))', () => {
    const html = '<a href="ok"><span>!</span><a href="http://a/">x</a></a>';
    for (const limit of [1, 5, 10, 15, 16, 20, 40]) {
      for (const c of pagesOf(htmlToDocument(html), limit)) noImage(c);
      expect(problemsOf(html, limit)).toEqual([]);
    }
  });

  it('holds at every limit for a span of many forms', () => {
    const html =
      '<p><em>big ! words!</em><a href="http://a/">x</a> and <b>!</b><a href="http://b/">y</a>!<a href="http://c/">z</a></p>';
    for (let limit = 1; limit <= 80; limit++) {
      for (const c of pagesOf(htmlToDocument(html), limit)) noImage(c);
      expect(problemsOf(html, limit)).toEqual([]);
    }
  });
});

describe('typed text cannot expose markup through a reader autolink', () => {
  const cases = [
    'see http://evil.com<img src=x onerror=alert(1)>',
    'www.evil.com<iframe src=x>',
    'http://x/<svg onload=alert(1)>',
    'http://x/&lt;svg&gt; and &amp;lt; end',
    'mail me@evil.example<img src=x> now',
    '<span>http://evil.com</span><span><img src=x onerror=alert(1)></span>',
    'http://evil.com&<b>x</b>',
  ];
  it.each(cases)('whole document and every page: %s', (text) => {
    const html = `<p>${text.replace(/<(?!span|\/span)/g, '&lt;')}</p>`;
    const md = htmlToMarkdown(html);
    expect(md).not.toContain('\\<');
    expect(md).not.toContain('\\&');
    expect(marked.parse(md) as string).not.toMatch(/<img|<iframe|<svg|<b>/i);
    for (let limit = 1; limit <= 120; limit += 7) expect(problemsOf(html, limit)).toEqual([]);
    expect(problemsOf(html)).toEqual([]);
  });

  it('writes < and & as entities', () => {
    expect(htmlToMarkdown('<p>a &lt;b&gt; &amp; c</p>')).toBe('a &lt;b> &amp; c');
  });
});

describe('other text escapes', () => {
  it('escapes ~ so ~~x~~ is not strikethrough', () => {
    const md = htmlToMarkdown('<p>~~x~~ and ~y~</p>');
    expect(marked.parse(md) as string).not.toMatch(/<del>/);
    expect(mditPlain.render(md)).not.toMatch(/<s>/);
  });

  it('a heading that is just # is escaped once', () => {
    expect(htmlToMarkdown('<h1>#</h1>')).toBe('# \\#');
    expect(htmlToMarkdown('<h2>a #</h2>')).toBe('## a \\#');
    expect(htmlToMarkdown('<h2>a \\#</h2>')).toBe('## a \\\\\\#');
  });

  it('sizes the code fence per page, not from the whole block', () => {
    const lines = ['`'.repeat(100_000), ...Array.from({ length: 1000 }, (_, i) => `line ${i}`)];
    const html = `<pre>${lines.join('\n')}</pre>`;
    const pages = pagesOf(htmlToDocument(html), 200);
    const total = pages.reduce((n, p) => n + p.length, 0);
    expect(total).toBeLessThan(400_000);
    for (const p of pages.slice(1)) expect(p.startsWith('```\n')).toBe(true);
  });
});
