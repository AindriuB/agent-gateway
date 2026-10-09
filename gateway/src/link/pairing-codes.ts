import { randomInt } from 'node:crypto';

// No 0/O, 1/I/L, or other look-alikes.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const PAIRING_CODE_TTL_MS = 10 * 60 * 1000;
export const PAIRING_CODE_PATTERN = /^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/;

export class PairingCodes {
  private readonly codes = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now) {}

  generate(): string {
    const t = this.now();
    for (const [c, exp] of this.codes) if (exp <= t) this.codes.delete(c);
    let code: string;
    do {
      const chars = Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]);
      code = `${chars.slice(0, 4).join('')}-${chars.slice(4).join('')}`;
    } while (this.codes.has(code));
    this.codes.set(code, t + PAIRING_CODE_TTL_MS);
    return code;
  }

  /** Number of codes held (unused, including any not yet pruned). */
  get size(): number {
    return this.codes.size;
  }

  /** Single use: a code is spent whether or not it was still valid. */
  consume(code: string): boolean {
    const expires = this.codes.get(code.trim().toUpperCase());
    this.codes.delete(code.trim().toUpperCase());
    return expires !== undefined && expires > this.now();
  }
}
