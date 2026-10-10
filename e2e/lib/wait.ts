export class PairTimeoutError extends Error {
  constructor(user: string, timeoutMs: number) {
    super(
      `${user}: the pairing code was not entered within ${Math.round(timeoutMs / 1000)}s; run npm run test:e2e:setup again`,
    );
  }
}

export interface WaitDeps {
  /** Resolves true once the user is paired and connected. */
  probe: () => Promise<boolean>;
  timeoutMs: number;
  intervalMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/** Poll until the probe succeeds or the deadline passes. Used by setup to wait for a human. */
export async function waitForPairing(user: string, deps: WaitDeps): Promise<void> {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const deadline = now() + deps.timeoutMs;
  for (;;) {
    if (await deps.probe()) return;
    if (now() >= deadline) throw new PairTimeoutError(user, deps.timeoutMs);
    await sleep(deps.intervalMs ?? 2000);
  }
}

/** Overall budget for the connection checks of a run (stale tokens must fail within 45 s). */
export const CONNECT_BUDGET_MS = 43_000;

/** The shared connection budget ran out before this user's wait could start. */
export class ConnectBudgetError extends Error {
  constructor(user: string) {
    super(
      `${user}: the ${Math.round(CONNECT_BUDGET_MS / 1000)}s connection budget ran out before the module connected; the stored token may be stale; run npm run test:e2e:setup`,
    );
  }
}

/**
 * How long one user's connection wait may take: the per-user maximum, capped by what is left of
 * the shared deadline. Zero when the budget is spent; the caller then fails with
 * ConnectBudgetError, so no wait ever runs past the deadline.
 */
export function connectWaitMs(deadlineAt: number, now: number, perUserMaxMs: number): number {
  return Math.max(0, Math.min(perUserMaxMs, deadlineAt - now));
}

/** Tells the human which window to look at. Names the user only; the code stays in the window. */
export const windowPrompt = (user: string): string =>
  `enter the code shown in the "${user}" window`;
