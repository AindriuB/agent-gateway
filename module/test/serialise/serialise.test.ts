// @vitest-environment happy-dom
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, describe, expect, it } from 'vitest';
import {
  htmlToMarkdown,
  page,
  serialiseDocument,
  SERIALISE_CONFIG,
} from '../../src/serialise/index.js';
import { installFoundry, type FoundryStub } from '../stubs/foundry.js';

let stub: FoundryStub;
afterEach(() => stub?.uninstall());

const doc = {
  name: 'Bob',
  flags: { core: { a: 1 }, dnd5e: { b: 2 }, 'agent-gateway': { c: 3 }, other: { d: 4 } },
};

function setup(optIn: boolean) {
  stub = installFoundry(14);
  (globalThis as any).game.system = { id: 'dnd5e' };
  stub.registeredSettings.set('agent-gateway.includeOtherModuleData', {
    name: '',
    scope: 'world',
    config: true,
    type: Boolean,
    default: optIn,
  });
}

describe('serialiseDocument', () => {
  it('strips other modules flags by default', () => {
    setup(false);
    const out = serialiseDocument({ toObject: () => doc }, { includeOtherModuleData: false });
    expect(Object.keys(out.flags as object).sort()).toEqual(['agent-gateway', 'core', 'dnd5e']);
    expect(serialiseDocument(doc)).toEqual(out);
  });
  it('keeps everything when GM opted in', () => {
    setup(true);
    const out = serialiseDocument(doc, { includeOtherModuleData: true });
    expect(Object.keys(out.flags as object)).toContain('other');
    expect(Object.keys(serialiseDocument(doc).flags as object)).toContain('other');
  });
  it('does not mutate the source', () => {
    setup(false);
    serialiseDocument(doc, { includeOtherModuleData: false });
    expect(doc.flags.other).toBeDefined();
  });
});

describe('htmlToMarkdown', () => {
  it('headings, emphasis, links', () => {
    expect(
      htmlToMarkdown(
        '<h2>Title</h2><p>A <strong>bold</strong> and <em>it</em> <a href="http://x.y">link</a>.</p>',
      ),
    ).toBe('## Title\n\nA **bold** and *it* [link](http://x.y).');
  });
  it('lists', () => {
    expect(htmlToMarkdown('<ul><li>one</li><li>two</li></ul><ol><li>a</li><li>b</li></ol>')).toBe(
      '- one\n- two\n\n1. a\n2. b',
    );
  });
  it('tables', () => {
    expect(
      htmlToMarkdown('<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>'),
    ).toBe('| A | B |\n| --- | --- |\n| 1 | 2 |');
  });
  it('UUID enrichers keep label and uuid', () => {
    expect(htmlToMarkdown('<p>See @UUID[Actor.abc123]{Goblin} and @UUID[Item.xyz]</p>')).toBe(
      'See Goblin (Actor.abc123) and Item.xyz (Item.xyz)',
    );
  });
  it('decodes entities and strips unknown tags', () => {
    expect(htmlToMarkdown('<span>a &amp; b</span>')).toBe('a & b');
  });
  it('drops script, style, template and noscript content', () => {
    const out = htmlToMarkdown(
      '<script>alert(1)</script><style>p{x:y}</style><template>tpl</template><noscript>ns</noscript><p>hi</p>',
    );
    expect(out).toBe('hi');
  });
  it('keeps a literal < in text', () => {
    expect(htmlToMarkdown('<p>a < b and c > d</p>')).toBe('a < b and c > d');
  });
  it('keeps single-quoted and unquoted hrefs', () => {
    expect(htmlToMarkdown("<a href='http://a.example/x'>one</a>")).toBe(
      '[one](http://a.example/x)',
    );
    expect(htmlToMarkdown('<a href=http://b.example/y>two</a>')).toBe('[two](http://b.example/y)');
  });
  it.each([
    ['unclosed anchors', (n: number) => '<a href="'.repeat(n)],
    ['unclosed bold', (n: number) => '<b>'.repeat(n)],
    ['unclosed tables', (n: number) => '<table>'.repeat(n)],
    ['unclosed UUIDs', (n: number) => '@UUID['.repeat(n)],
  ])('adversarial input (%s) scales sub-quadratically', (_n, make) => {
    const time = (n: number) => {
      const t = performance.now();
      htmlToMarkdown(make(n));
      return performance.now() - t;
    };
    time(500); // warm up
    const small = Math.max(time(1000), 5);
    const large = time(4000);
    expect(large).toBeLessThan(2000);
    expect(large).toBeLessThan(small * 16);
  });
  it('renders nested tables linearly, inner content once', () => {
    expect(
      htmlToMarkdown(
        '<table><tr><td>a<table><tr><td>inner</td></tr></table></td></tr></table>',
      ).split('inner').length - 1,
    ).toBe(1);
    const deep = (n: number) =>
      '<table><tr><td>x'.repeat(n) + 'leaf' + '</td></tr></table>'.repeat(n);
    const t = performance.now();
    const out = htmlToMarkdown(deep(25));
    expect(performance.now() - t).toBeLessThan(2000);
    expect(out.length).toBeLessThan(deep(25).length);
    expect(out.split('leaf').length - 1).toBe(1);
  });
  it('keeps whitespace between inline siblings under body', () => {
    expect(htmlToMarkdown('<strong>Name:</strong> <em>Bob</em>')).toBe('**Name:** *Bob*');
    expect(
      htmlToMarkdown('<a href="http://a.example">one</a> <a href="http://b.example">two</a>'),
    ).toBe('[one](http://a.example) [two](http://b.example)');
  });
  it('blocks obfuscated script schemes in hrefs', () => {
    expect(htmlToMarkdown('<a href="java&#x09;script:alert(1)">x</a>')).toBe('x');
    expect(htmlToMarkdown('<a href=" JavaScript:alert(1)">y</a>')).toBe('y');
  });
});

describe('page', () => {
  it('pages with nextCursor', () => {
    const a = page('abcdefg', undefined, 3);
    expect(a).toEqual({ chunk: 'abc', nextCursor: '3' });
    const b = page('abcdefg', a.nextCursor, 3);
    expect(b).toEqual({ chunk: 'def', nextCursor: '6' });
    expect(page('abcdefg', b.nextCursor, 3)).toEqual({ chunk: 'g', nextCursor: null });
  });
  it('uses the configured default size', () => {
    const text = 'x'.repeat(SERIALISE_CONFIG.defaultPageSize + 5);
    expect(page(text).chunk.length).toBe(SERIALISE_CONFIG.defaultPageSize);
    expect(page(text).nextCursor).not.toBeNull();
  });
  it('tolerates a junk cursor', () => {
    expect(page('abc', 'zzz', 2).chunk).toBe('ab');
  });
});
