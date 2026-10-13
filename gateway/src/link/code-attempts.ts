export const MAX_FAILED_CODE_ATTEMPTS = 10;
export const CODE_ATTEMPT_WINDOW_MS = 60_000;

/**
 * Failed pairing-code hellos in a rolling window, counted across all origins. While at the limit a
 * code hello is refused before the code store is consulted, so a valid code is not spent and
 * cannot be found by guessing. Memory is bounded by the limit.
 */
export class CodeAttempts {
  private readonly failures: number[] = [];

  constructor(private readonly now: () => number = Date.now) {}

  private prune(): void {
    const cutoff = this.now() - CODE_ATTEMPT_WINDOW_MS;
    while (this.failures.length > 0 && (this.failures[0] as number) <= cutoff)
      this.failures.shift();
  }

  limited(): boolean {
    this.prune();
    return this.failures.length >= MAX_FAILED_CODE_ATTEMPTS;
  }

  recordFailure(): void {
    this.prune();
    if (this.failures.length < MAX_FAILED_CODE_ATTEMPTS) this.failures.push(this.now());
  }
}
