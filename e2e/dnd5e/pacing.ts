/**
 * Write pacing for worlds with the default rate limit (10 write calls per agent per minute). The
 * suite never raises the world's limits; it counts its writes, waits when the window is full, and
 * retries a RATE_LIMITED answer after the stated delay.
 */
export const WRITE_LIMIT = 10;
/** Stay one under the limit so a retry or an unlisted write cannot tip it over. */
export const PACED_WRITES = WRITE_LIMIT - 1;
export const WINDOW_MS = 60_000;
/** The longest a single call waits out rate limiting before giving up. */
export const RETRY_CAP_MS = 70_000;
const FALLBACK_WAIT_MS = 5_000;

export interface Answer {
  isError: boolean;
  text: string;
}
export type Sleep = (ms: number) => Promise<void>;
const realSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const isRateLimited = (r: Answer): boolean => r.isError && /\bRATE_LIMITED\b/.test(r.text);

/** "Try again in 14 seconds." gives 15 000 ms (one second of margin); undefined when absent. */
export function parseRetryAfterMs(text: string): number | undefined {
  const m = /try again in (\d{1,4}) ?(second|sec|s|minute|min|m)s?\b/i.exec(text);
  if (!m) return undefined;
  const n = Number(m[1]);
  return ((m[2]!.toLowerCase().startsWith('m') ? n * 60 : n) + 1) * 1000;
}

/** A sliding window over this suite's own write calls. */
export class WritePacer {
  private readonly stamps: number[] = [];
  constructor(
    private readonly limit = PACED_WRITES,
    private readonly windowMs = WINDOW_MS,
    private readonly now: () => number = Date.now,
    private readonly sleep: Sleep = realSleep,
  ) {}
  /** Resolve when one more write fits in the window, and count it. */
  async slot(): Promise<void> {
    for (;;) {
      const t = this.now();
      while (this.stamps.length && t - this.stamps[0]! >= this.windowMs) this.stamps.shift();
      if (this.stamps.length < this.limit) {
        this.stamps.push(t);
        return;
      }
      await this.sleep(this.stamps[0]! + this.windowMs - t + 50);
    }
  }
}

/**
 * Make a write call through the pacer; on RATE_LIMITED wait the stated delay and call again,
 * until `capMs` of waiting would be exceeded, then return the last (rate limited) answer.
 */
export async function pacedWrite<T extends Answer>(
  call: () => Promise<T>,
  pacer: WritePacer,
  opts: { capMs?: number; sleep?: Sleep } = {},
): Promise<T> {
  const cap = opts.capMs ?? RETRY_CAP_MS;
  const sleep = opts.sleep ?? realSleep;
  let waited = 0;
  for (;;) {
    await pacer.slot();
    const answer = await call();
    if (!isRateLimited(answer)) return answer;
    const wait = parseRetryAfterMs(answer.text) ?? FALLBACK_WAIT_MS;
    if (waited + wait > cap) return answer;
    waited += wait;
    await sleep(wait);
  }
}
