import { expect } from 'vitest';
import { marked, mditLinkify, mditPlain, renderChecked } from '../serialise/paging-oracle.js';

export const HOSTILE_NAMES = [
  'x <img src=x onerror=alert(1)>',
  'a\n\n# H',
  '[l](javascript:1)',
  'tick `code` and ``` fence',
  'a | b | c',
  '> quote\n- item\n1. one',
  'http://evil.example/x',
  '![img](http://x/y.png)',
  '<script>alert(1)</script>',
];

/** What a reader makes of a span of text: one paragraph, no HTML, no links, no images. */
export function expectInertSpan(md: string): void {
  const tokens = marked.lexer(md);
  expect(tokens.map((t) => t.type)).toEqual(['paragraph']);
  const kinds: string[] = [];
  const walk = (ts: { type: string; tokens?: unknown[] }[]) => {
    for (const t of ts) {
      kinds.push(t.type);
      if (t.tokens) walk(t.tokens as { type: string; tokens?: unknown[] }[]);
    }
  };
  walk(tokens as { type: string; tokens?: unknown[] }[]);
  expect(
    kinds.filter((k) => ['html', 'link', 'image'].includes(k)),
    md,
  ).toEqual([]);
  for (const it of [mditLinkify, mditPlain]) {
    const r = renderChecked(md, it);
    expect(r.problems, md).toEqual([]);
    expect(r.hrefs, md).toEqual([]);
  }
}
