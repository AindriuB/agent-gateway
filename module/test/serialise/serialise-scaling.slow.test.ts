// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { domToMarkdown } from '../../src/serialise/index.js';
import { assessScaling, type Sample } from './scaling-fit.js';

describe('htmlToMarkdown scaling (log-log slope over five sizes)', () => {
  // Five sizes over a 16x span; the fit, its bound and the noise handling are in scaling-fit.ts.
  // Linear code has slope ~1, quadratic ~2. Parse once per size (untimed; parsing is slow and
  // walking is read-only) and time the serialiser alone.
  const ROUNDS = 7;
  const sampleOf =
    (make: (n: number) => string) =>
    (n: number): Sample => {
      const b = new DOMParser().parseFromString(make(n), 'text/html').body;
      return {
        run: () => {
          const t = performance.now();
          domToMarkdown(b);
          return performance.now() - t;
        },
      };
    };
  // [name, input builder, base n]: the smallest of five sizes; the largest is 16x the base.
  // Table inputs that exercise our flattener are timed in the next test.
  it.each([
    ['unclosed anchors', (n: number) => '<a href="'.repeat(n), 2000],
    ['unclosed bold', (n: number) => '<b>'.repeat(n), 2000],
    ['unclosed UUIDs', (n: number) => '@UUID['.repeat(n), 8000],
    ['unclosed UUID labels', (n: number) => '@UUID[x]{'.repeat(n), 8000],
    ['long space run in pre', (n: number) => '<pre>' + ' '.repeat(n) + 'x</pre>', 8000],
    ['leading blank lines in pre', (n: number) => '<pre>\n' + '\n'.repeat(n) + 'x</pre>', 12500],
    [
      'leading blank lines in nested pre and code',
      (n: number) =>
        '<div><blockquote><pre><code>\n' + '\n'.repeat(n) + 'x</code></pre></blockquote></div>',
      12500,
    ],
    [
      'leading blank lines in pre at page start after a table',
      (n: number) => '<table><tr><td>a</td></tr></table><pre>\n' + '\n'.repeat(n) + 'x</pre>',
      12500,
    ],
    ['repeated spans of a space', (n: number) => '<span> </span>'.repeat(n), 2000],
    [
      'mixed closed and unclosed UUID labels',
      (n: number) => '@UUID[x]{a}@UUID[y]{'.repeat(n / 2),
      8000,
    ],
  ] as const)(
    'adversarial input (%s) scales sub-quadratically',
    { timeout: 60000 },
    async (_n, make, base) => {
      const r = await assessScaling(base, sampleOf(make), ROUNDS);
      expect(r.largestMs).toBeLessThan(5000);
      expect(r.passed, r.report).toBe(true);
    },
  );
  const nested = (n: number) =>
    '<table><tr><td>x'.repeat(n) + 'leaf' + '</td></tr></table>'.repeat(n);
  const wide = (n: number) =>
    '<table><tr><td>o<table>' +
    '<tr><td>k</td><td>v</td></tr>'.repeat(n) +
    '</table></td></tr></table>';
  it.each([
    ['deeply nested tables', nested, 500],
    ['wide nested table', wide, 1250],
  ] as const)(
    'flattening %s scales sub-quadratically',
    { timeout: 60000 },
    async (_n, make, base) => {
      const r = await assessScaling(base, sampleOf(make), ROUNDS);
      expect(r.largestMs).toBeLessThan(3000);
      expect(r.passed, r.report).toBe(true);
    },
  );
});
