import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Store } from '../store/index.js';

const sha256 = (s: string): Buffer => createHash('sha256').update(s).digest();
const newToken = (): string => randomBytes(32).toString('hex');

export interface HttpToken {
  /**
   * Constant-time check of a presented token against the hash currently in the store. The
   * store is read per request, so a rotation by another process takes effect at once.
   */
  verify(given: string | undefined): boolean;
  /** Set only on the run that generated the token; it is never stored in the clear. */
  created?: string;
  /**
   * Persist a freshly generated token's hash. Call it only once the listener is up. False means
   * a token (a concurrent rotation) was stored first and this run's token is void.
   */
  commit(): boolean;
}

/**
 * The token for this run. The hash is stored only when `commit()` is called, so a run that
 * fails to listen leaves nothing behind and the next run still prints a token.
 */
export function loadOrCreateToken(
  store: Pick<Store, 'getHttpTokenHash' | 'setHttpTokenHash'>,
): HttpToken {
  const created = store.getHttpTokenHash() === undefined ? newToken() : undefined;
  return {
    verify(given) {
      const hex = store.getHttpTokenHash();
      if (given === undefined || hex === undefined || !/^[0-9a-f]{64}$/.test(hex)) return false;
      return timingSafeEqual(sha256(given), Buffer.from(hex, 'hex'));
    },
    ...(created ? { created } : {}),
    commit() {
      return !created || store.setHttpTokenHash(sha256(created).toString('hex'), true);
    },
  };
}

/** New token; its hash replaces the stored one, which invalidates the old token. */
export function rotateToken(store: Pick<Store, 'setHttpTokenHash'>): string {
  const token = newToken();
  store.setHttpTokenHash(sha256(token).toString('hex'));
  return token;
}
