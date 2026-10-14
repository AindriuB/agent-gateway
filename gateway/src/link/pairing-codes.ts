import { randomInt } from 'node:crypto';

// No 0/O, 1/I/L, or other look-alikes.
export const PAIRING_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const PAIRING_CODE_TTL_MS = 10 * 60 * 1000;
export const PAIRING_CODE_PATTERN = /^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/;

export type CodeReason = 'startup' | 'expired' | 'refused-token' | 'mcp' | 'consumed';

export interface LiveCode {
  code: string;
  expiresAt: number;
}

export interface PairingCodesOptions {
  now?: () => number;
  /** Arms a one-shot timer; the default one is `unref`'d so it never keeps the process alive. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  /** Called whenever a new code is created, never when `issue` returns the live one. */
  onIssued?: (issued: LiveCode & { reason: CodeReason }) => void;
  /**
   * Server mode (task 68): the shared code is off. Nothing is ever issued, announced or accepted;
   * `issue` returns an empty placeholder that is not stored. Operators use invites instead.
   */
  disabled?: boolean;
}

const defaultSetTimer = (fn: () => void, ms: number): unknown => {
  const t = setTimeout(fn, ms);
  t.unref();
  return t;
};

/**
 * At most one live code and at most one timer, whatever the callers do. The timer re-issues a
 * code when the live one expires unused; a consumed code is not replaced until someone asks.
 */
export class PairingCodes {
  private live: LiveCode | undefined;
  private timer: unknown;
  private stopped = false;
  private readonly now: () => number;
  private readonly setTimer: NonNullable<PairingCodesOptions['setTimer']>;
  private readonly clearTimer: NonNullable<PairingCodesOptions['clearTimer']>;
  private readonly onIssued: PairingCodesOptions['onIssued'];
  private readonly disabled: boolean;

  constructor(opts: PairingCodesOptions | (() => number) = {}) {
    const o = typeof opts === 'function' ? { now: opts } : opts;
    this.now = o.now ?? Date.now;
    this.setTimer = o.setTimer ?? defaultSetTimer;
    this.clearTimer = o.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    this.onIssued = o.onIssued;
    this.disabled = o.disabled === true;
  }

  /** The code, only while it is unexpired and unconsumed. */
  current(): LiveCode | undefined {
    return this.live && this.live.expiresAt > this.now() ? { ...this.live } : undefined;
  }

  /** The live code, or a new one (announced through `onIssued`) when there is none. */
  issue(reason: CodeReason): LiveCode {
    if (this.disabled) return { code: '', expiresAt: 0 };
    const existing = this.current();
    if (existing) return existing;
    this.disarm();
    const chars = Array.from(
      { length: 8 },
      () => PAIRING_ALPHABET[randomInt(PAIRING_ALPHABET.length)],
    );
    const code = `${chars.slice(0, 4).join('')}-${chars.slice(4).join('')}`;
    const live = { code, expiresAt: this.now() + PAIRING_CODE_TTL_MS };
    this.live = live;
    if (!this.stopped)
      this.timer = this.setTimer(() => {
        this.timer = undefined;
        // The timer can fire a few ms before `expiresAt` (the loop's cached time vs Date.now),
        // so drop the code first: otherwise issue() would still see it as live and refresh stops.
        if (this.live === live && !this.stopped) {
          this.live = undefined;
          this.issue('expired');
        }
      }, PAIRING_CODE_TTL_MS);
    this.onIssued?.({ ...live, reason });
    return { ...live };
  }

  generate(): string {
    return this.issue('startup').code;
  }

  /** Number of codes held: 0 or 1. */
  get size(): number {
    return this.live ? 1 : 0;
  }

  /** Whether a refresh timer is armed (for tests and diagnostics). */
  get armed(): boolean {
    return this.timer !== undefined;
  }

  /** Single use: a correct, unexpired guess spends the live code. An expired one is only refused. */
  consume(code: string): boolean {
    const live = this.live;
    if (!live || live.code !== code.trim().toUpperCase()) return false;
    // An expired code is rejected but left to the refresh timer: clearing it here would leave no
    // code and no timer.
    if (live.expiresAt <= this.now()) return false;
    this.live = undefined;
    this.disarm();
    return true;
  }

  stop(): void {
    this.stopped = true;
    this.disarm();
  }

  private disarm(): void {
    if (this.timer !== undefined) this.clearTimer(this.timer);
    this.timer = undefined;
  }
}
