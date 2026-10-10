import { describe, expect, it } from 'vitest';
import { SlidingWindowLimiter } from '../../src/ratelimit/limiter.js';

const make = () => {
  const clock = { t: 1_000_000 };
  return { clock, limiter: new SlidingWindowLimiter(() => clock.t) };
};

describe('sliding one-minute window', () => {
  it('admits up to the limit then refuses', () => {
    const { limiter } = make();
    for (let i = 0; i < 3; i++) expect(limiter.take('k', 3)).toEqual({ ok: true });
    expect(limiter.take('k', 3).ok).toBe(false);
  });

  it('a call stops counting exactly one minute later, not a millisecond before', () => {
    const { clock, limiter } = make();
    limiter.take('k', 1);
    clock.t += 59_999;
    expect(limiter.take('k', 1)).toEqual({ ok: false, retryAfterSeconds: 1 });
    clock.t += 1;
    expect(limiter.take('k', 1)).toEqual({ ok: true });
  });

  it('slides rather than resetting: only the expired calls free budget', () => {
    const { clock, limiter } = make();
    limiter.take('k', 2); // t0
    clock.t += 30_000;
    limiter.take('k', 2); // t0 + 30s
    clock.t += 30_000; // first has expired, second has not
    expect(limiter.take('k', 2)).toEqual({ ok: true });
    expect(limiter.take('k', 2).ok).toBe(false);
  });

  it('retryAfterSeconds is the whole seconds until the blocking call expires, rounded up, at least 1', () => {
    const { clock, limiter } = make();
    limiter.take('k', 2); // t0
    clock.t += 10_000;
    limiter.take('k', 2); // t0 + 10s
    clock.t += 1_500; // now t0 + 11.5s; the first expires at t0 + 60s
    expect(limiter.take('k', 2)).toEqual({ ok: false, retryAfterSeconds: 49 });
  });

  it('refused calls cost nothing, so retrying does not extend the wait', () => {
    const { clock, limiter } = make();
    limiter.take('k', 1);
    for (let i = 0; i < 20; i++) {
      clock.t += 1_000;
      expect(limiter.take('k', 1).ok).toBe(false);
    }
    clock.t = 1_000_000 + 60_000;
    expect(limiter.take('k', 1)).toEqual({ ok: true });
  });

  it('keys are independent', () => {
    const { limiter } = make();
    limiter.take('a', 1);
    expect(limiter.take('b', 1)).toEqual({ ok: true });
    expect(limiter.take('a', 1).ok).toBe(false);
  });

  it('lowering the limit takes effect on calls already logged', () => {
    const { clock, limiter } = make();
    for (let i = 0; i < 5; i++) {
      limiter.take('k', 5);
      clock.t += 1_000;
    }
    // 5 logged at +0..+4s, now +5s; a limit of 2 needs the 4th-oldest (+3s... index 3) to expire.
    const r = limiter.take('k', 2);
    expect(r).toEqual({ ok: false, retryAfterSeconds: 58 });
  });

  it('a clock that steps back does not unsort the log', () => {
    const { clock, limiter } = make();
    limiter.take('k', 2);
    clock.t -= 5_000;
    limiter.take('k', 2);
    clock.t += 5_000 + 60_000; // first call expires; the second counted as the same instant
    expect(limiter.take('k', 2)).toEqual({ ok: true });
  });
});
