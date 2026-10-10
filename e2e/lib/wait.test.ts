import { describe, expect, it } from 'vitest';
import { PairTimeoutError, waitForPairing } from './wait.js';

describe('waitForPairing', () => {
  it('returns as soon as the probe succeeds', async () => {
    let n = 0;
    await waitForPairing('player1', {
      timeoutMs: 1000,
      probe: async () => ++n === 3,
      sleep: async () => undefined,
    });
    expect(n).toBe(3);
  });

  it('fails with a named message when the code is not entered in time', async () => {
    let t = 0;
    const p = waitForPairing('player1', {
      timeoutMs: 300_000,
      probe: async () => false,
      now: () => t,
      sleep: async (ms) => {
        t += ms;
      },
    });
    await expect(p).rejects.toThrow(PairTimeoutError);
    await expect(p).rejects.toThrow(/not entered within 300s/);
    await expect(p).rejects.toThrow(/player1: the pairing code was not entered within 300s/);
  });
});
