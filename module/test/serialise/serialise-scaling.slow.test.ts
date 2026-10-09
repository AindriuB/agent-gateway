// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { domToMarkdown } from '../../src/serialise/index.js';

describe('htmlToMarkdown scaling (min of several runs per size)', () => {
  // Minimum of several runs per size: background CPU load only ever adds time,
  // so the minimum is the least noisy estimate of the true cost.
  const RUNS = 7;
  const minTime = (run: () => number) => Math.min(...Array.from({ length: RUNS }, run));
  // [name, input builder, small n, large n (4x), min baseline ms, max allowed 4x ratio]
  // Linear code gives a ratio near 4; quadratic gives near 16. Table inputs that
  // exercise our flattener are timed on a pre-parsed DOM in the next test.
  it.each([
    ['unclosed anchors', (n: number) => '<a href="'.repeat(n), 8000, 32000, 5, 8],
    ['unclosed bold', (n: number) => '<b>'.repeat(n), 8000, 32000, 20, 8],
    ['unclosed UUIDs', (n: number) => '@UUID['.repeat(n), 32000, 128000, 2, 8],
    ['unclosed UUID labels', (n: number) => '@UUID[x]{'.repeat(n), 32000, 128000, 2, 8],
    [
      'long space run in pre',
      (n: number) => '<pre>' + ' '.repeat(n) + 'x</pre>',
      32000,
      128000,
      2,
      8,
    ],
    [
      'leading blank lines in pre',
      (n: number) => '<pre>\n' + '\n'.repeat(n) + 'x</pre>',
      50000,
      200000,
      2,
      8,
    ],
    [
      'leading blank lines in nested pre and code',
      (n: number) =>
        '<div><blockquote><pre><code>\n' + '\n'.repeat(n) + 'x</code></pre></blockquote></div>',
      50000,
      200000,
      2,
      8,
    ],
    [
      'leading blank lines in pre at page start after a table',
      (n: number) => '<table><tr><td>a</td></tr></table><pre>\n' + '\n'.repeat(n) + 'x</pre>',
      50000,
      200000,
      2,
      8,
    ],
    ['repeated spans of a space', (n: number) => '<span> </span>'.repeat(n), 8000, 32000, 5, 8],
    [
      'mixed closed and unclosed UUID labels',
      (n: number) => '@UUID[x]{a}@UUID[y]{'.repeat(n / 2),
      32000,
      128000,
      2,
      8,
    ],
  ] as const)(
    'adversarial input (%s) scales sub-quadratically',
    { timeout: 60000 },
    (_n, make, ns, nl, floor, max) => {
      // Parse once per size (untimed; keeps only two documents alive); time the serialiser alone.
      const timeOn = (n: number) => {
        const b = new DOMParser().parseFromString(make(n), 'text/html').body;
        return () => {
          const t = performance.now();
          domToMarkdown(b);
          return performance.now() - t;
        };
      };
      timeOn(500)(); // warm up
      const small = Math.max(minTime(timeOn(ns)), floor);
      const large = minTime(timeOn(nl));
      expect(large).toBeLessThan(5000);
      expect(large).toBeLessThan(small * max);
    },
  );
  // Parsed outside the timed region so only our walker is measured.
  const nested = (n: number) =>
    '<table><tr><td>x'.repeat(n) + 'leaf' + '</td></tr></table>'.repeat(n);
  const wide = (n: number) =>
    '<table><tr><td>o<table>' +
    '<tr><td>k</td><td>v</td></tr>'.repeat(n) +
    '</table></td></tr></table>';
  it.each([
    ['deeply nested tables', nested, 2000, 8000],
    ['wide nested table', wide, 5000, 20000],
  ] as const)('flattening %s scales sub-quadratically', { timeout: 60000 }, (_n, make, ns, nl) => {
    // Parse once per size (parsing is slow and untimed); walking is read-only.
    const timeOn = (n: number) => {
      const b = new DOMParser().parseFromString(make(n), 'text/html').body;
      return () => {
        const t = performance.now();
        domToMarkdown(b);
        return performance.now() - t;
      };
    };
    timeOn(200)(); // warm up
    const small = Math.max(minTime(timeOn(ns)), 3);
    const large = minTime(timeOn(nl));
    expect(large).toBeLessThan(3000);
    expect(large).toBeLessThan(small * 8);
  });
});
