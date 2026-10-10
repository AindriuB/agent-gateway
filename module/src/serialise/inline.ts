import { escapeLineStart, escapeMd, stripMarkers } from './structure.js';

/** Longest name or label kept, in characters, before escaping. */
export const INLINE_TEXT_CAP = 200;

/**
 * Untrusted text (a document, folder, world, user or scene name; any value is stringified) as a
 * single-line markdown span: whitespace and newlines collapse to single spaces, the text is cut to
 * `cap` characters with "...", and it is escaped with the serialiser's own text escaping
 * (`escapeMd`, as for every text node). On top of that, the things a reader's autolinker would turn
 * into links are broken with a backslash: `://`, `www.` and `@`. The start is escaped too, so the
 * span is inert even at the start of a line.
 */
export function inlineText(value: unknown, cap: number = INLINE_TEXT_CAP): string {
  const text = stripMarkers(safeString(value)).replace(/\s+/g, ' ').trim();
  const cut = text.length > cap ? `${text.slice(0, cap)}...` : text;
  const escaped = escapeMd(cut)
    .replace(/:(?=\/\/)/g, '\\:')
    .replace(/\bwww\.(?=\w)/gi, (m) => `${m.slice(0, -1)}\\.`)
    .replace(/@/g, '\\@');
  return escapeLineStart(escaped);
}

function safeString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  try {
    return String(value);
  } catch {
    return '';
  }
}
