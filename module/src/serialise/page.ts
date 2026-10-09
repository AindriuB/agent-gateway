import { SERIALISE_CONFIG } from './config.js';
import {
  escapeLineStart,
  textToDocument,
  type ItemBlock,
  type MdBlock,
  type MdDocument,
  type MdSegment,
  type RowBlock,
} from './structure.js';

export interface Page {
  /** A complete, independently safe markdown document. */
  chunk: string;
  /** Opaque cursor for the next page, or null at the end. */
  nextCursor: string | null;
}

/** Thrown for a cursor that is malformed, forged, from another document, or out of range. */
export class PageCursorError extends Error {
  constructor(message = 'invalid page cursor') {
    super(message);
    this.name = 'PageCursorError';
  }
}

interface Pos {
  b: number;
  s: number;
  w: number;
}

/** `p1.<document id>.<block>.<segment>.<word>`: a position between segments, never a character offset. */
const CURSOR_RE = /^p1\.([0-9a-f]{8})\.(\d{1,9})\.(\d{1,9})\.(\d{1,9})$/;
const encode = (doc: MdDocument, p: Pos) => `p1.${doc.id}.${p.b}.${p.s}.${p.w}`;

const wordCache = new WeakMap<MdSegment, string[]>();
/** The words of a span's plain text; a span larger than a page is paged as these. */
function plainWords(sg: MdSegment): string[] {
  let words = wordCache.get(sg);
  if (!words) {
    words = (sg.plain ?? '').split(' ').filter(Boolean);
    wordCache.set(sg, words);
  }
  return words;
}

function decode(doc: MdDocument, cursor: string | null | undefined): Pos {
  if (cursor === null || cursor === undefined || cursor === '') return { b: 0, s: 0, w: 0 };
  const m = typeof cursor === 'string' ? CURSOR_RE.exec(cursor) : null;
  if (!m || m[1] !== doc.id) throw new PageCursorError();
  const pos = { b: Number(m[2]), s: Number(m[3]), w: Number(m[4]) };
  const sg = doc.blocks[pos.b]?.segs[pos.s];
  if (!sg) throw new PageCursorError();
  if (pos.w > 0 && (sg.br || sg.sep || sg.plain === undefined || pos.w >= plainWords(sg).length))
    throw new PageCursorError();
  return pos;
}

interface Atom {
  md: string;
  seg: number;
  word: number;
  /** A line break precedes this atom. */
  br: boolean;
  sep: boolean;
}

/**
 * The units a page is packed from: whole segments, except a span larger than `maxSeg`
 * (or resumed mid-way), which becomes its plain words, formatting dropped.
 */
function* atomsOf(block: MdBlock, s: number, w: number, maxSeg: number): Generator<Atom> {
  const segs = block.segs;
  let br = false;
  for (let i = s; i < segs.length; i++) {
    const sg = segs[i]!;
    if (sg.br) {
      br = true;
      continue;
    }
    const start = i === s ? w : 0;
    if (!sg.sep && sg.plain !== undefined && (start > 0 || sg.md.length > maxSeg)) {
      const words = plainWords(sg);
      if (words.length) {
        for (let j = start; j < words.length; j++) {
          yield {
            md: j < words.length - 1 ? `${words[j]} ` : words[j]!,
            seg: i,
            word: j,
            br,
            sep: false,
          };
          br = false;
        }
        continue;
      }
    }
    yield { md: sg.md, seg: i, word: 0, br, sep: sg.sep === true };
    br = false;
  }
}

/**
 * Append `md` to a line. A literal `!` directly before an emitted `[` would turn the link into an
 * image, so it is escaped here, at assembly, whatever form (word run or plain fallback) either side took.
 */
function joinMd(cur: string, md: string): string {
  if (md.charCodeAt(0) === 91 && cur.endsWith('!')) {
    let k = cur.length - 1;
    while (k > 0 && cur.charCodeAt(k - 1) === 92) k--;
    // An even run of backslashes before the `!` leaves it unescaped.
    if ((cur.length - 1 - k) % 2 === 0) return `${cur.slice(0, -1)}\\!${md}`;
  }
  return cur + md;
}
/** One extra character where `joinMd` may escape a `!` (an upper bound; an already escaped `!` costs nothing). */
const bangCost = (prevMd: string, md: string): number =>
  md.charCodeAt(0) === 91 && prevMd.endsWith('!') ? 1 : 0;

