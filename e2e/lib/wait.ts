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

/** The shared connection budget ran out before this user's module connected. */
export class ConnectBudgetError extends Error {
  constructor(user: string, stage = 'waiting for the module to connect') {
    super(
      `${user}: the ${Math.round(CONNECT_BUDGET_MS / 1000)}s connection budget ran out while ${stage}; the stored token may be stale (or Foundry is slow to load); run npm run test:e2e:setup`,
    );
  }
}

/**
 * A shared deadline for opening the run's sessions. Every startup step (gateway start, browser
 * launch, join, connection wait) runs inside it, so a stale token or a slow Foundry fails at the
 * deadline rather than after the step's own, longer timeout.
 */
export class Deadline {
  constructor(
    readonly at: number,
    private readonly now: () => number = Date.now,
  ) {}

  remainingMs(): number {
    return Math.max(0, this.at - this.now());
  }

  /** Run `step` with the time left; reject with ConnectBudgetError when the deadline passes. */
  async run<T>(user: string, stage: string, step: (remainingMs: number) => Promise<T>): Promise<T> {
    const ms = this.remainingMs();
    if (ms <= 0) throw new ConnectBudgetError(user, stage);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new ConnectBudgetError(user, stage)), ms);
    });
    try {
      return await Promise.race([step(ms), expired]);
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Tells the human which window to look at. Names the user only; the code stays in the window. */
export const windowPrompt = (user: string): string =>
  `enter the code shown in the "${user}" window`;
