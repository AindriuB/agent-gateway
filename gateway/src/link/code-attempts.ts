import { FailureWindows } from '../http/limits.js';

export const MAX_FAILED_CODE_ATTEMPTS = 10;
export const CODE_ATTEMPT_WINDOW_MS = 60_000;
/**
 * Public mode: the global backstop. One shared 8-character code (31^8) lives 10 minutes, so 300
 * guesses a minute gives about 5 x 10^-7 a day; a lower number would let a few dozen /64
 * prefixes lock everyone out.
 */
export const MAX_FAILED_CODE_ATTEMPTS_PUBLIC = 300;
/** Public mode: failed codes one client key may make before that key alone is refused. */
export const MAX_FAILED_CODE_ATTEMPTS_PER_CLIENT = 5;

export interface CodeAttemptLimits {
  /** Failures across all clients before every client is refused. */
  global: number;
  /** Failures from one client key before that key is refused; unset means no per-client count. */
  perClient?: number;
}

/**
 * Failed pairing-code hellos in a rolling window. While at a limit a code hello is refused before
 * the code store is consulted, so a valid code is not spent and cannot be found by guessing.
 * Local mode counts across all origins (10 per minute); public mode counts each client key
 * (5 per minute) and keeps a larger global backstop. Memory is bounded by the limits and the cap.
 */
export class CodeAttempts {
  private readonly failures: number[] = [];
  private readonly byClient: FailureWindows | undefined;
  private readonly globalMax: number;

  constructor(
    private readonly now: () => number = Date.now,
    limits: CodeAttemptLimits = { global: MAX_FAILED_CODE_ATTEMPTS },
    clientCap?: number,
  ) {
    this.globalMax = limits.global;
    this.byClient =
      limits.perClient === undefined
        ? undefined
        : new FailureWindows(limits.perClient, CODE_ATTEMPT_WINDOW_MS, now, clientCap);
  }

  /** Distinct client keys currently tracked. */
  get clients(): number {
    return this.byClient?.size ?? 0;
  }

  private prune(): void {
    const cutoff = this.now() - CODE_ATTEMPT_WINDOW_MS;
    while (this.failures.length > 0 && (this.failures[0] as number) <= cutoff)
      this.failures.shift();
  }

  limited(client?: string): boolean {
    this.prune();
    if (this.failures.length >= this.globalMax) return true;
    return client !== undefined && !!this.byClient?.limited(client);
  }

  recordFailure(client?: string): void {
    this.prune();
    if (this.failures.length < this.globalMax) this.failures.push(this.now());
    if (client !== undefined) this.byClient?.record(client);
  }
}
