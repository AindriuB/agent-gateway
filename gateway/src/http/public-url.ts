/**
 * True when a `Host` header names the public URL's host (with its port only when the URL has a
 * non-default one). The header is parsed with the URL's own scheme, so `gw.example.com:443`
 * matches `https://gw.example.com`.
 */
export function publicHostMatches(
  header: string | undefined,
  publicUrl: string | undefined,
): boolean {
  if (!header || !publicUrl) return false;
  try {
    const pub = new URL(publicUrl);
    return new URL(`${pub.protocol}//${header}`).host === pub.host;
  } catch {
    return false;
  }
}
