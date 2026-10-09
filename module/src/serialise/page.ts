import { SERIALISE_CONFIG } from './config.js';

export interface Page {
  chunk: string;
  nextCursor: string | null;
}

/** Cursor is a decimal character offset into `text`. */
export function page(
  text: string,
  cursor?: string | null,
  limit: number = SERIALISE_CONFIG.defaultPageSize,
): Page {
  const parsed = cursor ? Number.parseInt(cursor, 10) : 0;
  const start = Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, text.length) : 0;
  const size = Math.max(1, Math.floor(limit));
  const end = Math.min(start + size, text.length);
  return { chunk: text.slice(start, end), nextCursor: end < text.length ? String(end) : null };
}
