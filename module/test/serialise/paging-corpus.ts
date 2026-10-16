// Corpus built from the table of paging hazards, plus a seeded fuzzer.

export const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Text that must stay inert, written as the author typed it (escaped when embedded in html). */
export const TEXT_PATTERNS: string[] = [
  '\\<',
  '\\[',
  '\\!',
  '\\*',
  '\\_',
  '\\\\',
  '&lt; &#60; &#x3c;',
  '&lt;',
  '&#60;',
  '&#x3c;',
  '[label](url)',
  '![alt](url)',
  '[label](http://ok.example/p)',
  '![alt](http://evil.example/i.png)',
  '[label](javascript:alert(1))',
  '`code`',
  '``` fence ```',
  '```',
  '~~~',
  '    indented code',
  '# heading',
  '> quote',
  '- item',
  '+ item',
  '* item',
  '1. item',
  '1) item',
  '- - -',
  '***',
  '___',
  '===',
  '---',
  '| a | b |',
  '|---|---|',
  ':---:',
  '<a href="x">',
  '<img src=x onerror=alert(1)>',
  '<iframe src=javascript:1>',
  '<svg onload=alert(1)>',
  '<!-- c -->',
  '<script>alert(1)</script>',
  '<https://evil.example/p>',
  'javascript:alert(1)',
  'JaVaScRiPt:alert(1)',
  'java\tscript:alert(1)',
  '&#106;avascript:alert(1)',
  'data:text/html,<b>x</b>',
  'vbscript:msgbox(1)',
  ' javascript:alert(1)',
  '\u0001javascript:alert(1)',
  'http://auto.example/link',
  'www.auto.example',
  'a@b.example',
  'x \\ y \\',
  '\\\\<img src=x>',
  '[a](b) ![c](d) [e]: f',
];

/** Raw html fragments written with entities, as they come out of the editor. */
export const HTML_PATTERNS: string[] = [
  '&lt;',
  '&#60;',
  '&#x3c;',
  '&amp;lt;',
  '&amp;#60;',
  '&lt;a href=x&gt;',
  '&lt;img src=x onerror=alert(1)&gt;',
  '&lt;iframe src=javascript:1&gt;&lt;/iframe&gt;',
  '&lt;svg onload=1&gt;',
];

/** Anchors with hostile and benign targets in encoded, mixed-case, whitespace and control forms. */
export const ANCHORS: string[] = [
  '<a href="javascript:alert(1)">t</a>',
  '<a href="JaVaScRiPt:alert(1)">t</a>',
  '<a href="java&#x09;script:alert(1)">t</a>',
  '<a href="&#106;avascript:alert(1)">t</a>',
  '<a href=" data:text/html,x">t</a>',
  '<a href="vbscript:x">t</a>',
  '<a href="&#1;javascript:1">t</a>',
  '<a href="java&Tab;script&colon;1">t</a>',
  '<a href="//evil.example/p">t</a>',
  '<a href="http://ok.example/a)b">t u</a>',
  '<a href="http://ok.example/">t u v</a>',
  '<a href="mailto:a@b.c">m</a>',
  '<a href="/rel">r</a>',
  '<a href="#f">f</a>',
  '<a href="http://ok.example/">![alt](http://evil.example/i.png)</a>',
  '<a href="http://ok.example/">[x](javascript:1)</a>',
];

const WRAPS: ((h: string) => string)[] = [
  (h) => `<p>${h}</p>`,
  (h) => `<p>first words ${h} last words here</p>`,
  (h) => `<p>word<br>${h}<br>${h}</p>`,
  (h) => `<p>${h}<br><br>${h}</p>`,
  (h) => `<ul><li>${h}</li><li>two ${h} three</li></ul>`,
  (h) => `<ol><li>${h}</li><li>${h} b</li></ol>`,
  (h) => `<ul><li>a<ul><li>${h}</li><li>b ${h}<br>${h}</li></ul></li></ul>`,
  (h) =>
    `<table><tr><th>${h}</th><th>H2</th></tr><tr><td>c ${h}</td><td>d</td></tr><tr><td>e</td><td>${h}</td></tr></table>`,
  (h) => `<h2>${h}</h2><p>${h}</p>`,
  (h) => `<blockquote>${h} ${h}</blockquote><p>x</p>`,
  (h) => `<pre>${h}\n${h}\n\n${h}</pre><p>after</p>`,
  (h) => `<p><b>${h} ${h}</b> <i>${h}</i></p>`,
  (h) => `<p><a href="http://ok.example/p">${h} ${h}</a> ${h}</p>`,
  (h) => `<p>${'filler '.repeat(3)}${h}</p>`,
  (h) => `<p>${'f'.repeat(17)} ${h}</p>`,
];

