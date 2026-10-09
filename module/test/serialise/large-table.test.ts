import { describe, expect, it } from 'vitest';
import { M, SERIALISE_CONFIG, makeDocument, page, parseStream } from '../../src/serialise/index.js';

describe('large tables', () => {
  // Built as the renderer's marker stream so no DOM is needed; 150k rows is past the engine's
  // argument limit, so a `Math.max(...rows)` over the rows throws a RangeError.
  it('parses a 150k-row table without throwing', () => {
    const rows = 150000;
    const stream = M.TO + `${M.RO}r`.repeat(rows) + M.TC;
    const blocks = parseStream(stream);
    expect(blocks).toHaveLength(rows);
    expect(makeDocument(blocks).blocks).toHaveLength(rows);
  });

  it('keeps the widest row as the column count of a wide table', () => {
    const stream =
      M.TO + `${M.RO}a${M.CS}b` + `${M.RO}c`.repeat(150000) + `${M.RO}d${M.CS}e${M.CS}f` + M.TC;
    const blocks = parseStream(stream);
    expect(blocks[0]).toMatchObject({ kind: 'row', cols: 3 });
  });

  it('keeps missing cells implicit: one wide row then many one-cell rows stays linear', () => {
    const n = 1000;
    const stream = M.TO + `${M.RO}a${`${M.CS}a`.repeat(n - 1)}` + `${M.RO}b`.repeat(n) + M.TC;
    const blocks = parseStream(stream);
    // The table is wider than the cap, so every row is one flattened text block.
    expect(blocks).toHaveLength(n + 1);
    const w = SERIALISE_CONFIG.maxTableColumns;
    const narrow = M.TO + `${M.RO}a${`${M.CS}a`.repeat(w - 1)}` + `${M.RO}b`.repeat(n) + M.TC;
    const nb = parseStream(narrow);
    let segs = 0;
    for (const b of nb) segs += b.segs.length;
    expect(segs).toBe(2 * w - 1 + n);
    expect(nb[1]).toMatchObject({ kind: 'row', cols: w, cells: 1 });
  });

  it('renders short rows without trailing cells; the header and delimiter carry every column', () => {
    const stream = M.TO + `${M.RO}h1${M.CS}h2${M.CS}h3${M.RO}x${M.RO}y${M.CS}z` + M.TC;
    const out = page(makeDocument(parseStream(stream)), null, 1000).chunk;
    expect(out).toBe('| h1 | h2 | h3 |\n| --- | --- | --- |\n| x |\n| y | z |');
  });

  it('pads a short header row to the full width', () => {
    const stream = M.TO + `${M.RO}h${M.RO}x${M.CS}y${M.CS}z` + M.TC;
    const out = page(makeDocument(parseStream(stream)), null, 1000).chunk;
    expect(out).toBe('| h |  |  |\n| --- | --- | --- |\n| x | y | z |');
  });

  it('emits a table over the column cap as flattened text, one block per row, never repeating a header', () => {
    const w = SERIALISE_CONFIG.maxTableColumns + 1;
    const wide = (t: string) => `${M.RO}${Array.from({ length: w }, () => t).join(M.CS)}`;
    const stream = M.TO + wide('a') + wide('b').repeat(3) + M.TC;
    const doc = makeDocument(parseStream(stream));
    expect(doc.blocks.map((b) => b.kind)).toEqual([
      'paragraph',
      'paragraph',
      'paragraph',
      'paragraph',
    ]);
    const first = page(doc, null, 100);
    expect(first.chunk).not.toContain('---');
    expect(first.chunk.startsWith('a / a / a / ')).toBe(true);
    let cursor: string | null = null;
    do {
      const pg = page(doc, cursor, 100);
      expect(pg.chunk).not.toContain('| --- |');
      cursor = pg.nextCursor;
    } while (cursor);
  });

  it('keeps a table at exactly the column cap as a GFM table', () => {
    const w = SERIALISE_CONFIG.maxTableColumns;
    const stream =
      M.TO + `${M.RO}${Array.from({ length: w }, () => 'a').join(M.CS)}${M.RO}b` + M.TC;
    expect(parseStream(stream).map((b) => b.kind)).toEqual(['row', 'row']);
  });
});

describe('paging a long table cell', () => {
  // Counts reads of a row's segments while paging every page at a small limit. Each page must read
  // only the segments it places, not rescan the row's prefix to find its starting column.
  const segmentReads = (stream: string): number => {
    const doc = makeDocument(parseStream(stream));
    let reads = 0;
    for (const b of doc.blocks) {
      b.segs = new Proxy(b.segs, {
        get(t, k, r) {
          if (typeof k === 'string' && /^\d+$/.test(k)) reads++;
          return Reflect.get(t, k, r);
        },
      });
    }
    let cursor: string | null = null;
    let pages = 0;
    do {
      cursor = page(doc, cursor, 50).nextCursor;
      pages++;
    } while (cursor && pages < 100000);
    expect(pages).toBeGreaterThan(10);
    return reads;
  };
  const cell = (words: number) => 'word '.repeat(words).trim();

  it.each([
    ['one-cell row', (w: number) => M.TO + M.RO + cell(w) + M.TC],
    [
      'last cell of a wide row',
      (w: number) => M.TO + M.RO + `a${M.CS}`.repeat(40) + cell(w) + M.TC,
    ],
  ])('%s: segment reads grow linearly with the cell', (_name, build) => {
    const small = segmentReads(build(1000));
    const large = segmentReads(build(4000));
    // Linear is 4x; rescanning the prefix on every page is about 16x.
    expect(large / small).toBeLessThan(6);
  });
});
