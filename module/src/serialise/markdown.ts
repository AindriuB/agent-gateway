const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
};

const decode = (s: string) => s.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => ENTITIES[m] ?? m);
const strip = (s: string) => s.replace(/<[^>]*>/g, '');

function convertTables(html: string): string {
  return html.replace(/<table\b[^>]*>([\s\S]*?)<\/table>/gi, (_m, body: string) => {
    const rows = [...body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((r) =>
      [...(r[1] ?? '').matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) =>
        inline(c[1] ?? '')
          .replace(/\s+/g, ' ')
          .replace(/\|/g, '\\|')
          .trim(),
      ),
    );
    if (!rows.length) return '';
    const width = Math.max(...rows.map((r) => r.length));
    const line = (r: string[]) =>
      `| ${Array.from({ length: width }, (_, i) => r[i] ?? '').join(' | ')} |`;
    const [head, ...rest] = rows as [string[], ...string[][]];
    const sep = `| ${Array.from({ length: width }, () => '---').join(' | ')} |`;
    return `\n\n${[line(head), sep, ...rest.map(line)].join('\n')}\n\n`;
  });
}

function inline(html: string): string {
  return html
    .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**')
    .replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, '*$2*')
    .replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)')
    .replace(/<br\s*\/?>/gi, '\n');
}

function convertLists(html: string): string {
  let out = html;
  // Innermost-first so nested lists work.
  const re = /<(ul|ol)\b[^>]*>((?:(?!<(?:ul|ol)\b)[\s\S])*?)<\/\1>/i;
  for (let m = re.exec(out); m; m = re.exec(out)) {
    const ordered = m[1]!.toLowerCase() === 'ol';
    let n = 0;
    const items = [...(m[2] ?? '').matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map((li) => {
      n += 1;
      const text = (li[1] ?? '').trim().replace(/\n/g, '\n  ');
      return `${ordered ? `${n}.` : '-'} ${text}`;
    });
    out = out.slice(0, m.index) + `\n\n${items.join('\n')}\n\n` + out.slice(m.index + m[0].length);
  }
  return out;
}

/** Convert Foundry rich-text HTML to markdown. Keeps `@UUID[uuid]{label}` as `label (uuid)`. */
export function htmlToMarkdown(html: string): string {
  let s = html ?? '';
  s = s.replace(
    /@UUID\[([^\]]+)\](?:\{([^}]*)\})?/g,
    (_m, uuid: string, label?: string) => `${label ?? uuid} (${uuid})`,
  );
  s = convertTables(s);
  s = s.replace(
    /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi,
    (_m, lvl: string, t: string) => `\n\n${'#'.repeat(Number(lvl))} ${strip(inline(t)).trim()}\n\n`,
  );
  s = inline(s);
  // Inline conversion of list items happens before list assembly.
  s = convertLists(s);
  s = s.replace(/<\/p>|<\/div>/gi, '\n\n').replace(/<hr\s*\/?>/gi, '\n\n---\n\n');
  s = decode(strip(s));
  return s
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
