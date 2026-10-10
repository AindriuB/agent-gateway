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
  const measure = (n: number) => {
    const value = { rows: Array.from({ length: n }, () => ({ inner: { value: 1 } })) };
    return Math.min(
      ...Array.from({ length: 5 }, () => {
        const start = performance.now();
        const result = validateArgs(schema, value);
        const elapsed = performance.now() - start;
        expect(result.ok).toBe(true);
        return elapsed;
      }),
    );
  };
  measure(1000);
  expect(measure(40000) / measure(10000)).toBeLessThan(6);
});
