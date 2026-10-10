import { describe, expect, it } from 'vitest';
import { safeText } from '../../src/routing/sanitize.js';

describe('safeText', () => {
  it.each([
    ['\x1b[2J'],
    ['\x1b]0;x\x07'],
    ['\nPairing code: FAKE-CODE'],
    ['a\u2028b\u2029c\x7f\x9b'],
  ])('leaves no control characters in %j', (input) => {
    const out = safeText(`x${input}y`);
    expect(out).not.toMatch(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/);
    expect(out.startsWith('x')).toBe(true);
  });
  it('caps at 80 characters with an ellipsis and keeps short text intact', () => {
    expect(safeText('alice')).toBe('alice');
    const out = safeText('a'.repeat(200));
    expect(Array.from(out)).toHaveLength(80);
    expect(out.endsWith('…')).toBe(true);
  });
});
