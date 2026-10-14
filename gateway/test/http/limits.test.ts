import { describe, expect, it } from 'vitest';
import { BoundedMap, CountWindows, FailureWindows, RateWindows } from '../../src/http/limits.js';

describe('per-client limit maps stay bounded', () => {
  it('BoundedMap never exceeds its cap', () => {
    const m = new BoundedMap<number>(50);
    for (let i = 0; i < 150; i++) {
      m.set(`k${i}`, i);
      expect(m.size).toBeLessThanOrEqual(50);
    }
    expect(m.get('k0')).toBeUndefined();
    expect(m.get('k149')).toBe(149);
  });

  it('FailureWindows and RateWindows never exceed their cap', () => {
    const f = new FailureWindows(5, 60_000, () => 0, 50);
    const r = new RateWindows(10, () => 0, 50);
    for (let i = 0; i < 150; i++) {
      f.record(`k${i}`);
      r.exceeded(`k${i}`);
      expect(f.size).toBeLessThanOrEqual(50);
      expect(r.size).toBeLessThanOrEqual(50);
    }
  });

  it('CountWindows never exceeds its cap', () => {
    const c = new CountWindows(5, 60_000, () => 0, 50);
    for (let i = 0; i < 150; i++) {
      c.hit(`k${i}`);
      expect(c.size).toBeLessThanOrEqual(50);
    }
  });

  it('FailureWindows limits one key and expires', () => {
    let t = 0;
    const f = new FailureWindows(2, 1000, () => t);
    f.record('a');
    f.record('a');
    expect(f.limited('a')).toBe(true);
    expect(f.limited('b')).toBe(false);
    t = 1001;
    expect(f.limited('a')).toBe(false);
  });
});
