// Shared HTML corpora for the serialiser oracles.

export const SPACING: string[] = [];
for (const tag of ['strong', 'b', 'em', 'i', 'code', 'span', 'u'])
  for (const [a, b] of [
    ['Hello ', 'world'],
    ['Hello', ' world'],
    [' Hello ', 'world'],
    ['Hello ', ' world'],
  ] as const)
    SPACING.push(
      `<p><${tag}>${a}</${tag}>${b}</p>`,
      `<p>${a.trim()}<${tag}>${b === 'world' ? ' ' : ''}${b}</${tag}>x</p>`,
    );
for (const [a, b] of [
  ['Hello ', 'world'],
  ['Hello', ' world'],
  [' Hello ', ' world'],
] as const)
  SPACING.push(
    `<p><a href="https://a.example/p">${a}</a>${b}</p>`,
    `<p>${a}<a href="https://a.example/p">${b}</a>!</p>`,
    `<p><a href="javascript:1">${a}</a>${b}</p>`,
  );
SPACING.push(
  '<p><strong><em>a </em></strong>b</p>',
  '<p>a<strong> <em> b</em> </strong>c</p>',
  '<p><strong> </strong>x</p>',
  '<p>a<em> </em>b</p>',
  '<p><b>a<br></b>b</p>',
  '<p>one <a href="https://a.example/">two </a><i>three </i><b>four</b></p>',
  '<p>@UUID[Actor.abc]{Name } here</p>',
  '<ul><li><b>x </b>y</li></ul>',
  '<table><tr><td><b>x </b>y</td><td>z</td></tr></table>',
  '<script>bad words</script><p>ok</p><style>.x{}</style>',
);

export const SPLIT_TAGS = [
  '<p><span>&lt;</span>a href="javascript:alert(1)"&gt;click<span>&lt;</span>/a&gt;</p>',
  '<p><span>&lt;</span><span>a</span> href="javascript:alert(1)"&gt;x</p>',
  '<p>&lt;<b>a</b> href="javascript:alert(1)"&gt;x&lt;/<b>a</b>&gt;</p>',
  '<p>&lt;a hr<span>ef="javascript:alert(1)"</span>&gt;x</p>',
  '<p>&lt;a href=<span>"javascript:alert(1)"</span> onclick=<i>"x"</i>&gt;x</p>',
  '<p>&lt;<span>/</span>a&gt;</p>',
  '<p><span>&lt;</span>/<span>a</span>&gt;</p>',
  '<p><span>&lt;</span>!-- <span>hidden</span> --&gt;</p>',
  '<p>&lt;!<span>--</span> x --&gt;</p>',
  '<p><span>&lt;</span>![CDATA[<span>x</span>]]&gt;</p>',
  '<p>&lt;<span>![CDATA[</span>x]]&gt;</p>',
  '<p><span>&lt;</span>?php echo 1 ?&gt;</p>',
  '<p>&lt;?<span>xml</span> version="1.0"?&gt;</p>',
  '<p><span>&lt;</span>javascript:alert(1)&gt;</p>',
  '<p>&lt;<span>javascript:</span>alert(1)&gt;</p>',
  '<p><span>&lt;</span>https://evil.example/p&gt;</p>',
  '<p>&amp;lt;a href="javascript:alert(1)"&amp;gt;x</p>',
  '<p>&amp;<span>lt;</span>a href="javascript:alert(1)"&gt;x</p>',
  '<p>&amp;#60;a href="javascript:alert(1)"&gt;x</p>',
  '<p>&amp;#x3C;script&gt;alert(1)&amp;#x3C;/script&gt;</p>',
  '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>',
  '<p>&lt;div&gt;</p><p>x</p>',
  '<p>&lt;<span>img</span> src=x onerror=alert(1)&gt;</p>',
  '<ul><li>&lt;<b>a</b> href="javascript:1"&gt;x</li></ul>',
  '<table><tr><td>&lt;</td><td>a href="javascript:1"&gt;x&lt;</td><td>/a&gt;</td></tr></table>',
  '<table><tr><td><table><tr><td>&lt;</td><td>a href=x&gt;</td></tr></table></td></tr></table>',
  '<p>@UUID[Actor.a]{&lt;}a href="javascript:1"&gt;x</p>',
  '<p>&lt;@UUID[Actor.a]{a} href="javascript:1"&gt;x</p>',
  '<h2>&lt;<span>a</span> href=x&gt;</h2>',
  '<p>a &lt; b &amp; c &gt; d</p>',
];

