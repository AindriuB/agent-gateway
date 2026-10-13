import { lstatSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** A claim file is tiny; anything bigger is not ours. */
const MAX_CLAIM_BYTES = 256;

export interface HeirClaim {
  /** `startedAt` of the instance the stepping-down primary is handing the link port to. */
  heir: number;
  /** When the claim was written (ms since the epoch). */
  at: number;
}

/** Per link port, like the relay socket, so gateways on other ports never interfere. */
export const heirFile = (linkPort: number): string => `relay-heir-${linkPort}.json`;

/** Atomically publish "this port is being handed to `heir`" (temp file, then rename; mode 0600). */
export function writeClaim(stateDir: string, linkPort: number, heir: number): void {
  const file = join(stateDir, heirFile(linkPort));
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify({ heir, at: Date.now() } satisfies HeirClaim), {
      mode: 0o600,
    });
    renameSync(tmp, file);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}

/** The claim, or undefined when there is none or the file is not a well-formed claim. Never throws. */
export function readClaim(stateDir: string, linkPort: number): HeirClaim | undefined {
  try {
    const file = join(stateDir, heirFile(linkPort));
    // lstat, not stat: a FIFO, symlink or directory planted here is not a claim, and a FIFO
    // must never be opened (a read would block the event loop).
    const st = lstatSync(file);
    if (!st.isFile() || st.size > MAX_CLAIM_BYTES) return undefined;
    const v = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown> | null;
    if (typeof v !== 'object' || v === null) return undefined;
    if (!Number.isFinite(v.heir) || !Number.isFinite(v.at)) return undefined;
    if (typeof v.heir !== 'number' || typeof v.at !== 'number') return undefined;
    return { heir: v.heir, at: v.at };
  } catch {
    return undefined;
  }
}

export function clearClaim(stateDir: string, linkPort: number): void {
  rmSync(join(stateDir, heirFile(linkPort)), { force: true });
}
