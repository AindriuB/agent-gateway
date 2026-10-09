// Oracle for paged markdown. Shared by the corpus tests; takes the pager as a parameter so the
// same checks can be pointed at any implementation.
import MarkdownIt from 'markdown-it';
import { Marked, type Token } from 'marked';
import type { MdDocument } from '../../src/serialise/index.js';

export type Pager = (
  doc: MdDocument,
  cursor: string | null,
  limit: number,
) => { chunk: string; nextCursor: string | null };

const ALLOWED_SCHEMES = new Set(['http:', 'https:', 'mailto:']);
const BASE = 'https://relative.invalid/';
const mdit = new MarkdownIt({ html: true });
const marked = new Marked({ gfm: true, tokenizer: { url: () => undefined } });

const allowedHref = (href: string): boolean => {
  try {
    const u = new URL(href, BASE);
    return u.origin === new URL(BASE).origin || ALLOWED_SCHEMES.has(u.protocol);
  } catch {
    return false;
  }
};
const norm = (h: string): string => {
  try {
    const u = new URL(h, BASE).href;
    try {
      return decodeURIComponent(u);
    } catch {
      return u;
    }
  } catch {
    return h;
  }
};

/** Element and attribute allowlist for rendered pages. The serialiser emits no images and no raw html. */
const TAGS = new Set([
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
  'blockquote',
  'pre',
  'code',
  'em',
  'strong',
  'a',
  'br',
  'hr',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
]);
/** Block types a page must not introduce. Inline emphasis may flank differently once cut, which is not a block change. */
const BLOCK_TYPES = new Set([
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
  'blockquote',
  'pre',
  'code',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'hr',
]);
const ATTRS: Record<string, Set<string>> = { a: new Set(['href']), ol: new Set(['start']) };

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" };
const decodeEnt = (s: string) => s.replace(/&(amp|lt|gt|quot|#39);/g, (_m, e: string) => ENT[e]!);

export interface Rendered {
  tags: Set<string>;
  hrefs: string[];
  words: string[];
  problems: string[];
}

/** Render markdown with markdown-it (html: true) and check it against the allowlist. */
export function renderChecked(md: string): Rendered {
  const out = mdit.render(md);
  const tags = new Set<string>();
  const hrefs: string[] = [];
  const problems: string[] = [];
  const re = /<([^>]*)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(out))) {
    const t = /^(\/?)([a-zA-Z][a-zA-Z0-9]*)([^]*?)\/?$/.exec(m[1]!);
    if (!t) {
      problems.push(`unparsable tag <${m[1]}>`);
      continue;
    }
    const tag = t[2]!.toLowerCase();
    if (!TAGS.has(tag)) problems.push(`element <${tag}>`);
    tags.add(tag);
    if (t[1]) continue;
    const attrs = t[3]!;
    let rest = attrs;
    const ar = /\s+([a-zA-Z-]+)="([^"]*)"/g;
    let a: RegExpExecArray | null;
    while ((a = ar.exec(attrs))) {
      rest = rest.replace(a[0], '');
      if (!ATTRS[tag]?.has(a[1]!.toLowerCase())) problems.push(`attribute ${a[1]} on <${tag}>`);
      if (tag === 'a') hrefs.push(decodeEnt(a[2]!));
    }
    if (rest.trim()) problems.push(`unparsed attributes ${JSON.stringify(rest)} on <${tag}>`);
  }
  // Inline elements glue their text to its neighbours; every other tag separates words.
  const text = out.replace(/<\/?(strong|em|a|code)(\s[^>]*)?>/g, '').replace(/<[^>]*>/g, ' ');
  // Emphasis next to punctuation or a word may not flank, so its asterisks can stay literal; ignore them.
  const words = decodeEnt(text).replace(/\*/g, '').split(/\s+/).filter(Boolean);
  return { tags, hrefs, words, problems };
}

interface Nested {
  tokens?: Token[];
  items?: Token[];
  header?: { tokens: Token[] }[];
  rows?: { tokens: Token[] }[][];
}
function walk(tokens: Token[], visit: (t: Token) => void): void {
  for (const t of tokens) {
    visit(t);
    const c = t as Nested;
    if (c.tokens) walk(c.tokens, visit);
    if (c.items) walk(c.items, visit);
    if (c.header) for (const h of c.header) walk(h.tokens, visit);
    if (c.rows) for (const r of c.rows) for (const cell of r) walk(cell.tokens, visit);
  }
}

/** Hrefs of the real anchors in the input html, as the browser's DOM reports them. */
export function anchorsOf(html: string): string[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return Array.from(doc.querySelectorAll('a[href]')).map((a) => a.getAttribute('href')!);
}

const DROPPED = new Set([
  'script',
  'style',
  'template',
  'noscript',
  'iframe',
  'object',
  'embed',
  'head',
  'title',
  'meta',
  'link',
  'svg',
  'canvas',
  'audio',
  'video',
]);
const INLINE = new Set([
  'a',
  'b',
  'strong',
  'i',
  'em',
  'code',
  'span',
  'u',
  'sub',
  'sup',
  'mark',
  'small',
  's',
]);

/** Whitespace-normalised word tokens of the input's text, skipping dropped subtrees. */
export function inputWords(html: string): string[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  let out = '';
  const go = (n: Node): void => {
    if (n.nodeType === 3) out += n.nodeValue ?? '';
    else if (n.nodeType === 1) {
      const tag = (n as Element).tagName.toLowerCase();
      if (DROPPED.has(tag)) return;
      const sep = INLINE.has(tag) ? '' : ' ';
      out += sep;
      n.childNodes.forEach(go);
      out += sep;
    }
  };
  go(doc.body);
  out = out.replace(/@UUID\[[^\]]*\](?:\{([^}]*)\})?/g, ' $1 ');
  return out.split(/\s+/).filter(Boolean);
}

