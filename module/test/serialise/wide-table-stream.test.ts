import { describe, expect, it } from 'vitest';
import { M, makeDocument, parseStream } from '../../src/serialise/structure.js';
import { documentToMarkdown } from '../../src/serialise/index.js';

// markdown.ts turns a <br> inside a table cell into a space before the stream is built, so HTML input
// never reaches the flattening with a break segment. The stream is the contract between the two files,
// so pin it here: a break marker inside a cell of an over-cap table must still separate words.
const wide = (cols: number, cell: string): string =>
  `${M.TO}${M.RO}${Array.from({ length: cols }, (_, c) => (c === 3 ? cell : `c${c}`)).join(M.CS)}${M.TC}`;

describe('over-cap table flattening, stream level', () => {
  for (const cols of [65, 200]) {
    for (const cell of [`foo${M.BR}bar`, `foo${M.BR}${M.BR}bar`]) {
      it(`${cols} columns, ${JSON.stringify(cell)} keeps words apart`, () => {
        const md = documentToMarkdown(makeDocument(parseStream(wide(cols, cell))));
        expect(md).not.toContain('foobar');
        expect(md).toMatch(/foo\s+bar/);
      });
    }
  }
});
