import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const TOKEN_FILE = 'http-token.sha256';

const sha256 = (s: string): Buffer => createHash('sha256').update(s).digest();

export interface HttpToken {
  /** Constant-time check of a presented token against the stored hash. */
  verify(given: string | undefined): boolean;
  /** Set only on the run that generated the token; it is never stored in the clear. */
  created?: string;
}

/** Load the stored token hash from the state dir, or generate a token on first run. */
export function loadOrCreateToken(stateDir: string | undefined): HttpToken {
  const file = stateDir ? join(stateDir, TOKEN_FILE) : undefined;
  let hash: Buffer | undefined;
  if (file && existsSync(file)) {
    const hex = readFileSync(file, 'utf8').trim();
    if (/^[0-9a-f]{64}$/.test(hex)) hash = Buffer.from(hex, 'hex');
  }
  let created: string | undefined;
  if (!hash) {
    created = randomBytes(32).toString('hex');
    hash = sha256(created);
    if (file) {
      const tmp = `${file}.${process.pid}.tmp`;
      try {
        writeFileSync(tmp, `${hash.toString('hex')}\n`, { mode: 0o600 });
        renameSync(tmp, file);
      } catch (err) {
        rmSync(tmp, { force: true });
        throw err;
      }
    }
  }
  const expected = hash;
  return {
    verify: (given) => given !== undefined && timingSafeEqual(sha256(given), expected),
    ...(created ? { created } : {}),
  };
}
