import { expect, it } from 'vitest';
import { validateArgs } from '../../../src/tools/validate.js';

it('validates depth-3 objects with near-linear scaling', () => {
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
  const sizes = [2500, 5000, 10000, 20000, 40000];
  const inputs = sizes.map((n) => ({
    rows: Array.from({ length: n }, () => ({ inner: { value: 1 } })),
  }));
  const measure = (value: (typeof inputs)[number]) => {
    const start = performance.now();
    const result = validateArgs(schema, value);
    const elapsed = performance.now() - start;
    expect(result.ok).toBe(true);
    return elapsed;
  };
  // Least-squares slope of log(time) against log(n).
  const slope = (times: number[]) => {
    const xs = sizes.map((n) => Math.log(n));
    const ys = times.map((t) => Math.log(t));
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
    const my = ys.reduce((a, b) => a + b, 0) / ys.length;
    let num = 0;
    let den = 0;
    xs.forEach((x, i) => {
      num += (x - mx) * (ys[i]! - my);
      den += (x - mx) ** 2;
    });
    return num / den;
  };
  const trial = () => {
    // Warm every size so JIT compilation does not bias one of them.
    for (let i = 0; i < 4; i++) inputs.forEach(measure);
    const mins = sizes.map(() => Infinity);
    // Interleave sizes round-robin so a noisy period hits all sizes alike.
    for (let round = 0; round < 8; round++) {
      inputs.forEach((input, i) => {
        mins[i] = Math.min(mins[i]!, measure(input));
      });
    }
    return { slope: slope(mins), mins };
  };
  // Log-log slope is ~1 for linear cost and ~2 for quadratic cost across the 16x span.
  // The 1.5 bound lets n log n (~1.1) pass but fails a quadratic regression unless
  // noise skews the fit by ~0.5. Noise only adds time, so each size uses its minimum
  // sample. Scheduler bursts are not persistent, so up to 3 trials run and one passing
  // trial suffices; a real quadratic regression fails every trial.
  const trials: Array<{ slope: number; mins: number[] }> = [];
  for (let t = 0; t < 3; t++) {
    trials.push(trial());
    if (trials[t]!.slope < 1.5) break;
  }
  const report = trials
    .map((r) => `slope=${r.slope.toFixed(2)} mins(ms)=${r.mins.map((m) => m.toFixed(2)).join(',')}`)
    .join(' | ');
  expect(
    trials.some((r) => r.slope < 1.5),
    `sizes=${sizes.join(',')} ${report}`,
  ).toBe(true);
}, 30_000);
