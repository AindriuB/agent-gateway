import { randomBytes, timingSafeEqual } from 'node:crypto';
import { renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PIPE_PREFIX, SECRET_FILE } from './endpoint.js';

/** Fresh per-boot secret: 32 random bytes as hex. */
export const newSecret = (): string => randomBytes(32).toString('hex');

/** Write the secret atomically with mode 0600 (temp file with the mode, then rename). */
export function writeSecret(stateDir: string, secret: string, pipe?: string): string {
  const file = join(stateDir, SECRET_FILE);
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, pipe ? `${secret}\n${pipe}\n` : secret, { mode: 0o600 });
    renameSync(tmp, file);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
  return file;
}

/** Secret file: the secret on line 1, and on win32 the per-boot pipe name on line 2. */
export function parseSecretFile(text: string): { secret: string; pipe?: string } {
  const [secret = '', pipe] = text.split('\n').map((l) => l.trim());
  return pipe && pipe.startsWith(PIPE_PREFIX) ? { secret, pipe } : { secret };
}

export function secretMatches(given: unknown, expected: string): boolean {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
