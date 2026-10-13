import { randomInt } from 'node:crypto';

// No 0/O, 1/I/L, or other look-alikes.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const PAIRING_CODE_TTL_MS = 10 * 60 * 1000;
export const PAIRING_CODE_PATTERN = /^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/;

export type CodeReason = 'startup' | 'expired' | 'refused-token' | 'mcp';

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

  constructor(opts: PairingCodesOptions | (() => number) = {}) {
    const o = typeof opts === 'function' ? { now: opts } : opts;
    this.now = o.now ?? Date.now;
    this.setTimer = o.setTimer ?? defaultSetTimer;
    this.clearTimer = o.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    this.onIssued = o.onIssued;
  }

  /** The code, only while it is unexpired and unconsumed. */
  current(): LiveCode | undefined {
    return this.live && this.live.expiresAt > this.now() ? { ...this.live } : undefined;
  }

  /** The live code, or a new one (announced through `onIssued`) when there is none. */
  issue(reason: CodeReason): LiveCode {
    const existing = this.current();
    if (existing) return existing;
    this.disarm();
    const chars = Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]);
    const code = `${chars.slice(0, 4).join('')}-${chars.slice(4).join('')}`;
    const live = { code, expiresAt: this.now() + PAIRING_CODE_TTL_MS };
    this.live = live;
    if (!this.stopped)
      this.timer = this.setTimer(() => {
        this.timer = undefined;
        if (this.live === live && !this.stopped) this.issue('expired');
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

  /** Single use: the live code is spent by a correct guess, valid or just expired. */
  consume(code: string): boolean {
    const live = this.live;
    if (!live || live.code !== code.trim().toUpperCase()) return false;
    this.live = undefined;
    this.disarm();
    return live.expiresAt > this.now();
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
