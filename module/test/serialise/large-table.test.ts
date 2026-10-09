import { describe, expect, it } from 'vitest';
import { M, makeDocument, parseStream } from '../../src/serialise/index.js';

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
});