/** A cut between two atoms is soft when whitespace or a line break already separates them. */
const soft = (prev: Atom, cur: Atom): boolean =>
  cur.br || prev.sep || cur.sep || /\s$/.test(prev.md) || /^\s/.test(cur.md);

interface Fit {
  text: string;
  complete: boolean;
  s: number;
  w: number;
}

interface Opts {
  room: number;
  limit: number;
  /** First block on the page: it is taken even if it does not fit. */
  must: boolean;
}

/** Cut a run of chosen atoms back to the nearest soft boundary when the cut would land inside a glued unit. */
function glue(chosen: Atom[], failed: Atom): Atom {
  if (chosen.length < 2 || soft(chosen[chosen.length - 1]!, failed)) return failed;
  for (let k = chosen.length - 1; k >= 1; k--) {
    if (soft(chosen[k - 1]!, chosen[k]!)) {
      const at = chosen[k]!;
      chosen.length = k;
      return at;
    }
  }
  return failed;
}

function prefixes(block: MdBlock, indent: number): [string, string] {
  switch (block.kind) {
    case 'heading':
      return [`${'#'.repeat(block.level)} `, ''];
    case 'quote':
      return ['> ', '> '];
    case 'item': {
      const pad = ' '.repeat(indent);
      return [`${pad}${block.marker} `, `${pad}${' '.repeat(block.marker.length + 1)}`];
    }
    default:
      return ['', ''];
  }
}

/** How many characters line-start escaping adds to a line that begins with `head`. */
const lsExtra = (head: string): number => escapeLineStart(head).length - head.length;
/** Enough of a line's start to decide its escaping (`123456789.` is the longest marker). */
const HEAD = 12;

function fitText(block: MdBlock, s: number, w: number, o: Opts, indent: number): Fit | null {
  const [first, cont] = prefixes(block, indent);
  // A heading's last `#` may need an escape, which costs one more character.
  const reserve = block.kind === 'heading' ? 1 : 0;
  const room = o.room - first.length - reserve;
  const maxSeg = o.limit - first.length - 1 - reserve;
  const escapes = block.kind !== 'rule';
  const chosen: Atom[] = [];
  let failed: Atom | null = null;
  let len = 0;
  let substantive = 0;
  let lineHas = false;
  let head = '';
  let extra = 0;
  let prevMd = '';
  for (const a of atomsOf(block, s, w, maxSeg)) {
    const newLine = a.br && chosen.length > 0;
    const lineStart = !lineHas || newLine;
    const md = lineStart ? a.md.trimStart() : a.md;
    // Exact cost: the escape depends on the first characters of the line, which may span atoms.
    let nextHead = newLine ? '' : head;
    if (nextHead.length < HEAD) nextHead = (nextHead + md).slice(0, HEAD);
    const prevExtra = newLine ? 0 : extra;
    const nextExtra = escapes && nextHead.trim() ? lsExtra(nextHead.trimStart()) : 0;
    const cost =
      md.length +
      (newLine ? 1 + cont.length : 0) +
      (nextExtra - prevExtra) +
      (newLine ? 0 : bangCost(prevMd, md));
    if ((substantive > 0 || !o.must) && len + cost > room) {
      failed = a;
      break;
    }
    if (newLine) lineHas = false;
    chosen.push(a);
    len += cost;
    head = nextHead;
    extra = nextExtra;
    if (md) prevMd = md;
    if (md.trim()) {
      substantive += 1;
      lineHas = true;
    }
  }
  if (failed && !o.must) return null;
  if (failed) failed = glue(chosen, failed);
  const lines: string[] = [];
  let cur = '';
  chosen.forEach((a, k) => {
    if (a.br && k > 0) {
      lines.push(cur);
      cur = '';
    }
    cur = joinMd(cur, cur === '' ? a.md.trimStart() : a.md);
  });
  lines.push(cur);
  const out = lines.map((l) => l.trim()).filter(Boolean);
  if (escapes) {
    for (let k = 0; k < out.length; k++) out[k] = escapeLineStart(out[k]!);
  }
  if (block.kind === 'heading' && out.length) {
    // A trailing run of `#` would be read as the heading's closing sequence.
    // Unless an earlier escape (a line that is only `#`) already covers it.
    const last = out.length - 1;
    const l = out[last]!;
    if (l.endsWith('#')) {
      let k = l.length - 1;
      while (k > 0 && l.charCodeAt(k - 1) === 92) k--;
      if ((l.length - 1 - k) % 2 === 0) out[last] = `${l.slice(0, -1)}\\#`;
    }
  }
  const text = out.map((l, k) => (k === 0 ? first : cont) + l).join('\n');
  return failed
    ? { text, complete: false, s: failed.seg, w: failed.word }
    : { text, complete: true, s: 0, w: 0 };
}

