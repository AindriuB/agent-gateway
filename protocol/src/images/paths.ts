import { IMAGE_EXTENSIONS } from './sniff.js';

export const MAX_DATA_PATH_LENGTH = 256;
export type DataPathError =
  | 'EMPTY'
  | 'TOO_LONG'
  | 'ABSOLUTE'
  | 'SCHEME'
  | 'BACKSLASH'
  | 'CONTROL'
  | 'PERCENT'
  | 'DOT_SEGMENT'
  | 'EMPTY_SEGMENT'
  | 'BAD_CHARACTER';
export type DataPathResult = { ok: true; path: string } | { ok: false; code: DataPathError };

const fail = (code: DataPathError): DataPathResult => ({ ok: false, code });
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;
const SEGMENT = /^[A-Za-z0-9._ -]+$/;
const isDot = (s: string): boolean => s === '.' || s === '..';
function decodeOnce(s: string): string | null {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
}
function hasDotSegment(s: string): boolean {
  return s.split(/[/\\]/).some(isDot);
}

/** Validate a Data-relative file path. Allows only [A-Za-z0-9._ -] segments (52 findings). */
export function normalizeDataPath(input: string): DataPathResult {
  if (typeof input !== 'string' || input === '') return fail('EMPTY');
  if (input.length > MAX_DATA_PATH_LENGTH) return fail('TOO_LONG');
  if (CONTROL.test(input)) return fail('CONTROL');
  if (input.includes('\\')) return fail('BACKSLASH');
  if (input.startsWith('/') || /^[A-Za-z]:/.test(input)) {
    return fail(/^[A-Za-z]{2,}:/.test(input) ? 'SCHEME' : 'ABSOLUTE');
  }
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(input)) return fail('SCHEME');
  if (hasDotSegment(input)) return fail('DOT_SEGMENT');
  const decoded = decodeOnce(input);
  if (decoded !== null) {
    if (CONTROL.test(decoded)) return fail('CONTROL');
    if (decoded.includes('\\')) return fail('BACKSLASH');
    if (hasDotSegment(decoded)) return fail('DOT_SEGMENT');
  }
  if (input.includes('%')) return fail('PERCENT');
  const segments = input.split('/');
  if (segments.some((s) => s === '')) return fail('EMPTY_SEGMENT');
  if (segments.some((s) => !SEGMENT.test(s))) return fail('BAD_CHARACTER');
  return { ok: true, path: segments.join('/') };
}

/** Validate a directory for browsing. '' or undefined is the Data root; everything else as a path. */
export function normalizeDataDir(input: string | undefined): DataPathResult {
  if (input === undefined || input === '') return { ok: true, path: '' };
  return normalizeDataPath(input);
}

/** True when the path is valid and ends in an allowed image extension (case-insensitive). */
export function isImagePath(path: string): boolean {
  const r = normalizeDataPath(path);
  if (!r.ok) return false;
  const lower = r.path.toLowerCase();
  return (IMAGE_EXTENSIONS as readonly string[]).some((e) => lower.endsWith(e));
}
