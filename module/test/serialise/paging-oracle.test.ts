// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import {
  documentToMarkdown,
  htmlToDocument,
  page,
  PageCursorError,
  type MdDocument,
} from '../../src/serialise/index.js';
import { BOUNDARIES, PRIVATE_USE, PROBES, SPACING, SPLIT_TAGS } from './corpus.js';
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
import { checkDocument, pageProblems, subjectOf, type Pager } from './paging-oracle.js';

const pager: Pager = (doc, cursor, limit) => page(doc, cursor, limit);
const ALL_LIMITS = [...Array.from({ length: 200 }, (_, i) => i + 1), 1000, 8000];
const SOME_LIMITS = [
  ...Array.from({ length: 30 }, (_, i) => i + 1),
  40,
  64,
  97,
  150,
  200,
  1000,
  8000,
];

function run(cases: string[], limits: readonly number[]): string[] {
  const failures: string[] = [];
  for (const html of cases) {
    for (const f of checkDocument(html, limits, pager, htmlToDocument, documentToMarkdown)) {
      if (failures.length < 8) failures.push(f);
    }
  }
  return failures;
}

describe('paging oracle: every page is a complete, independently safe markdown document', () => {
  it('existing corpora, limits 1..200 plus 1000 and 8000', () => {
    expect(run([...SPACING, ...SPLIT_TAGS, ...PROBES], ALL_LIMITS)).toEqual([]);
  }, 300000);

  it('br and block boundaries inside nested cells and inline contexts keep words apart, every page', () => {
    expect(run(BOUNDARIES, ALL_LIMITS)).toEqual([]);
  }, 600000);

  it('hazard patterns alone, in every context and assembled from separate nodes', () => {
    const cases = TEXT_PATTERNS.flatMap(textCases);
    expect(cases.length).toBeGreaterThan(1000);
    expect(run(cases, SOME_LIMITS)).toEqual([]);
  }, 600000);

  it('entity and anchor patterns in every context', () => {
    const cases = [...HTML_PATTERNS.flatMap(htmlCases), ...ANCHORS.flatMap(anchorCases)];
    expect(run(cases, SOME_LIMITS)).toEqual([]);
  }, 600000);

  it('hazards at the 8000 and 1000 character boundaries', () => {
    const cases: string[] = [];
    for (const p of TEXT_PATTERNS) {
      for (const pad of [7990, 7997, 7998, 7999, 8000]) {
        cases.push(`<p>${'x'.repeat(pad)}${esc(p)} tail</p>`);
        cases.push(`<p>${'x '.repeat(pad / 2)}${esc(p)} tail</p>`);
      }
    }
    for (const a of ANCHORS) cases.push(`<p>${'x '.repeat(3997)}${a} tail</p>`);
    expect(run(cases, [1000, 8000, 97])).toEqual([]);
  }, 600000);

  it('long mixed documents', () => {
    const cases = [
      `<p>${'x'.repeat(7999)}&lt;img src=x onerror=alert(1)&gt;</p>`,
      `<p>${'x'.repeat(7999)}<span>&lt;img src=x onerror=alert(1)&gt;</span> [a] \\ \u{1F600}</p>`,
      '<p>a &lt;b&gt; &amp;lt; \\&lt;script&gt; [x](javascript:alert(1)) \u{1F600}&lt;i&gt;</p>'.repeat(
        40,
      ),
      '<p>\\\\&lt;b&gt; \\\\\\&lt;i&gt; <a href="https://a.example/">l</a> &lt;img src=x&gt;</p>'.repeat(
        40,
      ),
    ];
    expect(run(cases, [1, 2, 3, 5, 8, 13, 50, 97, 1000, 8000])).toEqual([]);
  }, 600000);

  it('seeded fuzz of mixed fragments', () => {
    expect(run(fuzz(400), SOME_LIMITS)).toEqual([]);
  }, 600000);
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

describe('paging oracle: private-use input', () => {
  const limits = [...SOME_LIMITS, 186, 100, 120, 160];

  it('the reviewer document and the private-use corpus lose no text at any page seam', () => {
    expect(PRIVATE_USE.length).toBeGreaterThan(1000);
    expect(run(PRIVATE_USE, limits)).toEqual([]);
  }, 900000);
});
