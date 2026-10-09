import { SERIALISE_CONFIG } from './config.js';

export interface Page {
  chunk: string;
  nextCursor: string | null;
}

/** True when cutting at `end` would split an escape (odd run of `\`) or a surrogate pair. */
function unsafeCut(text: string, start: number, end: number): boolean {
  const hi = text.charCodeAt(end - 1);
  const lo = text.charCodeAt(end);
  if (hi >= 0xd800 && hi <= 0xdbff && lo >= 0xdc00 && lo <= 0xdfff) return true;
  let run = 0;
  while (end - 1 - run >= start && text.charCodeAt(end - 1 - run) === 0x5c) run += 1;
  return run % 2 === 1;
}

/**
 * Cursor is a decimal character offset into `text`. Every page is independently safe: a cut
 * moves back (never past the limit) so it never follows an escaping backslash nor splits a
 * surrogate pair. If no safe cut exists the page keeps its full size so paging still progresses.
 */
export function page(
  text: string,
  cursor?: string | null,
  limit: number = SERIALISE_CONFIG.defaultPageSize,
): Page {
  const parsed = cursor ? Number.parseInt(cursor, 10) : 0;
  const start = Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, text.length) : 0;
  const size = Math.max(1, Math.floor(limit));
  let end = Math.min(start + size, text.length);
  if (end < text.length) {
    const hard = end;
    while (end > start && unsafeCut(text, start, end)) end -= 1;
    if (end <= start) {
      end = hard;
      // A lone surrogate-pair split with no room to move back: step forward one to progress.
      const hi = text.charCodeAt(end - 1);
      const lo = text.charCodeAt(end);
      if (hi >= 0xd800 && hi <= 0xdbff && lo >= 0xdc00 && lo <= 0xdfff) end += 1;
    }
  }
  return { chunk: text.slice(start, end), nextCursor: end < text.length ? String(end) : null };
}
