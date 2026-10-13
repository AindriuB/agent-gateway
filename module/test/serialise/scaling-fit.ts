// Shared by the serialise scaling tests: judge growth by the log-log slope over several sizes.
//
// A two-size ratio of timings is fragile: one noisy sample at the small size moves the ratio by
// more than the gap between linear (4x for a 4x input) and a regression we care about. Instead, five
// sizes span a 16x range, each is timed in interleaved rounds (a noisy period hits every size
// alike), the minimum per size is kept (background load only ever adds time), and the least-squares
// slope of log(time) on log(size) is compared with MAX_SLOPE. Linear cost has slope ~1, n log n
// ~1.1, quadratic ~2; 1.5 passes the first two and fails a quadratic unless noise skews the fit by
// ~0.5. Scheduler bursts are not persistent, so up to TRIALS trials run and one passing trial
// suffices; a real quadratic regression fails every trial.

export const MAX_SLOPE = 1.5;
/** Multiples of the base size; the span is 16x. */
export const MULTIPLES = [1, 2, 4, 8, 16] as const;
const TRIALS = 3;
/** Guards log(0) only; timer resolution is far finer. */
const FLOOR_MS = 0.05;

/** One input prepared at one size. `run` returns the milliseconds of one timed pass. */
export interface Sample {
  run: () => number;
  close?: () => void | Promise<void>;
}

export function logLogSlope(sizes: readonly number[], times: readonly number[]): number {
  const xs = sizes.map((n) => Math.log(n));
  const ys = times.map((t) => Math.log(Math.max(t, FLOOR_MS)));
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0;
  let den = 0;
  xs.forEach((x, i) => {
    num += (x - mx) * (ys[i]! - my);
    den += (x - mx) ** 2;
  });
  return num / den;
}

export interface Assessment {
  /** True when some trial's slope is under MAX_SLOPE. */
  passed: boolean;
  /** Smallest time seen at the largest size, across trials. */
  largestMs: number;
  /** All slopes and per-size minimums, for a failure message. */
  report: string;
}

/**
 * Open one sample per size (`base * MULTIPLES[i]`), warm each, then time them round-robin.
 * Every sample is closed before returning.
 */
export async function assessScaling(
  base: number,
  open: (n: number) => Sample | Promise<Sample>,
  rounds: number,
): Promise<Assessment> {
  const sizes = MULTIPLES.map((m) => base * m);
  const samples: Sample[] = [];
  try {
    for (const n of sizes) samples.push(await open(n));
    for (const s of samples) s.run(); // warm every size so JIT compilation biases none
    const trials: { slope: number; mins: number[] }[] = [];
    for (let t = 0; t < TRIALS; t++) {
      const mins = sizes.map(() => Infinity);
      for (let r = 0; r < rounds; r++) {
        samples.forEach((s, i) => {
          mins[i] = Math.min(mins[i]!, s.run());
        });
      }
      trials.push({ slope: logLogSlope(sizes, mins), mins });
      if (trials[t]!.slope < MAX_SLOPE) break;
    }
    const report = trials
      .map(
        (r) => `slope=${r.slope.toFixed(2)} mins(ms)=${r.mins.map((m) => m.toFixed(2)).join(',')}`,
      )
      .join(' | ');
    return {
      passed: trials.some((r) => r.slope < MAX_SLOPE),
      largestMs: Math.min(...trials.map((r) => r.mins[sizes.length - 1]!)),
      report: `max slope ${MAX_SLOPE}, sizes=${sizes.join(',')} ${report}`,
    };
  } finally {
    for (const s of samples) await s.close?.();
  }
}