const sepLine = (cols: number): string =>
  `| ${Array.from({ length: cols }, () => '---').join(' | ')} |`;

const headCache = new WeakMap<RowBlock, string>();
/** The header row plus its delimiter row, with a trailing newline; repeated on a page that continues a table. */
function headerText(head: RowBlock): string {
  let t = headCache.get(head);
  if (t === undefined) {
    t = `${rowLine(head.segs, 0, head.cols)}\n${sepLine(head.cols)}\n`;
    headCache.set(head, t);
  }
  return t;
}

/** A row line; `segs` fill the cells from column `startCol`. Trailing cells the row lacks stay out
 * (GFM reads them as empty), except that the line has at least `minCells` cells. */
function rowLine(segs: { md: string; sep?: true }[], startCol: number, minCells: number): string {
  const cells: string[] = Array.from({ length: startCol }, () => '');
  let col = startCol;
  for (const sg of segs) {
    if (sg.sep) col += 1;
    else {
      while (cells.length <= col) cells.push('');
      cells[col] = joinMd(cells[col]!, sg.md);
    }
  }
  while (cells.length < Math.max(1, minCells)) cells.push('');
  return `| ${cells.map((c) => c.trim()).join(' | ')} |`;
}

function fitRow(block: RowBlock, s: number, w: number, o: Opts, needHeader: boolean): Fit | null {
  const head = block.index > 0 && needHeader && block.head ? headerText(block.head) : '';
  const tail = block.index === 0 ? `\n${sepLine(block.cols)}` : '';
  // `| ` + cells joined by ` | ` + ` |`: a row line carries its own cells; the header carries all columns.
  const overhead = 4 + 3 * (block.cells - 1) + head.length + tail.length;
  const room = o.room - overhead;
  const maxSeg = o.limit - overhead;
  const chosen: Atom[] = [];
  let failed: Atom | null = null;
  let len = 0;
  let substantive = 0;
  let prevMd = '';
  for (const a of atomsOf(block, s, w, maxSeg)) {
    const cost = a.sep ? 0 : a.md.length + bangCost(prevMd, a.md);
    prevMd = a.sep ? '' : a.md;
    if ((substantive > 0 || !o.must) && len + cost > room) {
      failed = a;
      break;
    }
    chosen.push(a);
    len += cost;
    if (!a.sep) substantive += 1;
  }
  if (failed && !o.must) return null;
  if (failed) failed = glue(chosen, failed);
  let from = 0;
  while (from < chosen.length && chosen[from]!.sep) from++;
  const kept = chosen.slice(from);
  let startCol = 0;
  if (kept.length) {
    const first = kept[0]!.seg;
    for (let i = 0; i < first; i++) if (block.segs[i]!.sep) startCol += 1;
  }
  const line = rowLine(
    kept.map((a) => ({ md: a.md, sep: a.sep ? (true as const) : undefined })),
    startCol,
    block.index === 0 ? block.cols : 0,
  );
  const text = `${head}${line}${tail}`;
  return failed
    ? { text, complete: false, s: failed.seg, w: failed.word }
    : { text, complete: true, s: 0, w: 0 };
}

function fitCode(block: MdBlock, s: number, o: Opts): Fit | null {
  const lines: string[] = [];
  let len = 0;
  // The fence is as long as the longest backtick run among the lines ON THIS PAGE, plus one (minimum 3).
  let fence = 3;
  let i = s;
  for (; i < block.segs.length; i++) {
    const sg = block.segs[i]!;
    const f = Math.max(fence, (sg.ticks ?? 0) + 1);
    const cost = sg.md.length + 1;
    if ((lines.length > 0 || !o.must) && len + cost + 2 * f + 2 > o.room) break;
    lines.push(sg.md);
    len += cost;
    fence = f;
  }
  const complete = i >= block.segs.length;
  if (!complete && !o.must) return null;
  const mark = '`'.repeat(fence);
  const text = `${mark}\n${lines.join('\n')}\n${mark}`;
  return { text, complete, s: complete ? 0 : i, w: 0 };
}

