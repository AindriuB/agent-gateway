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
