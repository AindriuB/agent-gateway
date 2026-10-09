/**
 * Structured markdown: an ordered list of blocks, each a list of atomic segments.
 *
 * Every segment is complete, escaped markdown when it is produced, so a page built from
 * whole segments is always a complete, independently safe markdown document.
 */

/** One atomic piece of a block; never cut. */
export interface MdSegment {
  /** Complete, escaped markdown for this segment (a word run, a whole link, an emphasis span, ...). */
  md: string;
  /** Escaped plain text with formatting dropped; present on links and emphasis spans. Used when the span is larger than a page. */
  plain?: string;
  /** A line break inside the block (`<br>`). */
  br?: true;
  /** A table cell separator. */
  sep?: true;
  /** Longest run of backticks in a code line; the fence of a page is sized from the lines on it. */
  ticks?: number;
}

interface BlockBase {
  segs: MdSegment[];
}
export interface TextBlock extends BlockBase {
  kind: 'paragraph' | 'quote';
}
export interface HeadingBlock extends BlockBase {
  kind: 'heading';
  level: number;
}
export interface ItemBlock extends BlockBase {
  kind: 'item';
  /** `-` or `n.`. */
  marker: string;
  /** Nesting depth, 0 for top-level items. */
  depth: number;
  /** Id of the outermost list; consecutive items of one group are one list. */
  group: number;
}
export interface RowBlock extends BlockBase {
  kind: 'row';
  /** Id of the table this row belongs to. */
  table: number;
  /** 0 is the header row. */
  index: number;
  /** Column count of the table. */
  cols: number;
  /** The header row; absent on the header row itself. */
  head?: RowBlock;
}
export interface CodeBlock extends BlockBase {
  kind: 'code';
  /** One segment per line; `md` is the raw line. The fence is sized per page, see `fitCode`. */
}
export interface RuleBlock extends BlockBase {
  kind: 'rule';
}
export type MdBlock = TextBlock | HeadingBlock | ItemBlock | RowBlock | CodeBlock | RuleBlock;

export interface MdDocument {
  blocks: MdBlock[];
  /** Fingerprint of the content; cursors are bound to it. */
  id: string;
}

/** Private-use markers of the intermediate stream the renderer writes and `parseStream` reads. */
export const M = {
  BB: '', // block boundary
  BR: '', // line break
  SO: '', // span open: SO open-delim SB body SC close-delim SE
  SB: '',
  SC: '',
  SE: '',
  HO: '', // heading open: HO digit ... HC
  HC: '',
  LO: '', // list open / close
  LC: '',
  IO: '', // item open: IO marker IM ... IC
  IM: '',
  IC: '',
  TO: '', // table: TO (RO cell (CS cell)*)* TC
  RO: '',
  CS: '',
  TC: '',
  HR: '',
  PO: '', // preformatted open / close
  PC: '',
  QO: '', // blockquote open / close
  QC: '',
  LINK: '', // first character of a link's open delimiter
} as const;

/** Input text is stripped of every marker so it can never forge structure. */
export const stripMarkers = (s: string): string => s.replace(/[-]/g, '�');

const SPAN_MARKS = /[-]/g;
const BLOCK_MARKS = /[-]/g;

interface Frame {
  open: string;
  md: string;
  plain: string;
}

function pushWords(segs: MdSegment[], text: string): void {
  if (!text.trim()) {
    segs.push({ md: text });
    return;
  }
  const re = /\s*\S+\s*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) segs.push({ md: m[0] });
}

/** Strip trailing spaces/tabs in one backwards scan (a `[ \t]+$` regex is quadratic). */
function trimEndBlanks(line: string): string {
  let end = line.length;
  while (end > 0 && (line.charCodeAt(end - 1) === 32 || line.charCodeAt(end - 1) === 9)) end--;
  return end === line.length ? line : line.slice(0, end);
}

