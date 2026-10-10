export const MAX_TERMINAL_TEXT = 80;

// C0 and C1 controls, DEL, and the Unicode line and paragraph separators.
// eslint-disable-next-line no-control-regex
const UNSAFE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;

/**
 * Make text supplied by a connected client safe to print on an operator's terminal: control
 * characters (including ESC and newlines) become U+FFFD, and the result is capped at 80 characters.
 */
export function safeText(value: string): string {
  const clean = value.replace(UNSAFE, '�');
  const chars = Array.from(clean);
  return chars.length > MAX_TERMINAL_TEXT
    ? `${chars.slice(0, MAX_TERMINAL_TEXT - 1).join('')}…`
    : clean;
}
