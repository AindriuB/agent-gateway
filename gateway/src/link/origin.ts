const MAX_ORIGIN_LENGTH = 255;

/**
 * The `Origin` header if it is exactly a canonical http(s) origin: no path, no trailing slash, no
 * upper case, at most 255 characters. Anything else (`null`, `file://`, an extension origin, a
 * non-canonical spelling, an absent header) is `undefined`, so pairings bind to one exact string.
 */
export function canonicalOrigin(header: string | undefined): string | undefined {
  if (header === undefined || header.length > MAX_ORIGIN_LENGTH) return undefined;
  let url: URL;
  try {
    url = new URL(header);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
  return url.origin === header ? header : undefined;
}
