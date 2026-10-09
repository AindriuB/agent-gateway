import { SERIALISE_CONFIG } from './config.js';

export interface Page {
  chunk: string;
  nextCursor: string | null;
}

/** True when a cut at `pos` would split an escape (odd run of `\` back to text start) or a surrogate pair. */
function unsafeCut(text: string, pos: number): boolean {
  if (pos <= 0 || pos >= text.length) return false;
  const hi = text.charCodeAt(pos - 1);
  const lo = text.charCodeAt(pos);
  if (hi >= 0xd800 && hi <= 0xdbff && lo >= 0xdc00 && lo <= 0xdfff) return true;
  let run = 0;
  while (pos - 1 - run >= 0 && text.charCodeAt(pos - 1 - run) === 0x5c) run += 1;
  return run % 2 === 1;
}

/**
 * Cursor is a decimal character offset into `text` and is untrusted: it is clamped to the text
 * and moved back to the nearest safe position. Every page is independently safe: the end moves
 * back (never past the limit) so it never follows an escaping backslash nor splits a surrogate
 * pair. If no safe cut exists the end moves forward instead, so paging always progresses.
 */
export function page(
  text: string,
  cursor?: string | null,
  limit: number = SERIALISE_CONFIG.defaultPageSize,
): Page {
  const parsed = cursor ? Number.parseInt(cursor, 10) : 0;
  let start = Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, text.length) : 0;
  while (start > 0 && unsafeCut(text, start)) start -= 1;
  const size = Number.isFinite(limit)
    ? Math.max(1, Math.floor(limit))
    : SERIALISE_CONFIG.defaultPageSize;
  let end = Math.min(start + size, text.length);
  if (end < text.length) {
    const hard = end;
    while (end > start && unsafeCut(text, end)) end -= 1;
    if (end <= start) {
      end = hard;
      while (end < text.length && unsafeCut(text, end)) end += 1;
    }
  }
  return { chunk: text.slice(start, end), nextCursor: end < text.length ? String(end) : null };
}
