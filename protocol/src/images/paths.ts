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
  | 'BAD_ESCAPE'
  | 'BAD_CHARACTER';
export type DataPathResult = { ok: true; path: string } | { ok: false; code: DataPathError };

const fail = (code: DataPathError): DataPathResult => ({ ok: false, code });
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const BAD_CHARS = /[:*?"<>|/]/;

type Segment = { ok: true; decoded: string } | { ok: false; code: DataPathError };

/** Decode one segment exactly once, NFC-normalize it and apply the per-segment rules. */
function checkSegment(raw: string): Segment {
  if (raw === '') return { ok: false, code: 'EMPTY_SEGMENT' };
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw).normalize('NFC');
  } catch {
    return { ok: false, code: 'BAD_ESCAPE' };
  }
  if (CONTROL.test(decoded)) return { ok: false, code: 'CONTROL' };
  if (decoded.includes('\\')) return { ok: false, code: 'BACKSLASH' };
  if (decoded.includes('%')) return { ok: false, code: 'PERCENT' };
  if (/^[. ]*$/.test(decoded)) return { ok: false, code: 'DOT_SEGMENT' };
  if (BAD_CHARS.test(decoded)) return { ok: false, code: 'BAD_CHARACTER' };
  return { ok: true, decoded };
}

/**
 * Validate a Data-relative file path. Input may be raw or percent-encoded; the result is the
 * canonical (Foundry percent-encoded, NFC) form (Amendment 2).
 */
export function normalizeDataPath(input: string): DataPathResult {
  if (typeof input !== 'string' || input === '') return fail('EMPTY');
  if (input.startsWith('/') || /^[A-Za-z]:/.test(input)) {
    return fail(/^[A-Za-z]{2,}:/.test(input) ? 'SCHEME' : 'ABSOLUTE');
  }
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(input)) return fail('SCHEME');
  const out: string[] = [];
  for (const raw of input.split('/')) {
    const seg = checkSegment(raw);
    if (!seg.ok) return fail(seg.code);
    out.push(encodeURIComponent(seg.decoded));
  }
  const path = out.join('/');
  if (path.length > MAX_DATA_PATH_LENGTH) return fail('TOO_LONG');
  return { ok: true, path };
}

/** Decode a canonical path to its display form (each segment once, NFC). Null if invalid. */
export function decodeDataPath(path: string): string | null {
  const parts: string[] = [];
  for (const raw of path.split('/')) {
    const seg = checkSegment(raw);
    if (!seg.ok) return null;
    parts.push(seg.decoded);
  }
  return parts.join('/');
}

/** Validate a directory for browsing. '' or undefined is the Data root; everything else as a path. */
export function normalizeDataDir(input: string | undefined): DataPathResult {
  if (input === undefined || input === '') return { ok: true, path: '' };
  return normalizeDataPath(input);
}

/** True when the path is valid and its decoded name ends in an allowed image extension. */
export function isImagePath(path: string): boolean {
  const r = normalizeDataPath(path);
  if (!r.ok) return false;
  const lower = (decodeDataPath(r.path) ?? '').toLowerCase();
  return (IMAGE_EXTENSIONS as readonly string[]).some((e) => lower.endsWith(e));
}