const tidy = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Split one inline run (text plus span markers) into atomic segments. Linear. */
export function segmentize(run: string): MdSegment[] {
  const raw: MdSegment[] = [];
  const frames: Frame[] = [];
  let text = '';
  const flushText = () => {
    if (text) pushWords(raw, text);
    text = '';
  };
  // A literal `!` right before a link would turn it into an image.
  const guardBang = () => {
    const top = frames[frames.length - 1];
    if (top) {
      if (top.md.endsWith('!')) top.md = `${top.md.slice(0, -1)}\\!`;
    } else if (text) {
      if (text.endsWith('!')) text = `${text.slice(0, -1)}\\!`;
    } else {
      const last = raw[raw.length - 1];
      if (last && !last.br && last.md.endsWith('!')) last.md = `${last.md.slice(0, -1)}\\!`;
    }
  };
  let i = 0;
  for (;;) {
    SPAN_MARKS.lastIndex = i;
    const m = SPAN_MARKS.exec(run);
    const end = m ? m.index : run.length;
    if (end > i) {
      const chunk = run.slice(i, end);
      const top = frames[frames.length - 1];
      if (top) {
        top.md += chunk;
        top.plain += chunk;
      } else text += chunk;
    }
    if (!m) break;
    const c = run[end];
    i = end + 1;
    const top = frames[frames.length - 1];
    if (c === M.BR) {
      if (top) {
        top.md += ' ';
        top.plain += ' ';
      } else {
        flushText();
        raw.push({ md: '\n', br: true });
      }
    } else if (c === M.SO) {
      const sb = run.indexOf(M.SB, i);
      if (sb < 0) break;
      const open = run.slice(i, sb);
      i = sb + 1;
      if (open.startsWith(M.LINK)) guardBang();
      frames.push({ open: open.replace(M.LINK, ''), md: '', plain: '' });
    } else if (c === M.SC) {
      const se = run.indexOf(M.SE, i);
      if (se < 0 || !top) break;
      const close = run.slice(i, se);
      i = se + 1;
      frames.pop();
      const md = top.open + top.md + close;
      const parent = frames[frames.length - 1];
      if (parent) {
        parent.md += md;
        parent.plain += top.plain;
      } else {
        flushText();
        raw.push({ md, plain: tidy(top.plain) });
      }
    }
  }
  flushText();
  // Trim: no leading or trailing breaks or blanks, no doubled breaks, no blanks beside breaks.
  const out: MdSegment[] = [];
  for (const sg of raw) {
    const last = out[out.length - 1];
    if (sg.br) {
      if (!last) continue;
      if (last.br) continue;
      if (!last.md.trim()) out.pop();
      out.push(sg);
    } else if (!sg.md.trim()) {
      if (!last || last.br) continue;
      out.push(sg);
    } else out.push(sg);
  }
  while (out.length && (out[out.length - 1]!.br || !out[out.length - 1]!.md.trim())) out.pop();
  return out;
}

