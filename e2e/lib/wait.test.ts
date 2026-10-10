import { describe, expect, it } from 'vitest';
import {
  CONNECT_BUDGET_MS,
  ConnectBudgetError,
  connectWaitMs,
  PairTimeoutError,
  waitForPairing,
  windowPrompt,
} from './wait.js';

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

describe('connectWaitMs', () => {
  it('keeps two stale-token waits inside 45 s', () => {
    const start = 1_000_000;
    const deadline = start + CONNECT_BUDGET_MS;
    const max = 20_000;
    // GM joins after 8 s, the wait is the per-user maximum.
    expect(connectWaitMs(deadline, start + 8000, max)).toBe(20_000);
    // Player's wait starts after GM took 8 + 20 s: only the remainder is left.
    expect(connectWaitMs(deadline, start + 30_000, max)).toBe(13_000);
    // Capped by what is left, never extended past the deadline.
    expect(connectWaitMs(deadline, start + 42_000, max)).toBe(1000);
    expect(connectWaitMs(deadline, start + 43_000, max)).toBe(0);
    expect(connectWaitMs(deadline, start + 50_000, max)).toBe(0);
    // A wait that starts at any point ends by the deadline.
    for (let t = 0; t <= 50_000; t += 500) {
      expect(start + t + connectWaitMs(deadline, start + t, max)).toBeLessThanOrEqual(
        Math.max(deadline, start + t),
      );
    }
    expect(CONNECT_BUDGET_MS).toBeLessThan(45_000);
  });
});

describe('ConnectBudgetError', () => {
  it('names the user and points at setup', () => {
    expect(new ConnectBudgetError('player1').message).toMatch(
      /^player1: the 43s connection budget ran out.*run npm run test:e2e:setup$/,
    );
  });
});

describe('windowPrompt', () => {
  it('names the user window and never a code', () => {
    expect(windowPrompt('player1')).toBe('enter the code shown in the "player1" window');
  });
});
