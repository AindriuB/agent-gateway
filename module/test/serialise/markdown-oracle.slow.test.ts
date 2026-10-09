// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { PRIVATE_USE } from './corpus.js';
import { check, checkText, combinations } from './markdown-oracle-checks.js';

describe('markdown serialiser oracle (marked), full sweeps', () => {
  it.each(PRIVATE_USE.map((p, i) => [`${i}: ${p.slice(0, 70)}`, p] as const))(
    'private-use input stays inert and keeps its text: %s',
    (_n, html) => {
      checkText(html);
      check(html);
    },
  );

  it('holds for every generated combination', () => {
    expect(combinations(1)).toBeGreaterThan(1000);
  }, 60000);
});
