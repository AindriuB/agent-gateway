// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { exactMissing, inputWords } from './paging-oracle.js';

/** The substring check the oracles used before they were made exact. */
function lenientMissing(input: string[], output: string[]): string | null {
  let i = 0;
  for (const w of input) {
    while (i < output.length && !output[i]!.includes(w)) i++;
    if (i >= output.length) return w;
    i++;
  }
  return null;
}

describe('the exact text oracle', () => {
  const input = ['First', 'Second'];
  // An output-only token holding the word (an autolinked address, say) is all the old check needed.
  const glued = ['FirstSecond', 'then', 'www.Second.example'];

  it('is stricter than substring matching: a token merely containing Second excuses the old check, not this one', () => {
    expect(lenientMissing(input, glued)).toBeNull();
    expect(exactMissing(input, glued)).toBe('First');
  });

  it('fails a glued pair whether or not a decoy exists', () => {
    expect(exactMissing(input, ['FirstSecond'])).not.toBeNull();
    expect(exactMissing(input, ['Second', 'FirstSecond', 'First', 'Second', 'Second'])).toBeNull();
    expect(exactMissing(['A', 'B'], ['xA', 'B'])).toBe('A');
  });

  it('accepts the serialiser deliberate changes and extra tokens', () => {
    expect(
      exactMissing(['a', 'b', 'c'], ['[a', '/', 'b];', 'c', 'https://x.example', '-']),
    ).toBeNull();
    expect(exactMissing(['a;', 'b'], ['a;', 'b'])).toBeNull();
    expect(exactMissing(['Lbl', '(id)'], ['Lbl', '(id)'])).toBeNull();
  });

  it('keeps order and rejects a lost word', () => {
    expect(exactMissing(['a', 'b'], ['b', 'a'])).toBe('b');
    expect(exactMissing(['a', 'b'], ['a'])).toBe('b');
  });

  it('lets a word cut by the pager match across a page seam, and only there', () => {
    const seams = new Map([[0, 0]]);
    expect(exactMissing(['worldx'], ['world', 'x'], seams)).toBeNull();
    expect(exactMissing(['worldx'], ['world', 'x'])).toBe('worldx');
    expect(exactMissing(['worldx'], ['world', 'x'], new Map([[1, 0]]))).toBe('worldx');
    // repeated table header opening the next page
    expect(exactMissing(['ab'], ['a', 'H', 'b'], new Map([[0, 1]]))).toBeNull();
  });

  it('private-use input is expected as U+FFFD: deleting it or passing it through is a failure', () => {
    const want = inputWords('<p>a&#xE010;b &#xE0FF; c&#xE100;</p>');
    expect(want).toEqual(['a\uFFFDb', '\uFFFD', 'c\uE100']);
    expect(exactMissing(want, ['a\uFFFDb', '\uFFFD', 'c\uE100'])).toBeNull();
    expect(exactMissing(want, ['ab', '\uFFFD', 'c\uE100'])).toBe('a\uFFFDb');
    expect(exactMissing(want, ['a\uE010b', '\uFFFD', 'c\uE100'])).toBe('a\uFFFDb');
  });
});
