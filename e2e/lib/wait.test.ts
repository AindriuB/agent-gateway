import { describe, expect, it } from 'vitest';
import {
  CONNECT_BUDGET_MS,
  ConnectBudgetError,
  Deadline,
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

describe('Deadline', () => {
  it('passes the time left to the step and returns its result', async () => {
    const d = new Deadline(1_000 + 5_000, () => 1_000);
    await expect(d.run('dev-gm', 'joining', async (ms) => ms)).resolves.toBe(5_000);
  });

  it('fails at the deadline even when the step never settles', async () => {
    const d = new Deadline(Date.now() + 50);
    const t0 = Date.now();
    await expect(
      d.run('player1', 'joining the world', () => new Promise<never>(() => {})),
    ).rejects.toThrow(/player1: the 43s connection budget ran out while joining the world/);
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it('fails at once when the budget is already spent', async () => {
    const d = new Deadline(1_000, () => 2_000);
    let ran = false;
    await expect(
      d.run('player1', 'launching the browser', async () => {
        ran = true;
      }),
    ).rejects.toThrow(ConnectBudgetError);
    expect(ran).toBe(false);
  });

  it('keeps the shared budget under the 45 s bound with room for cleanup', () => {
    expect(CONNECT_BUDGET_MS + 2_000).toBeLessThanOrEqual(45_000);
  });
});

describe('ConnectBudgetError', () => {
  it('names the user and points at setup', () => {
    expect(new ConnectBudgetError('player1').message).toMatch(
      /^player1: the 43s connection budget ran out while waiting for the module to connect.*run npm run test:e2e:setup$/,
    );
  });
});

describe('windowPrompt', () => {
  it('names the user window and never a code', () => {
    expect(windowPrompt('player1')).toBe('enter the code shown in the "player1" window');
  });
});
