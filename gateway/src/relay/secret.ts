import { randomBytes, timingSafeEqual } from 'node:crypto';
import { renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SECRET_FILE } from './endpoint.js';

/** Fresh per-boot secret: 32 random bytes as hex. */
export const newSecret = (): string => randomBytes(32).toString('hex');

/** Write the secret atomically with mode 0600 (temp file with the mode, then rename). */
export function writeSecret(stateDir: string, secret: string): string {
  const file = join(stateDir, SECRET_FILE);
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, secret, { mode: 0o600 });
    renameSync(tmp, file);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
  return file;
}

export function secretMatches(given: unknown, expected: string): boolean {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
