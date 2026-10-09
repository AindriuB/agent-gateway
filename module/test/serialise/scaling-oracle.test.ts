// @vitest-environment happy-dom
// Generic scaling oracle: every pattern in the corpora, repeated at size n and 4n in several
// shapes, through the FULL pipeline (DOM -> document -> markdown, and page() through every page).
// Growth must be near-linear (ratio ~4; quadratic would be ~16). Minimum of several runs per size,
// because background CPU load only ever adds time. Parsing is untimed and each DOM is dropped
// after use so only two documents are alive at once.
import { Window } from 'happy-dom';
import { describe, expect, it } from 'vitest';
import { documentToMarkdown, domToDocument, page } from '../../src/serialise/index.js';
import { BOUNDARIES, PRIVATE_USE, PROBES, SPACING, SPLIT_TAGS } from './corpus.js';
import { ANCHORS, HTML_PATTERNS, TEXT_PATTERNS, esc } from './paging-corpus.js';

const every = <T>(xs: T[], k: number) => xs.filter((_, i) => i % k === 0);

// Atoms that legitimately repeat without bound: whitespace, line breaks and the adversarial inputs
// from the hand-written scaling tests above.
const ATOMS = [
  '\n',
  ' ',
  ' \n',
  '\r\n',
  '\n\n',
  '&nbsp;',
  '<br>',
  '\t',
  'word ',
  '<a href="',
  '<b>',
  '@UUID[',
  '@UUID[x]{',
  '@UUID[x]{a}@UUID[y]{',
  '<span> </span>',
  '`',
  '|',
];

// [pattern, characters at the small size]. Cheap atoms get a large input, where even a cheap
// per-element cost (an array shift, an indexOf) shows; the corpus patterns are heavier per
// character and are sampled at a smaller one to keep the whole test within about 15 seconds.
const PATTERNS: [string, number][] = [
  ...ATOMS.map((p): [string, number] => [p, 30000]),
  ...[
    ...every(SPLIT_TAGS, 2),
    ...every(PROBES, 2),
    ...every(SPACING, 16),
    ...every(BOUNDARIES, 80),
    ...every(PRIVATE_USE, 80),
    ...every(ANCHORS, 2),
    ...HTML_PATTERNS,
    ...TEXT_PATTERNS.map(esc),
  ].map((p): [string, number] => [p, 1000]),
];

// scale: fraction of the input size used, for shapes that cost more per repeat.
type Shape = [name: string, build: (p: string, n: number) => string, scale?: number];
const SHAPES: Shape[] = [
  ['flat run', (p, n) => p.repeat(n)],
  // Leading content in a pre: a pre that starts with a long run of the pattern.
  ['inside pre', (p, n) => `<pre>\n${p.repeat(n)}x</pre>`],
  [
    'inside pre and code after a block',
    (p, n) => `<p>a</p><pre><code>\n\n${p.repeat(n)}</code></pre>`,
  ],
  ['table cell', (p, n) => `<table><tr><td>${p.repeat(n)}</td><td>z</td></tr></table>`],
  ['list items', (p, n) => `<ul>${`<li>${p}</li>`.repeat(n)}</ul>`, 0.05],
  ['nested wrapper', (p, n) => `${'<div>'.repeat(n)}${p}${'</div>'.repeat(n)}`, 0.05],
];

const RUNS = 5;
const LIMIT = 1000;
const BASE_MS = 4;
const MAX_RATIO = 10;

function pipeline(body: Node): number {
  const t = performance.now();
  const doc = domToDocument(body);
  documentToMarkdown(doc);
  let cursor: string | null = null;
  let pages = 0;
  do {
    cursor = page(doc, cursor, LIMIT).nextCursor;
    pages++;
  } while (cursor && pages < 100000);
  return performance.now() - t;
}

// Each document is parsed in its own happy-dom window and closed afterwards: the shared test
// window keeps every parsed document alive (about 0.5 KB of heap per input byte), which runs a
// corpus-wide test out of memory.
async function minTime(html: string): Promise<number> {
  const win = new Window();
  try {
    const body = new win.DOMParser().parseFromString(html, 'text/html').body as unknown as Node;
    pipeline(body); // warm up
    let best = Infinity;
    for (let i = 0; i < RUNS; i++) best = Math.min(best, pipeline(body));
    return best;
  } finally {
    await win.happyDOM.close();
  }
}

describe('scaling oracle over the corpora', () => {
  it.each(SHAPES)(
    'every pattern, shape %s, grows sub-quadratically',
    { timeout: 120000 },
    async (_name, build, scale = 1) => {
      const bad: string[] = [];
      for (const [p, chars] of PATTERNS) {
        if (!p) continue;
        const n = Math.max(2, Math.ceil((chars * scale) / p.length));
        const small = Math.max(await minTime(build(p, n)), BASE_MS);
        const large = await minTime(build(p, 4 * n));
        if (large >= 3000 || large >= small * MAX_RATIO) {
          bad.push(
            `${JSON.stringify(p.slice(0, 60))}: ${small.toFixed(1)}ms -> ${large.toFixed(1)}ms`,
          );
        }
      }
      expect(bad).toEqual([]);
    },
  );
});