/** FNV-1a over the whole document; binds a cursor to the document it came from. */
function fingerprint(blocks: MdBlock[]): string {
  let h = 0x811c9dc5;
  const mix = (s: string) => {
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    h ^= 0x1f;
    h = Math.imul(h, 0x01000193);
  };
  for (const b of blocks) {
    mix(b.kind);
    for (const sg of b.segs) mix(sg.md);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function makeDocument(blocks: MdBlock[]): MdDocument {
  return { blocks, id: fingerprint(blocks) };
}

interface ItemState {
  marker: string;
  depth: number;
  group: number;
  segs: MdSegment[];
  pendingBreak: boolean;
}

/** Parse the renderer's marker stream into blocks. Linear in the stream length. */
export function parseStream(stream: string): MdBlock[] {
  const blocks: MdBlock[] = [];
  const items: ItemState[] = [];
  let run = '';
  let heading = 0;
  let quote = 0;
  let groupDepth = 0;
  let groupId = 0;
  let tableId = 0;

  const emitItem = (it: ItemState) => {
    if (it.segs.length) {
      blocks.push({
        kind: 'item',
        marker: it.marker,
        depth: it.depth,
        group: it.group,
        segs: it.segs,
      });
      it.segs = [];
    }
    it.pendingBreak = false;
  };
  const addRun = (text: string) => {
    const segs = segmentize(text);
    if (!segs.length) return;
    const it = items[items.length - 1];
    if (it) {
      if (it.segs.length && it.pendingBreak) it.segs.push({ md: '\n', br: true });
      it.pendingBreak = false;
      for (const sg of segs) it.segs.push(sg);
    } else blocks.push({ kind: quote > 0 ? 'quote' : 'paragraph', segs });
  };
  const flush = () => {
    if (!run) return;
    const text = run;
    run = '';
    // Two line breaks in a row are a paragraph break.
    const parts = text.split(/\uE011(?:\s*\uE011)+/);
    parts.forEach((part, k) => {
      if (k > 0) {
        const it = items[items.length - 1];
        if (it) it.pendingBreak = true;
      }
      addRun(part);
    });
  };
  const standalone = () => {
    flush();
    const it = items[items.length - 1];
    if (it) emitItem(it);
  };

  let i = 0;
  for (;;) {
    BLOCK_MARKS.lastIndex = i;
    const m = BLOCK_MARKS.exec(stream);
    const end = m ? m.index : stream.length;
    if (end > i) run += stream.slice(i, end);
    if (!m) break;
    const c = stream[end]!;
    i = end + 1;
    switch (c) {
      case M.BB: {
        if (heading) {
          run += ' ';
          break;
        }
        flush();
        const it = items[items.length - 1];
        if (it) it.pendingBreak = true;
        break;
      }
      case M.HO:
        standalone();
        heading = Number(stream[i]) || 1;
        i += 1;
        break;
      case M.HC: {
        const segs = segmentize(run);
        run = '';
        if (heading && segs.length) blocks.push({ kind: 'heading', level: heading, segs });
        heading = 0;
        break;
      }
      case M.LO:
        if (groupDepth++ === 0) groupId += 1;
        break;
      case M.LC:
        groupDepth = Math.max(0, groupDepth - 1);
        break;
      case M.IO: {
        standalone();
        const im = stream.indexOf(M.IM, i);
        if (im < 0) break;
        items.push({
          marker: stream.slice(i, im),
          depth: items.length,
          group: groupId,
          segs: [],
          pendingBreak: false,
        });
        i = im + 1;
        break;
      }
      case M.IC: {
        flush();
        const it = items.pop();
        if (it) emitItem(it);
        break;
      }
      case M.TO: {
        standalone();
        const tc = stream.indexOf(M.TC, i);
        const body = stream.slice(i, tc < 0 ? stream.length : tc);
        i = tc < 0 ? stream.length : tc + 1;
        tableId += 1;
        const rows = body
          .split(M.RO)
          .slice(1)
          .map((r) => r.split(M.CS).map(segmentize));
        let cols = 0;
        for (const r of rows) if (r.length > cols) cols = r.length;
        let head: RowBlock | undefined;
        rows.forEach((cells, index) => {
          const segs: MdSegment[] = [];
          for (let c2 = 0; c2 < cols; c2++) {
            if (c2 > 0) segs.push({ md: '|', sep: true });
            const cell = cells[c2];
            if (cell?.length) for (const sg of cell) segs.push(sg);
            else segs.push({ md: '' });
          }
          const row: RowBlock = { kind: 'row', table: tableId, index, cols, segs };
          if (head) row.head = head;
          else head = row;
          blocks.push(row);
        });
        break;
      }
      case M.HR:
        standalone();
        blocks.push({ kind: 'rule', segs: [{ md: '---' }] });
        break;
      case M.PO: {
        standalone();
        const pc = stream.indexOf(M.PC, i);
        const body = stream.slice(i, pc < 0 ? stream.length : pc);
        i = pc < 0 ? stream.length : pc + 1;
        const lines = body.replace(/\r\n?/g, '\n').split('\n');
        while (lines.length && !lines[0]!.trim()) lines.shift();
        while (lines.length && !lines[lines.length - 1]!.trim()) lines.pop();
        if (!lines.length) break;
        blocks.push({
          kind: 'code',
          segs: lines.map((l) => {
            const md = trimEndBlanks(l);
            let ticks = 0;
            const runs = md.match(/`+/g);
            if (runs) for (const r of runs) if (r.length > ticks) ticks = r.length;
            return { md, ticks };
          }),
        });
        break;
      }
      case M.QO:
        flush();
        quote += 1;
        break;
      case M.QC:
        flush();
        quote = Math.max(0, quote - 1);
        break;
      default:
        break;
    }
  }
  standalone();
  while (items.length) emitItem(items.pop()!);
  return blocks;
}

/** Escape characters that could form markdown syntax (links, emphasis, strikethrough, code, tables, html, entities).
 * Every `<` and `&` is written as an entity (`&lt;`, `&amp;`), never as a backslash escape: a reader's autolink
 * can swallow a backslash and then expose the `<`, whereas an entity only ever decodes to text. This holds
 * unconditionally: text nodes are escaped one at a time, so a tag or entity split across nodes must not be
 * completed by the concatenation. Line-start constructs
 * (headings, quotes, lists, rules) are handled when a line is assembled, see `escapeLineStart`. */
export function escapeMd(text: string): string {
  // `![` is escaped as `\![` too: some readers un-escape link labels once and would then see an image.
  return text.replace(/!(?=\[)|[\\[\]*_`|~]|[<&]/g, (c) =>
    c === '<' ? '&lt;' : c === '&' ? '&amp;' : `\\${c}`,
  );
}

/**
 * Escape whatever at the START of a line could open a block: heading, quote, bullet, ordered
 * item, setext underline, table delimiter or fence. Applied to the first line of every page and
 * to every line after a break, so a cut never creates structure the source did not have.
 */
export function escapeLineStart(line: string): string {
  const c = line[0];
  if (c === '#' || c === '>' || c === '-' || c === '+' || c === '=' || c === '~' || c === ':')
    return `\\${line}`;
  const m = /^(\d{1,9})([.)])/.exec(line);
  return m ? `${m[1]}\\${line.slice(m[1]!.length)}` : line;
}

/** Plain text (not markdown) as a document: paragraphs on blank lines, every character escaped. */
export function textToDocument(text: string): MdDocument {
  const paras = stripMarkers(text ?? '')
    .replace(/\r\n?/g, '\n')
    .split(/\n[ \t]*\n/);
  let stream = '';
  for (const p of paras) {
    const lines = p
      .split('\n')
      .map((l) => escapeMd(l.replace(/\s+/g, ' ').trim()))
      .filter(Boolean);
    if (lines.length) stream += `${M.BB}${lines.join(M.BR)}${M.BB}`;
  }
  return makeDocument(parseStream(stream));
}
