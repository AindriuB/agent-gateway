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

interface Run {
  ms: number;
  /** Segments held by the document. */
  segments: number;
  /** Characters of all pages together. */
  bytes: number;
}

function pipeline(body: Node, limit = LIMIT): Run {
  const t = performance.now();
  const doc = domToDocument(body);
  documentToMarkdown(doc);
  let cursor: string | null = null;
  let pages = 0;
  let bytes = 0;
  do {
    const pg = page(doc, cursor, limit);
    bytes += pg.chunk.length;
    cursor = pg.nextCursor;
    pages++;
  } while (cursor && pages < 100000);
  let segments = 0;
  for (const b of doc.blocks) segments += b.segs.length;
  return { ms: performance.now() - t, segments, bytes };
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
    for (let i = 0; i < RUNS; i++) best = Math.min(best, pipeline(body).ms);
    return best;
  } finally {
    await win.happyDOM.close();
  }
}

async function sizes(html: string, limit = LIMIT): Promise<Run> {
  const win = new Window();
  try {
    const body = new win.DOMParser().parseFromString(html, 'text/html').body as unknown as Node;
    return pipeline(body, limit);
  } finally {
    await win.happyDOM.close();
  }
}

// Output must grow with the input. Between n and 4n the document and the pages together may hold
// at most MAX_SIZE_RATIO times as much (linear would be 4). A fixed offset can push the ratio of a
// small input over that (a repeated 120-deep wrapper adds 121 segments per copy but starts near
// zero), so a ratio over the bound only fails when the extra output per extra input character is
// also over a constant: SEGMENTS_PER_CHAR segments or BYTES_PER_CHAR page characters (a repeated
// table header, and `<` written as `&lt;`, are the legitimate multipliers).
const MAX_SIZE_RATIO = 6;
const SEGMENTS_PER_CHAR = 1;
const BYTES_PER_CHAR = 32;
async function sizeGrowth(label: string, small: string, large: string, limit = LIMIT) {
  const a = await sizes(small, limit);
  const b = await sizes(large, limit);
  const extra = Math.max(1, large.length - small.length);
  const bad: string[] = [];
  const check = (what: string, x: number, y: number, perChar: number) => {
    if (y > Math.max(x, 1) * MAX_SIZE_RATIO && (y - x) / extra > perChar) {
      bad.push(`${label}: ${what} ${x} -> ${y} for ${extra} more input characters`);
    }
  };
  check('segments', a.segments, b.segments, SEGMENTS_PER_CHAR);
  check('page bytes', a.bytes, b.bytes, BYTES_PER_CHAR);
  return bad;
}

const cells = (n: number, c = 'a') => `<td>${c}</td>`.repeat(n);
const row = (n: number, c?: string) => `<tr>${cells(n, c)}</tr>`;
// [name, html at size n, page limit]. Each is built at n and 4n.
const COMBOS: [string, (n: number) => string, number?][] = [
  ['wide row, then narrow rows', (n) => `<table>${row(n)}${row(1, 'b').repeat(n)}</table>`],
  ['narrow rows, then wide row', (n) => `<table>${row(1, 'b').repeat(n)}${row(n)}</table>`],
  [
    'wide row between narrow rows',
    (n) => `<table>${row(1).repeat(n)}${row(n)}${row(1).repeat(n)}</table>`,
  ],
  [
    'row widths 1..n',
    (n) => `<table>${Array.from({ length: n }, (_, i) => row(1 + (i % 8))).join('')}</table>`,
  ],
  ['just under the width cap', (n) => `<table>${row(64)}${row(1, 'b').repeat(n)}</table>`],
  ['just over the width cap', (n) => `<table>${row(65)}${row(1, 'b').repeat(n)}</table>`],
  ['many tables x narrow', (n) => `<table>${row(8)}${row(2)}</table>`.repeat(n)],
  [
    'many tables x over the cap',
    (n) => `<table>${row(70)}${row(1)}</table>`.repeat(Math.ceil(n / 10)),
  ],
  [
    'many tables, each wide then narrow',
    (n) => `<table>${row(30)}${row(1)}</table>`.repeat(Math.ceil(n / 4)),
  ],
  [
    'deep nesting x breadth',
    (n) => {
      const d = Math.ceil(n / 20);
      return `${'<div><p>w</p><ul><li>x</li><li>y</li></ul>'.repeat(d)}${'</div>'.repeat(d)}`;
    },
  ],
  [
    'nested tables x breadth',
    (n) => {
      const d = Math.ceil(n / 20);
      return `${'<table><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>'.repeat(d)}z${'</td></tr></table>'.repeat(d)}`;
    },
  ],
  ['wide header, paged small', (n) => `<table>${row(60)}${row(3, 'b').repeat(n)}</table>`, 50],
  [
    'wide header over the cap, paged small',
    (n) => `<table>${row(n)}${row(3, 'b').repeat(5)}</table>`,
    50,
  ],
  [
    'wide header and narrow rows over the cap',
    (n) => `<table>${row(70)}${row(1, 'b').repeat(n)}</table>`,
    50,
  ],
];

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

  it.each(SHAPES)(
    'every pattern, shape %s: document and pages grow at most linearly',
    { timeout: 120000 },
    async (_name, build, scale = 1) => {
      const bad: string[] = [];
      for (const [p, chars] of PATTERNS) {
        if (!p) continue;
        const n = Math.max(2, Math.ceil((chars * scale) / p.length));
        bad.push(
          ...(await sizeGrowth(JSON.stringify(p.slice(0, 60)), build(p, n), build(p, 4 * n))),
        );
      }
      expect(bad).toEqual([]);
    },
  );

  it.each(COMBOS)(
    'combinatorial shape %s: size and time grow at most linearly',
    { timeout: 120000 },
    async (name, build, limit = LIMIT) => {
      const n = 500;
      expect(await sizeGrowth(name, build(n), build(4 * n), limit)).toEqual([]);
      const small = Math.max(await minTime(build(n)), BASE_MS);
      const large = await minTime(build(4 * n));
      expect(large < 3000 && large < small * MAX_RATIO, `${small}ms -> ${large}ms`).toBe(true);
    },
  );
});