export const PROBES = [
  '<a href="javascript\\:alert(1)">x</a>',
  '<a href="&amp;#106;avascript:alert(1)">x</a>',
  '<a href="&amp;#x6A;avascript:alert(1)">x</a>',
  '<a href="http://good.example/\\">a</a>@evil.example/p',
  '<a href="http://good.example/\\">a</a> @evil.example/p)',
  '<p>[x](javascript:1)</p>',
  `${'<div>'.repeat(120)}[x](javascript:1)${'</div>'.repeat(120)}`,
  `${'<div>'.repeat(120)}<a href="javascript:1">x</a>[y](javascript:2)${'</div>'.repeat(120)}`,
  '!<a href="http://a.example/p">img</a>',
  '<b>!</b><a href="http://a.example/p">img</a>',
  '<a href="javascript:alert(1)">x</a>',
  '<a href=" jav&#x09;ascript:alert(1)">x</a>',
  '<a href="data:text/html,x">x</a>',
  '<a href="vbscript:x">x</a>',
  '<a href="//evil.example/p">x</a>',
  '<a href="http://a.example/a)b(c">x</a>',
  '<a href="http://a.example/<x>">x</a>',
  '<a href="http://a.example/a b">x [y] z</a>',
  '<a href="mailto:a@b.c">m</a>',
  '<a href="/.//evil.example/p">x</a>',
  '<a href="/%2e//evil.example/p">x</a>',
  '<a href="/a/..//evil.example/p">x</a>',
  '<a href="https://a.example/p?a=1&amp;b=2">x</a>',
  '<a href="mailto:a@b.c?subject=s&amp;cc=d@e.f">x</a>',
  '<a href="https://[::1]:8080/p">x</a>',
  '<a href="/rel/x\\y">r</a>',
  '<a href="#frag">f</a>',
  '<a href="&colon;">x</a>',
  '<a href="java&Tab;script&colon;1">x</a>',
  '<p>![alt](http://evil.example/i.png)</p>',
  '<img src="http://evil.example/i.png" alt="a">',
  '<a href="http://a.example">[x](http://evil.example)</a>',
  '<a href="http://a.example">](http://evil.example) [</a>',
  '<table><tr><td>[x](javascript:1)</td></tr></table>',
  '<table><tr><td><table><tr><td><a href="javascript:1">q</a>[x](javascript:2)</td></tr></table></td></tr></table>',
  '<p>@UUID[x](javascript:1)</p>',
  '<p>@UUID[a]{[b](javascript:1)}</p>',
];

/** Two words separated only by a line break or a block-element boundary. */
const BOUNDARY_PAIRS = [
  'First<br>Second',
  'First<br><br><br>Second',
  'First<br/> <br>Second',
  '<p>First</p><p>Second</p>',
  '<div>First</div><div>Second</div>',
  'First<div>Second</div>',
  '<ul><li>First</li><li>Second</li></ul>',
  '<ol><li>First<li>Second</ol>',
  '<h2>First</h2><h3>Second</h3>',
  '<blockquote>First</blockquote>Second',
  '<pre>First</pre><pre>Second</pre>',
  'First<hr>Second',
  '<section>First</section><article>Second</article>',
  '<dl><dt>First</dt><dd>Second</dd></dl>',
  '<b>First</b><br><i>Second</i>',
];
const nestTable = (inner: string, depth: number): string => {
  let out = inner;
  for (let i = 0; i < depth; i++) out = `<table><tr><td>${out}</td></tr></table>`;
  return out;
};

/** Boundaries inside flattened content: nested table cells at depths 1..3 and other inline-only contexts. */
export const BOUNDARIES: string[] = [];
for (const pair of BOUNDARY_PAIRS) {
  for (const depth of [0, 1, 2, 3]) {
    BOUNDARIES.push(
      nestTable(pair, depth),
      `<table><tr><td>${nestTable(pair, depth)}</td><td>Third</td></tr></table>`,
    );
  }
  BOUNDARIES.push(
    `<h1>${pair}</h1>`,
    `<a href="https://a.example/p">${pair}</a>`,
    `<p><strong>${pair}</strong></p>`,
    `<table><tr><td>${pair}</td><td>Third</td></tr></table>`,
    `<ul><li><em>${pair}</em></li></ul>`,
    `${'<div>'.repeat(120)}${pair}${'</div>'.repeat(120)}`,
    `${'<span>'.repeat(120)}${pair}${'</span>'.repeat(120)}`,
  );
}

