/** Per-client limits. Every map here has a named cap and evicts the oldest key when full. */
export const MAX_FAILED_AUTH_PER_CLIENT = 10;
export const FAILED_AUTH_WINDOW_MS = 60_000;
export const PUBLIC_CLIENT_RPS = 10;
export const MAX_HTTP_SESSIONS_PER_CLIENT = 4;
/** Credential-free /mcp requests (OAuth discovery) allowed per client key per window. */
export const MAX_DISCOVERY_PER_CLIENT = 120;
export const DISCOVERY_WINDOW_MS = 60_000;
/** Distinct client keys remembered by each per-client map. */
export const MAX_TRACKED_CLIENTS = 10_000;

/** A Map that never holds more than `cap` keys: inserting a new key past the cap drops the oldest. */
export class BoundedMap<V> {
  private readonly m = new Map<string, V>();

  constructor(readonly cap: number = MAX_TRACKED_CLIENTS) {}

  get size(): number {
    return this.m.size;
  }

  get(key: string): V | undefined {
    return this.m.get(key);
  }

  set(key: string, value: V): void {
    if (!this.m.has(key) && this.m.size >= this.cap) {
      const oldest = this.m.keys().next();
      if (!oldest.done) this.m.delete(oldest.value);
    }
    this.m.set(key, value);
  }

  delete(key: string): void {
    this.m.delete(key);
  }
}

/** Failures per client key in a rolling window. Each key holds at most `max` timestamps. */
export class FailureWindows {
  private readonly keys: BoundedMap<number[]>;

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
    cap: number = MAX_TRACKED_CLIENTS,
  ) {
    this.keys = new BoundedMap(cap);
  }

  get size(): number {
    return this.keys.size;
  }

  private live(key: string): number[] {
    const cutoff = this.now() - this.windowMs;
    const all = this.keys.get(key) ?? [];
    const kept = all.filter((t) => t > cutoff);
    if (kept.length === 0) this.keys.delete(key);
    return kept;
  }

  limited(key: string): boolean {
    return this.live(key).length >= this.max;
  }

  record(key: string): void {
    const kept = this.live(key);
    if (kept.length < this.max) kept.push(this.now());
    this.keys.set(key, kept);
  }
}

/** Requests per second per client key. */
export class RateWindows {
  private readonly keys: BoundedMap<{ start: number; count: number }>;

  constructor(
    private readonly rps: number,
    private readonly now: () => number = Date.now,
    cap: number = MAX_TRACKED_CLIENTS,
  ) {
    this.keys = new BoundedMap(cap);
  }

  get size(): number {
    return this.keys.size;
  }

  /** Counts a request; true when the key is over its rate. */
  exceeded(key: string): boolean {
    const t = this.now();
    let w = this.keys.get(key);
    if (!w || t - w.start >= 1000) w = { start: t, count: 0 };
    w.count++;
    this.keys.set(key, w);
    return w.count > this.rps;
  }
}

/** Fixed-window request counter per client key: O(1) memory per key. */
export class CountWindows {
  private readonly keys: BoundedMap<{ start: number; count: number }>;

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
    cap: number = MAX_TRACKED_CLIENTS,
  ) {
    this.keys = new BoundedMap(cap);
  }

  get size(): number {
    return this.keys.size;
  }

  /** Counts a request. Returns 0 when it is within the limit, else the ms left in the window. */
  hit(key: string): number {
    const t = this.now();
    let w = this.keys.get(key);
    if (!w || t - w.start >= this.windowMs) w = { start: t, count: 0 };
    w.count++;
    this.keys.set(key, w);
    return w.count > this.max ? Math.max(1, w.start + this.windowMs - t) : 0;
  }
}
