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

/** Replace `@UUID[uuid]{label}` with `label (uuid)` using linear scans only. */
function expandUuids(text: string): string {
  const TAG = '@UUID[';
  let out = '';
  let i = 0;
  for (;;) {
    const at = text.indexOf(TAG, i);
    if (at < 0) return out + text.slice(i);
    const close = text.indexOf(']', at + TAG.length);
    if (close < 0) return out + text.slice(i); // no later tag can close either
    const uuid = text.slice(at + TAG.length, close);
    let end = close + 1;
    let label = uuid;
    if (uuid && text[end] === '{') {
      const brace = text.indexOf('}', end + 1);
      if (brace >= 0) {
        label = text.slice(end + 1, brace) || uuid;
        end = brace + 1;
      }
    }
    if (!uuid) {
      out += text.slice(i, close + 1);
    } else {
      out += `${text.slice(i, at)}${label} (${uuid})`;
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
  if (tableNesting > 0) return collapse(plainText(el));
  tableNesting += 1;
  let rows: string[][];
  try {
    rows = ownRows(el).map((tr) =>
      Array.from(tr.children)
        .filter((c) => /^t[dh]$/i.test(c.tagName))
        .map((c) =>
          collapse(renderChildren(c, depth, false))
            .replace(/\|/g, '\\|')
            .trim(),
        ),
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
  if (depth > MAX_DEPTH) return collapse(plainText(el));

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
      const t = kids();
      return t.trim() ? `**${t.trim()}**` : t;
    }
    case 'em':
    case 'i': {
      const t = kids();
      return t.trim() ? `*${t.trim()}*` : t;
    }
    case 'a': {
      const t = kids();
      const href = el.getAttribute('href')?.trim();
      // eslint-disable-next-line no-control-regex
      const scheme = (href ?? '').replace(/[\u0000-\u0020\u007f]/g, '').toLowerCase();
      if (!href || /^(javascript|data|vbscript):/.test(scheme) || !t.trim()) return t;
      return `[${t.trim()}](${href})`;
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
  return render(doc.body, 0, false)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n\n[ \t]+/g, '\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