/** Every way a word boundary can sit inside one table cell (br, br runs, blocks, lists, headings, nested tables). */
const CELL_BOUNDARIES: string[] = [
  'First<br>Second',
  'First<br><br>Second',
  'First<br><br><br>Second',
  '<p>First</p><p>Second</p>',
  '<div>First</div><div>Second</div>',
  '<ul><li>First</li><li>Second</li></ul>',
  '<h2>First</h2><h3>Second</h3>',
  '<table><tr><td>First</td><td>Second</td></tr></table>',
  '<table><tr><td>First<br>Second</td></tr></table>',
];

/** Tables over the 64-column cap (flattened), each separator variant in the first, middle and last cell. */
export const WIDE_TABLES: string[] = [];
for (const cols of [65, 200]) {
  for (const cell of CELL_BOUNDARIES) {
    for (const at of [0, Math.floor(cols / 2), cols - 1]) {
      const tds = Array.from({ length: cols }, (_, c) => `<td>${c === at ? cell : `c${c}`}</td>`);
      WIDE_TABLES.push(`<table><tr>${tds.join('')}</tr></table>`);
    }
  }
}
BOUNDARIES.push(...WIDE_TABLES);

/**
 * The same cases followed by a paragraph that holds both words again. A glued `FirstSecond` in the
 * boundary must still fail: the decoy `Second` must not excuse it.
 */
BOUNDARIES.push(...BOUNDARIES.map((h) => `${h}<p>First Second</p>`));

/**
 * Private-use code points in input text. Every one the serialiser's intermediate stream uses (U+E000..U+E0FF
 * is reserved and replaced with U+FFFD on the way in) must be inert: no structure, no lost text, no glued words.
 */
export const PRIVATE_USE_POINTS: number[] = [
  ...Array.from({ length: 0x26 }, (_, i) => 0xe000 + i),
  0xe0ff,
  0xe100,
  0xf8ff,
];

const PU_NEIGHBOURS = ['@', '!', '[', '![', '](', 'a@b.com', 'http://ok.example/p', '`', '*', '|'];

/** The reviewer's fuzz document (limit 186), cut down to what matters. */
export const PRIVATE_USE_MINIMISED: string[] = [
  '<table><tr><td>+ a@b.com a@b.com</td><td>baz![ </td></tr><tr><td>&#xE010;&#xE012; x</td></tr></table>',
  '<table><tr><td>&#xE010;@UUID[Actor.abc]{Bob}</td><td>&#xE012; a@b.com a@b.com baz![</td></tr></table>',
  '<p>&#xE010;@a</p>',
];

export const PRIVATE_USE: string[] = [...PRIVATE_USE_MINIMISED];
for (const cp of PRIVATE_USE_POINTS) {
  const c = `&#x${cp.toString(16)};`;
  PRIVATE_USE.push(
    `<p>${c}</p>`,
    `<p>one ${c} two</p>`,
    `<p><b>${c}</b>tail</p>`,
    `<h2>head ${c} line</h2>`,
    `<ul><li>item ${c}<ul><li>${c} inner</li></ul></li></ul>`,
    `<table><tr><td>${c}</td><td>x ${c} y</td></tr><tr><td><table><tr><td>${c} deep</td></tr></table></td></tr></table>`,
    `<pre>pre ${c} text\nsecond ${c}</pre>`,
    `<p><code>code ${c} span</code></p>`,
    `<blockquote>quote ${c} text</blockquote>`,
    `<p><a href="https://ok.example/p${c}q">link ${c} label</a></p>`,
    `<p><img src="https://ok.example/i.png" alt="alt ${c} text"> after</p>`,
    `<p>@UUID[Actor.${c}abc]{Name ${c}}</p>`,
    `<p>${'x '.repeat(40)}${c} ${'y '.repeat(40)}</p>`,
  );
  for (const n of PU_NEIGHBOURS) {
    PRIVATE_USE.push(
      `<p>${c}${n} w</p>`,
      `<p>w ${n}${c}</p>`,
      `<p>w ${c} ${n} ${c} z</p>`,
      `<table><tr><td>${n}</td><td>${c}${n}</td></tr><tr><td>${n}${c}</td><td>w</td></tr></table>`,
    );
  }
}
