// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
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
import { ALL_LIMITS, SOME_LIMITS, run } from './paging-run.js';

describe('paging oracle (full sweeps): every page is a complete, independently safe markdown document', () => {
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

describe('paging oracle (full sweeps): private-use input', () => {
  const limits = [...SOME_LIMITS, 186, 100, 120, 160];

  it('the reviewer document and the private-use corpus lose no text at any page seam', () => {
    expect(PRIVATE_USE.length).toBeGreaterThan(1000);
    expect(run(PRIVATE_USE, limits)).toEqual([]);
  }, 900000);
});
