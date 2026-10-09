// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import {
  documentToMarkdown,
  htmlToDocument,
  page,
  PageCursorError,
  type MdDocument,
} from '../../src/serialise/index.js';
import {
  BOUNDARIES,
  CAPTIONS,
  LONG_HEADERS,
  WIDE_TABLES,
  PRIVATE_USE,
  PROBES,
  SPACING,
  SPLIT_TAGS,
} from './corpus.js';
import {
  ANCHORS,
  HTML_PATTERNS,
  TEXT_PATTERNS,
  anchorCases,
  esc,
  fuzz,
  htmlCases,
  textCases,
} from './paging-corpus.js';
import { pageProblems, subjectOf } from './paging-oracle.js';
import { FAST_LIMITS, run, sample } from './paging-run.js';

// A sample of each full sweep (see paging-oracle.slow.test.ts): limits 1, 8, 50 and 1000 over every
// 10th-or-so case, so `npm test` still exercises paging safety on every corpus.
describe('paging oracle (sampled): every page is a complete, independently safe markdown document', () => {
  it('existing corpora', () => {
    expect(run(sample([...SPACING, ...SPLIT_TAGS, ...PROBES], 4), FAST_LIMITS)).toEqual([]);
  });

  it('br and block boundaries', () => {
    expect(run(sample(BOUNDARIES, 4), FAST_LIMITS)).toEqual([]);
  });

  it('long table headers are blanked on continuation pages, still safe', () => {
    expect(run(LONG_HEADERS, FAST_LIMITS)).toEqual([]);
  });

  it('captioned tables keep the caption on the pages', () => {
    expect(run(CAPTIONS, FAST_LIMITS)).toEqual([]);
  });

  it('tables over the column cap keep words apart in every cell', () => {
    expect(run(sample(WIDE_TABLES, 3), FAST_LIMITS)).toEqual([]);
  });

  it('hazard patterns, entities and anchors', () => {
    const cases = [
      ...TEXT_PATTERNS.flatMap(textCases),
      ...HTML_PATTERNS.flatMap(htmlCases),
      ...ANCHORS.flatMap(anchorCases),
    ];
    expect(run(sample(cases, 25), FAST_LIMITS)).toEqual([]);
  });

  it('seeded fuzz and private-use input', () => {
    expect(run(fuzz(40), FAST_LIMITS)).toEqual([]);
    expect(run(sample(PRIVATE_USE, 25), FAST_LIMITS)).toEqual([]);
  });
});

describe('paging oracle: cursors', () => {
  const docs = [
    ...TEXT_PATTERNS.slice(0, 20).map((p) => `<p>w ${esc(p)} z</p><ul><li>${esc(p)} q</li></ul>`),
    '<table><tr><th>a b</th><th>c</th></tr><tr><td>1 2</td><td>3</td></tr></table><pre>l1\nl2\nl3</pre>',
    '<p><b>alpha beta gamma delta</b> <a href="http://ok.example/p">one two three four</a></p>',
  ];

  it('a page from every hand-made in-range cursor is safe on its own', () => {
    for (const html of docs) {
      const doc: MdDocument = htmlToDocument(html);
      const subject = subjectOf(html, documentToMarkdown(doc));
      doc.blocks.forEach((block, b) => {
        block.segs.forEach((sg, s) => {
          const ws = sg.plain ? [0, ...sg.plain.split(' ').keys()] : [0];
          for (const w of ws) {
            for (const limit of [1, 5, 12, 40, 8000]) {
              const cursor = `p1.${doc.id}.${b}.${s}.${w}`;
              const p = page(doc, cursor, limit);
              const { problems } = pageProblems(p.chunk, subject);
              expect(problems, `${html} @ ${cursor} limit ${limit}`).toEqual([]);
            }
          }
        });
      });
    }
  });

  it('every forged or out-of-range cursor is rejected, never a mid-construct start', () => {
    const doc = htmlToDocument(docs[0]!);
    const good = page(doc, null, 3).nextCursor!;
    const tail = /\.(\d+)\.(\d+)\.(\d+)$/;
    const forged = [
      '0',
      '3',
      '-1',
      '1.5',
      'NaN',
      'Infinity',
      '1e3',
      ' ',
      'p1',
      'p1.',
      'p1.0.0.0',
      'P1.00000000.0.0.0',
      'p2.00000000.0.0.0',
      'p1.00000000.0.0.0',
      `${good}.1`,
      `${good} `,
      ` ${good}`,
      good.toUpperCase(),
      good.replace(tail, '.-1.0.0'),
      good.replace(tail, '.0.-1.0'),
      good.replace(tail, '.0.0.-1'),
      good.replace(tail, '.999.0.0'),
      good.replace(tail, '.0.999.0'),
      good.replace(tail, '.0.0.999'),
      good.replace(tail, '.0.0.1'),
      good.replace(tail, '.1e3.0.0'),
      good.replace(tail, '.0.0.0.0'),
      good.replace(tail, '.1234567890.0.0'),
      '\\<img src=x>',
      '<img src=x onerror=1>',
    ];
    for (const c of forged)
      expect(() => page(doc, c, 5), JSON.stringify(c)).toThrow(PageCursorError);
    for (const bad of [5, {}, [], true] as unknown[])
      expect(() => page(doc, bad as string, 5)).toThrow(PageCursorError);
    // A cursor is bound to its document.
    const other = htmlToDocument('<p>other document entirely</p>');
    expect(() => page(other, good, 5)).toThrow(PageCursorError);
    // Absent cursors start at the beginning.
    for (const c of [null, undefined, ''] as const)
      expect(page(doc, c, 3).chunk).toBe(page(doc, null, 3).chunk);
  });

  it('round-trips and terminates', () => {
    for (const html of docs) {
      const doc = htmlToDocument(html);
      for (const limit of [1, 4, 9, 33]) {
        const cursors = new Set<string>();
        let c: string | null = null;
        let n = 0;
        do {
          const p = page(doc, c, limit);
          if (p.nextCursor) {
            expect(cursors.has(p.nextCursor)).toBe(false);
            cursors.add(p.nextCursor);
          }
          c = p.nextCursor;
          n += 1;
        } while (c && n < 10000);
        expect(c).toBeNull();
      }
    }
  });
});
