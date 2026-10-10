import { escapeLineStart, escapeMd, stripMarkers } from './structure.js';

/**
 * Untrusted text (a document, folder, world, user or scene name) as a single-line markdown span:
 * whitespace and newlines collapse to single spaces and every markdown or HTML metacharacter is
 * escaped with the same escaping the serialiser uses for text. Safe to splice into a line of tool
 * `text`; it cannot open a block, link, image or HTML tag. The `://` of a bare URL is escaped too,
 * so a reader's autolinker does not turn a name into a link. The start is escaped too, so the span
 * is inert even at the start of a line.
 */
export function inlineText(s: string): string {
  const escaped = escapeMd(
    stripMarkers(String(s ?? ''))
      .replace(/\s+/g, ' ')
      .trim(),
  );
  return escapeLineStart(escaped.replace(/:(?=\/\/)/g, '\\:'));
}
