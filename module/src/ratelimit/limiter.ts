import { WINDOW_MS } from './config.js';

export type Take = { ok: true } | { ok: false; retryAfterSeconds: number };

/**
 * A sliding window log per key. A call at time t counts until t + WINDOW_MS (exclusive), so at
 * exactly one window later it no longer does. Only admitted calls are logged: a refused call
 * costs nothing. The log never grows past the limit, which is at most MAX_LIMIT.
 */
export class SlidingWindowLimiter {
  private readonly logs = new Map<string, number[]>();

  constructor(
    private readonly now: () => number,
    private readonly windowMs: number = WINDOW_MS,
  ) {}

  take(key: string, limit: number): Take {
    const now = this.now();
    const log = this.logs.get(key) ?? [];
    const cutoff = now - this.windowMs;
    let live = 0;
    while (live < log.length && (log[live] as number) <= cutoff) live++;
    if (live > 0) log.splice(0, live);
    if (log.length >= limit) {
      // The call fits once enough of the oldest entries expire to leave room for it.
      const blocking = log[log.length - limit] as number;
      const seconds = Math.ceil((blocking + this.windowMs - now) / 1000);
      this.logs.set(key, log);
      return { ok: false, retryAfterSeconds: Math.max(1, seconds) };
    }
    // A clock that steps back must not unsort the log.
    log.push(Math.max(now, log[log.length - 1] ?? now));
    this.logs.set(key, log);
    return { ok: true };
  }

  /** Forget everything, for tests. */
  reset(): void {
    this.logs.clear();
  }
}