/** One text pattern in every context, and assembled from separate nodes. */
export function textCases(p: string): string[] {
  const h = esc(p);
  const out = WRAPS.map((w) => w(h));
  const chars = Array.from(p);
  out.push(`<p>${chars.map((c) => `<span>${esc(c)}</span>`).join('')}</p>`);
  out.push(`<ul><li>${chars.map((c) => `<b>${esc(c)}</b>`).join('')}</li></ul>`);
  for (const k of [1, 2, Math.floor(chars.length / 2), chars.length - 1]) {
    if (k < 1 || k >= chars.length) continue;
    const a = esc(chars.slice(0, k).join(''));
    const b = esc(chars.slice(k).join(''));
    out.push(`<p>${a}<b>${b}</b></p>`, `<p><i>${a}</i>${b}</p>`, `<p>${a}<span>${b}</span> x</p>`);
    out.push(`<table><tr><td>${a}</td><td>${b}</td></tr></table>`);
  }
  return out;
}

export function htmlCases(h: string): string[] {
  return [...WRAPS.map((w) => w(h)), `<p>${h.split(';').join(';<span></span>')}</p>`];
}

export function anchorCases(a: string): string[] {
  return [...WRAPS.map((w) => w(a)), `<p>x ${a}${a}!</p>`, `<p>!${a}</p>`, `<p><b>!</b>${a}</p>`];
}

/** Seeded generator of documents mixing the fragments above. */
export function fuzz(count: number, seed = 20261009): string[] {
  let s = seed >>> 0;
  const rnd = (n: number) => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return Math.floor((s / 4294967296) * n);
  };
  const pick = <T>(a: readonly T[]): T => a[rnd(a.length)]!;
  const words = [
    'alpha',
    'beta',
    'gamma',
    'x',
    'delta,',
    'ε',
    '\u{1F600}',
    'a-b',
    '#',
    '1.',
    '-',
    '>',
    '\uE010',
    '\uE012a@b.com',
    'baz![\uE011',
  ];
  const inline = (): string => {
    switch (rnd(7)) {
      case 0:
        return esc(pick(TEXT_PATTERNS));
      case 1:
        return pick(HTML_PATTERNS);
      case 2:
        return pick(ANCHORS);
      case 3:
        return `<b>${pick(words)} ${pick(words)}</b>`;
      case 4:
        return `<i>${esc(pick(TEXT_PATTERNS))}</i>`;
      case 5:
        return '<br>';
      default:
        return pick(words);
    }
  };
  const run = (n: number): string =>
    Array.from({ length: 1 + rnd(n) }, inline)
      .join(rnd(3) ? ' ' : '')
      .trim();
  const block = (): string => {
    switch (rnd(8)) {
      case 0: {
        const n = 1 + rnd(3);
        return `<h${n}>${run(4)}</h${n}>`;
      }
      case 1:
        return `<ul>${Array.from({ length: 1 + rnd(3) }, () => `<li>${run(4)}${rnd(4) ? '' : `<ul><li>${run(3)}</li></ul>`}</li>`).join('')}</ul>`;
      case 2:
        return `<ol>${Array.from({ length: 1 + rnd(3) }, () => `<li>${run(4)}</li>`).join('')}</ol>`;
      case 3:
        return `<table>${Array.from({ length: 1 + rnd(3) }, () => `<tr>${Array.from({ length: 1 + rnd(3) }, () => `<td>${run(3)}</td>`).join('')}</tr>`).join('')}</table>`;
      case 4:
        return `<blockquote>${run(5)}</blockquote>`;
      case 5:
        return `<pre>${esc(pick(TEXT_PATTERNS))}\n${esc(pick(TEXT_PATTERNS))}</pre>`;
      default:
        return `<p>${run(8)}</p>`;
    }
  };
  return Array.from({ length: count }, () => Array.from({ length: 1 + rnd(4) }, block).join(''));
}
