// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { BOUNDARIES, CAPTIONS, PRIVATE_USE, PROBES, SPACING, SPLIT_TAGS } from './corpus.js';
import { check, checkText, combinations } from './markdown-oracle-checks.js';

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

  it.each(CAPTIONS.map((p) => [p.slice(0, 90), p] as const))(
    'captioned table keeps its caption: %s',
    (_n, html) => {
      checkText(html);
      check(html);
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

  it.each(
    PRIVATE_USE.filter((_, i) => i % 10 === 0).map(
      (p, i) => [`${i}: ${p.slice(0, 70)}`, p] as const,
    ),
  )('private-use input stays inert and keeps its text: %s', (_n, html) => {
    checkText(html);
    check(html);
  });

  it('holds for a sample of the generated combinations', () => {
    expect(combinations(20)).toBeGreaterThan(50);
  });
});
