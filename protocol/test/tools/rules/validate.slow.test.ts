import { expect, it } from 'vitest';
import { validateArgs } from '../../../src/tools/validate.js';

it('validates 10000 depth-3 objects with near-linear scaling', () => {
  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      rows: {
        type: 'array',
        description: 'Rows',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            inner: {
              type: 'object',
              additionalProperties: false,
              description: 'Inner',
              properties: { value: { type: 'number', description: 'Value' } },
            },
          },
        },
      },
    },
  };
  const small = { rows: Array.from({ length: 10000 }, () => ({ inner: { value: 1 } })) };
  const large = { rows: Array.from({ length: 40000 }, () => ({ inner: { value: 1 } })) };
  const measure = (value: typeof small) => {
    const start = performance.now();
    const result = validateArgs(schema, value);
    const elapsed = performance.now() - start;
    expect(result.ok).toBe(true);
    return elapsed;
  };
  // Warm both workloads before sampling so JIT compilation does not bias one size.
  for (let i = 0; i < 3; i++) {
    measure(small);
    measure(large);
  }
  const smallTimes: number[] = [];
  const largeTimes: number[] = [];
  for (let i = 0; i < 5; i++) {
    smallTimes.push(measure(small));
    largeTimes.push(measure(large));
  }
  expect(Math.min(...largeTimes) / Math.min(...smallTimes)).toBeLessThan(6);
});