/** True when every char of `needle` occurs in `hay` in order. */
export function subsequence(needle: string, hay: string): boolean {
  let i = 0;
  for (let j = 0; j < hay.length && i < needle.length; j++) if (hay[j] === needle[i]) i++;
  return i === needle.length;
}

export interface Subject {
  html: string;
  anchors: string[];
  fullTags: Set<string>;
  hasImg: boolean;
}

export function subjectOf(html: string, fullMd: string): Subject {
  return {
    html,
    anchors: anchorsOf(html),
    fullTags: renderChecked(fullMd).tags,
    hasImg: /<img\b/i.test(html),
  };
}

/**
 * Check one page ALONE: marked finds no html token and only links that are real input anchors;
 * markdown-it (html: true) renders only allowlisted elements and attributes, no images, only
 * input anchors, and no block type the whole document does not have.
 */
export function pageProblems(chunk: string, s: Subject): { problems: string[]; words: string[] } {
  const problems: string[] = [];
  const known = new Set(s.anchors.filter(allowedHref).map(norm));
  const checkHref = (where: string, href: string) => {
    if (!allowedHref(href)) problems.push(`${where}: disallowed href ${href}`);
    else if (!known.has(norm(href))) problems.push(`${where}: href ${href} is not an input anchor`);
  };
  walk(marked.lexer(chunk), (t) => {
    if (t.type === 'html') problems.push(`marked html token ${JSON.stringify(t.raw)}`);
    if (t.type === 'image') problems.push(`marked image ${JSON.stringify(t.raw)}`);
    if (t.type === 'link') {
      const ta = (t as { href: string }).href;
      // CommonMark decodes entities and escapes in targets; marked leaves them raw.
      checkHref('marked link', decodeEnt(ta).replace(/\\([!-/:-@[-`{-~])/g, '$1'));
    }
  });
  const r = renderChecked(chunk);
  for (const p of r.problems) problems.push(`markdown-it: ${p}`);
  for (const h of r.hrefs) checkHref('markdown-it link', h);
  for (const t of r.tags) {
    if (BLOCK_TYPES.has(t) && !s.fullTags.has(t))
      problems.push(`new block type <${t}> not in the document`);
  }
  return { problems, words: r.words };
}

/**
 * Walk every page of a document at every limit and collect problems. Checks per page (alone), coverage
 * of the input's words in order, cursor round trips, termination and the size contract.
 */
export function checkDocument(
  html: string,
  limits: readonly number[],
  pager: Pager,
  makeDoc: (html: string) => MdDocument,
  toMarkdown: (doc: MdDocument) => string,
): string[] {
  const failures: string[] = [];
  const fail = (m: string) => {
    if (failures.length < 6) failures.push(`${JSON.stringify(html.slice(0, 300))}: ${m}`);
  };
  const doc = makeDoc(html);
  const full = toMarkdown(doc);
  const subject = subjectOf(html, full);
  const cache = new Map<string, { problems: string[]; words: string[] }>();
  const inWords = inputWords(html)
    .map((w) => w.replace(/\*/g, ''))
    .filter(Boolean);
  const inJoined = inWords.join('');
  for (const limit of limits) {
    let cursor: string | null = null;
    const seen = new Set<string>();
    const words: string[] = [];
    let pages = 0;
    do {
      const p = pager(doc, cursor, limit);
      pages += 1;
      if (pages > full.length + 5) {
        fail(`limit ${limit}: paging does not terminate`);
        break;
      }
      let res = cache.get(p.chunk);
      if (!res) {
        res = pageProblems(p.chunk, subject);
        cache.set(p.chunk, res);
      }
      for (const pr of res.problems) fail(`limit ${limit}, page ${JSON.stringify(p.chunk)}: ${pr}`);
      for (const w of res.words) words.push(w);
      if (p.chunk.length > limit) {
        const minimal = pager(doc, cursor, 1).chunk;
        if (p.chunk !== minimal)
          fail(
            `limit ${limit}: page of ${p.chunk.length} chars exceeds the limit without being one atomic unit`,
          );
      }
      if (p.nextCursor !== null) {
        if (seen.has(p.nextCursor)) fail(`limit ${limit}: cursor ${p.nextCursor} repeats`);
        seen.add(p.nextCursor);
        const again = pager(doc, p.nextCursor, limit);
        const twice = pager(doc, p.nextCursor, limit);
        if (again.chunk !== twice.chunk || again.nextCursor !== twice.nextCursor)
          fail(`limit ${limit}: cursor ${p.nextCursor} is not deterministic`);
      }
      cursor = p.nextCursor;
    } while (cursor);
    if (!subsequence(inJoined, words.join('')))
      fail(
        `limit ${limit}: pages lost input text; input ${JSON.stringify(inWords.join(' '))} output ${JSON.stringify(words.join(' '))}`,
      );
    else if (limit >= 1000) {
      let i = 0;
      for (const w of inWords) {
        while (i < words.length && !words[i]!.includes(w)) i++;
        if (i >= words.length) {
          fail(`limit ${limit}: word ${JSON.stringify(w)} lost or out of order`);
          break;
        }
        i++;
      }
    }
  }
  return failures;
}
