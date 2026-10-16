/* eslint-disable @typescript-eslint/no-explicit-any */
import { isImagePath, normalizeDataDir } from '@agent-gateway/protocol';
import { forbid, invalid } from './_write.js';

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

export interface BrowseResult {
  dir: string;
  dirs: string[];
  files: string[];
  truncated: boolean;
}

/**
 * Browse the Data source for images. `user` must be Foundry's own user object (game.user);
 * never build it from tool arguments.
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
  const listing = await resolveFilePicker().browse('data', target.path);
  const dirs = (Array.isArray(listing?.dirs) ? listing.dirs : []).filter(
    (d: unknown): d is string => typeof d === 'string',
  );
  const files = (Array.isArray(listing?.files) ? listing.files : []).filter(
    (f: unknown): f is string => typeof f === 'string' && isImagePath(f),
  );
  const all = [...dirs, ...files];
  const kept = all.slice(0, cap);
  return {
    dir: target.path,
    dirs: kept.filter((e) => dirs.includes(e)),
    files: kept.filter((e) => !dirs.includes(e)),
    truncated: all.length > cap,
  };
}
