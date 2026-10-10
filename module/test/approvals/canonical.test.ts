import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { callHash, canonicalJson, sha256Hex } from '../../src/approvals/canonical.js';

describe('sha256Hex', () => {
  it.each([
    '',
    'abc',
    'x'.repeat(55),
    'x'.repeat(56),
    'x'.repeat(64),
    'café \u{1F600}',
    'y'.repeat(1000),
  ])('matches node for %#', (s) => {
    expect(sha256Hex(s)).toBe(createHash('sha256').update(s).digest('hex'));
  });
});

describe('callHash', () => {
  it('ignores key order but not content, and covers the tool name', () => {
    expect(callHash('t', { a: 1, b: { c: 2, d: [1, 2] } })).toBe(
      callHash('t', { b: { d: [1, 2], c: 2 }, a: 1 }),
    );
    expect(callHash('t', { a: 1 })).not.toBe(callHash('t', { a: 2 }));
    expect(callHash('t', { a: 1 })).not.toBe(callHash('u', { a: 1 }));
    expect(callHash('t', { a: [1, 2] })).not.toBe(callHash('t', { a: [2, 1] }));
    expect(canonicalJson({ b: undefined, a: 1 })).toBe('{"a":1}');
  });
});
