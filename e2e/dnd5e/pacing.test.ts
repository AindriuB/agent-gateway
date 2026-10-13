import { describe, expect, it } from 'vitest';
import { WritePacer, isRateLimited, pacedWrite, parseRetryAfterMs } from './pacing.js';

const limited = (n: number) => ({
  isError: true,
  text: `RATE_LIMITED: Rate limit reached: this agent may make 10 write calls per minute. Try again in ${n} seconds.`,
});
const ok = { isError: false, text: 'fine' };

describe('parseRetryAfterMs', () => {
  it('reads the stated delay and adds a second', () => {
    expect(parseRetryAfterMs(limited(14).text)).toBe(15_000);
    expect(parseRetryAfterMs('Try again in 1 second.')).toBe(2_000);
    expect(parseRetryAfterMs('try again in 2 minutes')).toBe(121_000);
  });
  it('is undefined without a delay', () => {
    expect(parseRetryAfterMs('RATE_LIMITED')).toBeUndefined();
    expect(parseRetryAfterMs('Try again in soon')).toBeUndefined();
  });
  it('recognises only a RATE_LIMITED error', () => {
    expect(isRateLimited(limited(3))).toBe(true);
    expect(isRateLimited({ isError: false, text: 'RATE_LIMITED' })).toBe(false);
    expect(isRateLimited({ isError: true, text: 'FORBIDDEN' })).toBe(false);
  });
});

describe('pacedWrite', () => {
  const clock = () => {
    let t = 0;
    const sleeps: number[] = [];
    return {
      now: () => t,
      sleep: async (ms: number) => {
        sleeps.push(ms);
        t += ms;
      },
      sleeps,
    };
  };
  it('waits the stated delay and retries until it succeeds', async () => {
    const c = clock();
    const answers = [limited(14), ok];
    const out = await pacedWrite(
      async () => answers.shift()!,
      new WritePacer(9, 60_000, c.now, c.sleep),
      {
        sleep: c.sleep,
      },
    );
    expect(out).toBe(ok);
    expect(c.sleeps).toEqual([15_000]);
  });
  it('gives up once the waits would pass the cap and returns the limited answer', async () => {
    const c = clock();
    let calls = 0;
    const out = await pacedWrite(
      async () => (calls++, limited(30)),
      new WritePacer(9, 60_000, c.now, c.sleep),
      { capMs: 70_000, sleep: c.sleep },
    );
    expect(isRateLimited(out)).toBe(true);
    expect(calls).toBe(3);
    expect(c.sleeps).toEqual([31_000, 31_000]);
  });
  it('passes other errors through without retrying', async () => {
    const c = clock();
    let calls = 0;
    const err = { isError: true, text: 'FORBIDDEN' };
    expect(
      await pacedWrite(async () => (calls++, err), new WritePacer(9, 60_000, c.now, c.sleep)),
    ).toBe(err);
    expect(calls).toBe(1);
  });
});

describe('WritePacer', () => {
  it('lets 9 writes through and holds the 10th until the window moves', async () => {
    let t = 0;
    const sleeps: number[] = [];
    const pacer = new WritePacer(
      9,
      60_000,
      () => t,
      async (ms) => {
        sleeps.push(ms);
        t += ms;
      },
    );
    for (let i = 0; i < 9; i++) await pacer.slot();
    expect(sleeps).toEqual([]);
    await pacer.slot();
    expect(sleeps).toEqual([60_050]);
  });
});