function separator(prev: MdBlock, block: MdBlock): string {
  if (prev.kind === 'item' && block.kind === 'item' && prev.group === block.group) return '\n';
  if (prev.kind === 'row' && block.kind === 'row' && prev.table === block.table) return '\n';
  return '\n\n';
}

interface Open {
  depth: number;
  offset: number;
}

/** Indent of an item: the content offsets of its ancestors that are on this page. */
function indentOf(stack: Open[], depth: number): number {
  let n = 0;
  for (const o of stack) if (o.depth < depth) n += o.offset;
  return n;
}

function build(doc: MdDocument, pos: Pos, limit: number): Page {
  const blocks = doc.blocks;
  const pieces: string[] = [];
  const stack: Open[] = [];
  let len = 0;
  let prev: MdBlock | null = null;
  let { b, s, w } = pos;
  while (b < blocks.length) {
    const block = blocks[b]!;
    const sep = prev ? separator(prev, block) : '';
    const o: Opts = { room: limit - len - sep.length, limit, must: pieces.length === 0 };
    let fit: Fit | null;
    if (block.kind === 'row') {
      const cont = prev?.kind === 'row' && prev.table === block.table;
      fit = fitRow(block, s, w, o, !cont);
    } else if (block.kind === 'code') fit = fitCode(block, s, o);
    else {
      if (block.kind === 'item') {
        if (prev?.kind !== 'item' || prev.group !== block.group) stack.length = 0;
      } else stack.length = 0;
      fit = fitText(block, s, w, o, block.kind === 'item' ? indentOf(stack, block.depth) : 0);
    }
    if (!fit) break;
    if (pieces.length) pieces.push(sep);
    pieces.push(fit.text);
    len += sep.length + fit.text.length;
    prev = block;
    if (block.kind === 'item') {
      const item: ItemBlock = block;
      while (stack.length && stack[stack.length - 1]!.depth >= item.depth) stack.pop();
      stack.push({ depth: item.depth, offset: item.marker.length + 1 });
    }
    if (fit.complete) {
      b += 1;
      s = 0;
      w = 0;
    } else {
      s = fit.s;
      w = fit.w;
      break;
    }
  }
  return {
    chunk: pieces.join(''),
    nextCursor: b < blocks.length ? encode(doc, { b, s, w }) : null,
  };
}

/** The whole document as one markdown string. */
export function documentToMarkdown(doc: MdDocument): string {
  return build(doc, { b: 0, s: 0, w: 0 }, Number.MAX_SAFE_INTEGER).chunk;
}

/**
 * Page a document. Every page is a complete, independently safe markdown document:
 * - pages are packed from whole blocks; a block larger than the limit is split only BETWEEN segments;
 * - a segment (word run, link, image, emphasis span, @UUID expansion) is never cut; a link or span larger
 *   than the limit is emitted as its plain escaped words, formatting dropped;
 * - a continued heading, item or quote repeats its marker, a continued code block closes and reopens its
 *   fence between lines, a continued table repeats its header row;
 * - the first line of a page and every line after a break is escaped so it cannot open a heading,
 *   quote, list, rule, fence or table.
 *
 * `limit` counts characters of the finished page including structural markup. A page exceeds it only
 * when its first atomic unit (one word, one code line, one table row with its header) plus that markup
 * does not fit; at least one unit is always emitted so paging terminates.
 * A word assembled from several segments may be split across two pages when it does not fit the
 * remaining room; nothing is lost and no construct is cut.
 *
 * The cursor is opaque and validated; an invalid or forged one throws `PageCursorError`.
 * A plain string is treated as text, not markdown, and escaped.
 */
export function page(
  source: MdDocument | string,
  cursor?: string | null,
  limit: number = SERIALISE_CONFIG.defaultPageSize,
): Page {
  const doc = typeof source === 'string' ? textToDocument(source) : source;
  const size = Number.isFinite(limit)
    ? Math.max(1, Math.floor(limit))
    : SERIALISE_CONFIG.defaultPageSize;
  return build(doc, decode(doc, cursor), size);
}
