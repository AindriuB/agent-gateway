/** Subtrees that never contribute readable text. */
const DROP = new Set([
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
/** Containers whose whitespace-only text children are layout, not content. */
const LAYOUT = new Set(['ul', 'ol', 'table', 'thead', 'tbody', 'tfoot', 'tr']);
const BLOCK = new Set(['p', 'div', 'section', 'article', 'blockquote', 'pre', 'dl', 'dt', 'dd']);
const MAX_DEPTH = 100;

/** Backslash-escape characters that could form markdown syntax (links, emphasis, code, tables, html). */
function escapeMd(text: string): string {
  return text
    .replace(/[\\[\]*_`|]/g, '\\$&')
    .replace(/<(?=[a-z/!?])/gi, '\\<')
    .replace(/^(\s*)([#>])/, '$1\\$2');
}

const SCHEMES = new Set(['http:', 'https:', 'mailto:']);
const BASE = 'https://relative.invalid/';

/** Decode HTML entities and backslash escapes the way a markdown reader would. */
function mdDecode(s: string): string {
  const ta = document.createElement('textarea');
  ta.innerHTML = s.replace(/</g, '&lt;');
  return ta.value.replace(/\\([!-/:-@[-`{-~])/g, '$1');
}

/** Classify a URL: allowed absolute, relative to the dummy base, or disallowed/unparsable. */
function classify(v: string): { kind: 'abs' | 'rel'; url: URL } | null {
  let url: URL;
  try {
    url = new URL(v, BASE);
  } catch {
    return null;
  }
  if (url.origin === new URL(BASE).origin) return { kind: 'rel', url };
  return SCHEMES.has(url.protocol) ? { kind: 'abs', url } : null;
}

/**
 * Percent-encode every character outside a strict safe set (markdown-special ones always).
 * `&` is emitted as `&amp;`, which a markdown reader decodes back to `&` (percent-encoding
 * it would change the URL's meaning). `[`/`]` inside the authority (IPv6 hosts) are kept;
 * the URL parser already constrains what can appear there.
 */
function encodeTarget(s: string): string {
  let out = '';
  const m = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i.exec(s);
  const authEnd = m ? m[0].length : 0;
  let i = 0;
  for (const ch of s) {
    const inAuthority = i < authEnd;
    i += ch.length;
    if (ch === '&') {
      out += '&amp;';
      continue;
    }
    if (inAuthority && (ch === '[' || ch === ']')) {
      out += ch;
      continue;
    }
    out += /[A-Za-z0-9\-._~:/?#@!$+,;=%]/.test(ch)
      ? ch
      : encodeURIComponent(ch).replace(
          /[!'()*]/g,
          (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
        ) || `%${ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return out;
}

/**
 * Return a safe link target built from the parsed URL, or null if the URL must be dropped.
 * Relative links are resolved against a dummy root, so deep `../` paths are normalised
 * (Foundry-internal references use `@UUID`). The test oracle disables GFM autolinks, so
 * bare URLs typed as text may still be autolinked by GFM readers (author-written http(s) only).
 * The raw href, and its markdown-decoded form, must both classify as allowed.
 */
function safeHref(raw: string | null | undefined): string | null {
  const href = raw?.trim();
  if (!href) return null;
  const decoded = mdDecode(href);
  const c = classify(href);
  const d = classify(decoded);
  if (!c || !d) return null;
  if (c.kind !== d.kind) return null;
  const { url } = c;
  let target = url.href;
  if (c.kind === 'rel') {
    // Keep it relative: fragment-only and query-only links stay so; paths keep a leading slash only if written.
    const tail = `${url.search}${url.hash}`;
    if (href.startsWith('#')) target = url.hash;
    else if (href.startsWith('?')) target = tail;
    else target = `${/^[/\\]/.test(href) ? url.pathname : url.pathname.slice(1)}${tail}`;
    // Collapsed dot-segments must not leave a protocol-relative `//host` target.
    if (target.startsWith('//')) target = `/.${target}`;
    // A colon in the first segment would read as a scheme; force a path.
    if (/^[^/?#]*:/.test(target)) target = `./${target}`;
  }
  return encodeTarget(target);
}

/** Replace `@UUID[uuid]{label}` with `label (uuid)`; all other text is passed through `esc`. */
function expandUuids(text: string, esc: (s: string) => string = escapeMd): string {
  const TAG = '@UUID[';
  let out = '';
  let i = 0;
  // Once a search finds no `}` there is none after any later position either; never rescan.
  let braceGone = false;
  for (;;) {
    const at = text.indexOf(TAG, i);
    if (at < 0) return out + esc(text.slice(i));
    const close = text.indexOf(']', at + TAG.length);
    if (close < 0) return out + esc(text.slice(i)); // no later tag can close either
    const uuid = text.slice(at + TAG.length, close);
    let end = close + 1;
    let label = uuid;
    if (uuid && text[end] === '{') {
      const brace = braceGone ? -1 : text.indexOf('}', end + 1);
      if (brace < 0) braceGone = true;
      if (brace >= 0) {
        label = text.slice(end + 1, brace) || uuid;
        end = brace + 1;
      }
    }
    if (!uuid) {
      out += esc(text.slice(i, close + 1));
    } else {
      out += `${esc(text.slice(i, at))}${esc(label)} (${esc(uuid)})`;
    }
    i = uuid ? end : close + 1;
  }
}

/** Iterative text collection, safe for arbitrarily deep trees. */
function plainText(root: Node): string {
  let out = '';
  const stack: Node[] = [root];
  while (stack.length) {
    const n = stack.pop()!;
    if (n.nodeType === 3) out += n.nodeValue ?? '';
    else if (n.nodeType === 1 && !DROP.has((n as Element).tagName.toLowerCase())) {
      const kids = n.childNodes;
      for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]!);
    }
  }
  return out;
}

const collapse = (s: string) => s.replace(/\s+/g, ' ');

const CELL_SEP = ' / ';
const ROW_SEP = '; ';
// Private-use markers for nested-table boundaries; become escaped brackets.
const OPEN = '\uE000';
const CLOSE = '\uE001';
// Marks the start of an emitted link so a literal `!` right before it can be escaped.
const LINK = '\uE002';

/**
 * Flatten a nested table to readable plain text in one linear, iterative pass.
 * Separators (" / " between cells, "; " between rows) are only emitted between
 * siblings, so literal `;` or `/` in cell text is never touched. Every table at
 * every depth is padded so it never glues onto neighbouring text. Link URLs and
 * markup inside nested tables are dropped.
 */
function flattenTable(root: Element): string {
  const parts: string[] = [];
  const END = Symbol('end');
  // One frame per open table: whether a row / cell has been seen yet.
  const frames: { rows: number; cells: number }[] = [];
  const stack: (Node | symbol)[] = [root];
  while (stack.length) {
    const n = stack.pop()!;
    if (typeof n === 'symbol') {
      frames.pop();
      parts.push(CLOSE, ' ');
      continue;
    }
    if (n.nodeType === 3) {
      parts.push((n.nodeValue ?? '').replace(/[\uE000\uE001]/g, ''));
      continue;
    }
    if (n.nodeType !== 1) continue;
    const tag = (n as Element).tagName.toLowerCase();
    if (DROP.has(tag)) continue;
    const frame = frames[frames.length - 1];
    if (tag === 'table') {
      parts.push(' ', OPEN);
      frames.push({ rows: 0, cells: 0 });
      stack.push(END);
    } else if (tag === 'tr' && frame) {
      if (frame.rows++ > 0) parts.push(ROW_SEP);
      frame.cells = 0;
    } else if ((tag === 'td' || tag === 'th') && frame) {
      if (frame.cells++ > 0) parts.push(CELL_SEP);
    }
    const kids = n.childNodes;
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]!);
  }
  const text = collapse(parts.join(''))
    .replace(/\uE001 +(?=\uE001)/g, CLOSE)
    .trim();
  if (!text) return '';
  const body = expandUuids(text).split(OPEN).join('\\[').split(CLOSE).join('\\]');
  return ` ${body} `;
}

function renderChildren(node: Node, depth: number, pre: boolean): string {
  let out = '';
  for (const child of Array.from(node.childNodes)) out += render(child, depth + 1, pre);
  return out;
}

function renderList(el: Element, ordered: boolean, depth: number): string {
  let n = 0;
  const items: string[] = [];
  for (const child of Array.from(el.children)) {
    if (child.tagName.toLowerCase() !== 'li') continue;
    n += 1;
    const text = renderChildren(child, depth, false)
      .trim()
      .replace(/\n{2,}/g, '\n')
      .replace(/\n/g, '\n  ');
    items.push(`${ordered ? `${n}.` : '-'} ${text}`);
  }
  return items.length ? `\n\n${items.join('\n')}\n\n` : '';
}

/** Rows owned by this table only: direct `tr` children and those of its own row groups. */
function ownRows(table: Element): Element[] {
  const rows: Element[] = [];
  for (const child of Array.from(table.children)) {
    const tag = child.tagName.toLowerCase();
    if (tag === 'tr') rows.push(child);
    else if (tag === 'thead' || tag === 'tbody' || tag === 'tfoot') {
      for (const tr of Array.from(child.children)) {
        if (tr.tagName.toLowerCase() === 'tr') rows.push(tr);
      }
    }
  }
  return rows;
}

let tableNesting = 0;

function renderTable(el: Element, depth: number): string {
  // A table inside a cell is flattened to plain text so work stays linear.
  if (tableNesting > 0) return flattenTable(el);
  tableNesting += 1;
  let rows: string[][];
  try {
    rows = ownRows(el).map((tr) =>
      Array.from(tr.children)
        .filter((c) => /^t[dh]$/i.test(c.tagName))
        .map((c) => collapse(renderChildren(c, depth, false)).trim()),
    );
  } finally {
    tableNesting -= 1;
  }
  if (!rows.length) return '';
  const width = Math.max(...rows.map((r) => r.length));
  const line = (r: string[]) =>
    `| ${Array.from({ length: width }, (_, i) => r[i] ?? '').join(' | ')} |`;
  const [head, ...rest] = rows as [string[], ...string[][]];
  const sep = `| ${Array.from({ length: width }, () => '---').join(' | ')} |`;
  return `\n\n${[line(head), sep, ...rest.map(line)].join('\n')}\n\n`;
}

/** Wrap content in delimiters, keeping its boundary whitespace outside them. */
function wrapInline(t: string, open: string, close: string): string {
  const core = t.trim();
  if (!core) return t;
  const lead = t.slice(0, t.length - t.trimStart().length);
  const trail = t.slice(t.trimEnd().length);
  return `${lead}${open}${core}${close}${trail}`;
}

function render(node: Node, depth: number, pre: boolean): string {
  if (node.nodeType === 3) {
    const raw = node.nodeValue ?? '';
    const parent = node.parentElement?.tagName.toLowerCase() ?? '';
    if (!pre && LAYOUT.has(parent) && !raw.trim()) return '';
    return expandUuids(pre ? raw : collapse(raw));
  }
  if (node.nodeType !== 1) return '';
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  if (DROP.has(tag)) return '';
  if (depth > MAX_DEPTH) return expandUuids(collapse(plainText(el)));

  const kids = () => renderChildren(el, depth, pre || tag === 'pre');
  switch (tag) {
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6':
      return `\n\n${'#'.repeat(Number(tag[1]))} ${collapse(kids()).trim()}\n\n`;
    case 'strong':
    case 'b': {
      return wrapInline(kids(), '**', '**');
    }
    case 'em':
    case 'i': {
      return wrapInline(kids(), '*', '*');
    }
    case 'a': {
      const t = kids();
      const href = safeHref(el.getAttribute('href'));
      if (!href) return t;
      return wrapInline(t, `${LINK}[`, `](${href})`);
    }
    case 'br':
      return '\n';
    case 'hr':
      return '\n\n---\n\n';
    case 'ul':
      return renderList(el, false, depth);
    case 'ol':
      return renderList(el, true, depth);
    case 'table':
      return renderTable(el, depth);
    case 'li':
      return `\n\n${kids()}\n\n`;
    default:
      return BLOCK.has(tag) ? `\n\n${kids()}\n\n` : kids();
  }
}

/**
 * Convert Foundry rich-text HTML to markdown by walking the browser's parsed DOM.
 * Keeps `@UUID[uuid]{label}` as `label (uuid)`; drops script/style and similar subtrees.
 */
export function htmlToMarkdown(html: string): string {
  const doc = new DOMParser().parseFromString(html ?? '', 'text/html');
  return domToMarkdown(doc.body);
}

/** Strip trailing spaces/tabs in one backwards scan (a `[ \t]+$` regex is quadratic). */
function trimEndBlanks(line: string): string {
  let end = line.length;
  while (end > 0 && (line.charCodeAt(end - 1) === 32 || line.charCodeAt(end - 1) === 9)) end--;
  return end === line.length ? line : line.slice(0, end);
}

/** Convert an already-parsed DOM subtree to markdown. */
export function domToMarkdown(root: Node): string {
  return render(root, 0, false)
    .replace(/!\uE002/g, '\\!')
    .replace(/\uE002/g, '')
    .split('\n')
    .map(trimEndBlanks)
    .join('\n')
    .replace(/\n\n[ \t]+/g, '\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
