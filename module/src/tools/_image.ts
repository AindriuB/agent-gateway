/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  decodeDataPath,
  isImagePath,
  normalizeDataDir,
  normalizeDataPath,
} from '@agent-gateway/protocol';
import { WriteError, forbid, invalid } from './_write.js';

declare const globalThis: any;

export const MAX_BROWSE_ENTRIES = 200;

/** FilePicker class path for v13 and v14 (identical, per the 52 findings). */
export function resolveFilePicker(): any {
  const fp =
    globalThis.foundry?.applications?.apps?.FilePicker?.implementation ??
    globalThis.FilePicker?.implementation;
  if (typeof fp?.browse !== 'function') invalid('The Foundry FilePicker is unavailable');
  return fp;
}

export interface BrowseEntry {
  /** Canonical (Foundry percent-encoded) path. */
  path: string;
  /** Decoded name of the last segment, for display. */
  name: string;
}
export interface BrowseResult {
  dir: string;
  dirs: BrowseEntry[];
  files: BrowseEntry[];
  truncated: boolean;
}

/**
 * Validate one entry Foundry returned. Entries arrive already encoded, so they are decoded once
 * and never encoded again. When the string does not round-trip byte-for-byte (encodeURIComponent
 * and Foundry differ on `()!*'`), the decoded+NFC forms are compared and Foundry's string stays
 * canonical.
 */
function entryOf(value: unknown): BrowseEntry | null {
  if (typeof value !== 'string') return null;
  const r = normalizeDataPath(value);
  if (!r.ok) return null;
  const decoded = decodeDataPath(value);
  if (decoded === null || decoded !== decodeDataPath(r.path)) return null;
  return { path: value, name: decoded.slice(decoded.lastIndexOf('/') + 1) };
}

/**
 * Browse the Data source for images. Callers must pass `trustedUser(ctx)` from ./_write.js as
 * `user`: this function trusts the user it is given and never builds one from tool arguments.
 */
export async function browseImages(
  user: any,
  dir: string | undefined,
  limit: number,
): Promise<BrowseResult> {
  if (user?.isGM !== true && user?.can?.('FILES_BROWSE') !== true)
    forbid('Browsing files requires the FILES_BROWSE permission');
  const target = normalizeDataDir(dir);
  if (!target.ok) return invalid(`Invalid directory (${target.code})`);
  const cap = Math.min(Number.isInteger(limit) && limit > 0 ? limit : 0, MAX_BROWSE_ENTRIES);
  if (cap === 0) invalid('limit must be a positive integer');
  let listing: any;
  try {
    listing = await resolveFilePicker().browse('data', target.path);
  } catch (error) {
    if (error instanceof WriteError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    if (/permission|not allowed|forbidden/i.test(message)) return forbid(message);
    return invalid(`Cannot browse the directory: ${message}`);
  }
  const collect = (v: unknown, keep: (e: BrowseEntry) => boolean): BrowseEntry[] =>
    (Array.isArray(v) ? v : []).map(entryOf).filter((e): e is BrowseEntry => e !== null && keep(e));
  const dirs = collect(listing?.dirs, () => true);
  const files = collect(listing?.files, (e) => isImagePath(e.path));
  const keptDirs = dirs.slice(0, cap);
  const keptFiles = files.slice(0, cap - keptDirs.length);
  return {
    dir: target.path,
    dirs: keptDirs,
    files: keptFiles,
    truncated: dirs.length + files.length > cap,
  };
}
