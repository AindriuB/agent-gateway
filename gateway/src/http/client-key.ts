import { isIP } from 'node:net';

/** Expand an IPv6 text address to its eight 16-bit groups, or undefined when it is not one. */
function groups(addr: string): number[] | undefined {
  let a = addr;
  const zone = a.indexOf('%');
  if (zone >= 0) a = a.slice(0, zone);
  if (isIP(a) !== 6) return undefined;
  // An embedded dotted quad (::ffff:1.2.3.4) is the last two groups.
  const dot = a.lastIndexOf('.');
  if (dot >= 0) {
    const colon = a.lastIndexOf(':');
    const q = a
      .slice(colon + 1)
      .split('.')
      .map(Number);
    a = `${a.slice(0, colon + 1)}${(((q[0] as number) << 8) | (q[1] as number)).toString(16)}:${(((q[2] as number) << 8) | (q[3] as number)).toString(16)}`;
  }
  const [head = '', tail] = a.split('::');
  const h = head === '' ? [] : head.split(':');
  const t = tail === undefined || tail === '' ? [] : tail.split(':');
  const fill = tail === undefined ? 0 : 8 - h.length - t.length;
  if (fill < 0) return undefined;
  const all = [...h, ...Array<string>(fill).fill('0'), ...t].map((g) => parseInt(g, 16));
  return all.length === 8 && all.every((g) => Number.isInteger(g)) ? all : undefined;
}

/** The IPv4 address inside an IPv4-mapped IPv6 address, else the address unchanged. */
function unmap(addr: string): string {
  const g = groups(addr);
  if (!g || g.slice(0, 5).some((x) => x !== 0) || g[5] !== 0xffff) return addr;
  const hi = g[6] as number;
  const lo = g[7] as number;
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
}

/** True for 127.0.0.0/8, ::1 and IPv4-mapped forms of those. */
export function isLoopbackAddress(addr: string | undefined): boolean {
  if (!addr) return false;
  const a = unmap(addr);
  if (isIP(a) === 4) return a.startsWith('127.');
  const g = groups(a);
  return !!g && g.slice(0, 7).every((x) => x === 0) && g[7] === 1;
}

/**
 * One key per client for the limits. IPv4-mapped IPv6 is keyed as the IPv4 address; any other
 * IPv6 address is keyed by its /64 prefix, since one subscriber usually holds a whole /64 and
 * per-address buckets would be free to rotate. Loopback IPv6 is `::1`. Undefined when `addr` is
 * not an IP address.
 */
export function normalizeAddress(addr: string | undefined): string | undefined {
  if (!addr) return undefined;
  const a = unmap(addr);
  if (isIP(a) === 4) return a;
  const g = groups(a);
  if (!g) return undefined;
  if (isLoopbackAddress(a)) return '::1';
  return `${g
    .slice(0, 4)
    .map((x) => x.toString(16))
    .join(':')}::/64`;
}

/** The key for the TCP peer alone. An unknown peer address shares the key `unknown`. */
export function peerKey(peer: string | undefined): string {
  return normalizeAddress(peer) ?? 'unknown';
}

/**
 * The client key for a request. `X-Forwarded-For` is read only with `trustProxy`, only when the
 * TCP peer is loopback, and only its right-most entry (the one the nearest proxy appended); a
 * malformed entry falls back to the peer's key. `X-Forwarded-Host` and `-Proto` are never read.
 */
export function clientKey(
  peer: string | undefined,
  forwardedFor: string | string[] | undefined,
  trustProxy: boolean,
): string {
  if (trustProxy && isLoopbackAddress(peer) && forwardedFor !== undefined) {
    const header = Array.isArray(forwardedFor) ? forwardedFor.join(',') : forwardedFor;
    const last = header.split(',').pop()?.trim();
    const key = normalizeAddress(last);
    if (key) return key;
  }
  return peerKey(peer);
}
