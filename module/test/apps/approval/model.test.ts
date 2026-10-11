import { describe, expect, it } from 'vitest';
import { computeDiff, updatedDocument, reviewable } from '../../../src/apps/approval/model.js';

describe('approval field diff', () => {
  it('reports nested fields, array edits, additions and removals', () => {
    expect(
      computeDiff(
        { name: 'old', system: { hp: { value: 8 } }, items: ['sword', 'shield'], gone: true },
        {
          name: 'new',
          system: { hp: { value: 9 } },
          items: ['sword', 'bow', 'rope'],
          added: false,
        },
      ),
    ).toEqual([
      { path: 'name', old: '"old"', new: '"new"' },
      { path: 'system.hp.value', old: '8', new: '9' },
      { path: 'items[1]', old: '"shield"', new: '"bow"' },
      { path: 'items[2]', old: '—', new: '"rope"' },
      { path: 'gone', old: 'true', new: '—' },
      { path: 'added', old: '—', new: 'false' },
    ]);
  });
  it('handles null, scalar replacement, unchanged structures and empty objects', () => {
    expect(computeDiff({ a: null }, { a: {} })).toEqual([{ path: 'a', old: 'null', new: '{}' }]);
    expect(computeDiff([1], 'one')).toEqual([{ path: '$', old: '[\n  1\n]', new: '"one"' }]);
    expect(computeDiff({ a: [1, {}] }, { a: [1, {}] })).toEqual([]);
  });
  it('merges partial nested and dotted updates without removing unrelated fields or mutating originals', () => {
    const before = {
      name: 'actor',
      system: { hp: { value: 10, max: 20 }, obsolete: 1 },
      items: [1, 2],
    };
    const after = updatedDocument(before, {
      'system.hp.value': 12,
      system: { '-=obsolete': null },
      items: [3],
    });
    expect(computeDiff(before, after)).toEqual([
      { path: 'system.hp.value', old: '10', new: '12' },
      { path: 'system.obsolete', old: '1', new: '—' },
      { path: 'items[0]', old: '1', new: '3' },
      { path: 'items[1]', old: '2', new: '—' },
    ]);
    expect(before.system.hp.value).toBe(10);
    expect(before.system.obsolete).toBe(1);
  });
  it('refuses prototype assignment paths', () => {
    expect(
      updatedDocument(
        {},
        JSON.parse('{"__proto__.polluted":true,"constructor.prototype.polluted":true}'),
      ),
    ).toEqual({});
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('review work bounds', () => {
  it('rejects extreme depth, breadth, cycles and oversized text without recursion', () => {
    let deep: object = {};
    for (let i = 0; i < 10000; i++) deep = { child: deep };
    const cycle: { self?: object } = {};
    cycle.self = cycle;
    expect(reviewable(deep)).toBe(false);
    expect(reviewable(Array(20001).fill(0))).toBe(false);
    expect(reviewable(cycle)).toBe(false);
    expect(reviewable('x'.repeat(1000001))).toBe(false);
    expect(reviewable({ source: Array(500).fill('// full source').join('\n') })).toBe(true);
  });
  it('refuses a huge field table instead of creating thousands of DOM rows', () => {
    const before = Object.fromEntries(Array.from({ length: 1001 }, (_, i) => [i, 0]));
    const after = Object.fromEntries(Array.from({ length: 1001 }, (_, i) => [i, 1]));
    expect(() => computeDiff(before, after)).toThrow('row limit');
  });
});
