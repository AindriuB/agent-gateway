// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { BREAKS, htmlToDocument, htmlToMarkdown, page } from '../../src/serialise/index.js';

// Every element that ends a word must keep "Alpha" and "Beta" apart, wherever it appears.
// Void elements have no content, and the HTML parser itself drops table parts, list items and
// form-option parts outside their parents (or text inside a select), so those are covered by the
// table, list and form tests instead.
const SKIP = new Set([
  'br',
  'hr',
  'td',
  'th',
  'tr',
  'thead',
  'tbody',
  'tfoot',
  'caption',
  'option',
  'optgroup',
  'select',
]);
const TAGS = [...BREAKS].filter((t) => !SKIP.has(t));
const CONTEXTS: [string, (inner: string) => string][] = [
  ['top level', (x) => x],
  ['inside a table cell', (x) => `<table><tr><td>${x}</td></tr></table>`],
  ['inside emphasis', (x) => `<b>${x}</b>`],
  ['inside a list item', (x) => `<ul><li>${x}</li></ul>`],
];

const pagesOf = (html: string, limit: number) => {
  const doc = htmlToDocument(html);
  const out: string[] = [];
  let cursor: string | null = null;
  do {
    const pg = page(doc, cursor, limit);
    out.push(pg.chunk);
    cursor = pg.nextCursor;
  } while (cursor);
  return out.join('\n');
};

describe('block containers keep word boundaries', () => {
  for (const [ctx, wrap] of CONTEXTS) {
    it.each(TAGS)(`<%s> ${ctx}`, (tag) => {
      const html = wrap(`<${tag}>Alpha</${tag}><${tag}>Beta</${tag}>`);
      expect(htmlToMarkdown(html)).not.toContain('AlphaBeta');
      for (const limit of [20, 1000]) expect(pagesOf(html, limit)).not.toContain('AlphaBeta');
    });
  }

  it.each([
    ['<details><summary>Title</summary>Body</details>', ['Title', 'Body']],
    ['<header>Alpha</header><main>Beta</main>', ['Alpha', 'Beta']],
    ['<figure>img<figcaption>Caption</figcaption></figure>', ['img', 'Caption']],
  ])('%s keeps its words apart', (html, words) => {
    const md = htmlToMarkdown(html);
    expect(md).not.toContain(words.join(''));
    for (const w of words) expect(md).toContain(w);
  });

  it('keeps inline elements concatenated', () => {
    expect(htmlToMarkdown('<span>Al</span><span>pha</span>')).toContain('Alpha');
    expect(htmlToMarkdown('Al<b>pha</b>')).toContain('Al**pha**');
  });
});
