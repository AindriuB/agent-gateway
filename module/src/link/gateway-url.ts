/** Pure helpers for the gateway address: no Foundry globals, so they are tested on their own. */

/** The address a client stored by default before the world default existed. */
export const LEGACY_DEFAULT_URL = 'ws://localhost:7420';
export const MAX_GATEWAY_URL = 2048;

/** `localhost`, any 127.0.0.0/8 address, or the IPv6 loopback (bracketed or not). */
export function isLoopbackHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === 'localhost' || h === '::1') return true;
  const m = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  return m !== null && m.slice(1).every((n) => Number(n) <= 255);
}

function parse(value: string): URL | undefined {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

/**
 * Strict check for the world default and for an invite's address: `wss:`, or `ws:` only on a
 * loopback host; no credentials, query or fragment; at most 2048 characters.
 */
export function isStrictGatewayUrl(value: string): boolean {
  if (value.length === 0 || value.length > MAX_GATEWAY_URL) return false;
  if (/[\s\u0000-\u001f\u007f]/.test(value)) return false;
  const u = parse(value);
  if (!u) return false;
  if (u.protocol !== 'wss:' && !(u.protocol === 'ws:' && isLoopbackHost(u.hostname))) return false;
  if (u.username || u.password || u.search || u.hash) return false;
  // `?` and `#` with nothing after them leave `search` and `hash` empty; refuse those too.
  return !value.includes('?') && !value.includes('#');
}

/** The player's typed override keeps today's leniency: only what can never work is refused. */
function clientUsable(value: string): boolean {
  if (value.length > MAX_GATEWAY_URL || /[\s\u0000-\u001f\u007f]/.test(value)) return false;
  if (value.includes('#')) return false;
  // Credentials sit before an `@` in the authority; checked by shape so it needs no URL parser.
  // WHATWG parsing also reads userinfo after `ws:\\`, `ws:/` and `ws:`, so the slashes are optional.
  return !/^[a-z][a-z0-9+.-]*:[\/]*[^/\?]*@/i.test(value);
}

export interface GatewayResolution {
  url: string;
  source: 'client' | 'world' | 'default';
  /** The player's value is set but cannot be used (fragment, credentials, not a URL). */
  clientInvalid: boolean;
  /** The world default is set but fails the strict check. */
  worldInvalid: boolean;
}

/** Client override, then the world default, then `ws://localhost:7420`. */
export function resolveGateway(client: string, world: string): GatewayResolution {
  const c = client.trim();
  const w = world.trim();
  const worldOk = w !== '' && isStrictGatewayUrl(w);
  const worldInvalid = w !== '' && !worldOk;
  const clientSet = c !== '';
  const clientInvalid = clientSet && !clientUsable(c);
  // A stored legacy default means "never chosen" whenever the world default can replace it.
  const inheritLegacy = c === LEGACY_DEFAULT_URL && worldOk;
  if (clientSet && !clientInvalid && !inheritLegacy)
    return { url: c, source: 'client', clientInvalid, worldInvalid };
  if (worldOk) return { url: w, source: 'world', clientInvalid, worldInvalid };
  return { url: LEGACY_DEFAULT_URL, source: 'default', clientInvalid, worldInvalid };
}

export function effectiveGatewayUrl(client: string, world: string): string {
  return resolveGateway(client, world).url;
}

/** Read both settings through `get`; an unregistered world default counts as unset. */
export function readGatewayResolution(get: (key: string) => unknown): GatewayResolution {
  const read = (key: string): string => {
    try {
      const v = get(key);
      return typeof v === 'string' ? v : '';
    } catch {
      return '';
    }
  };
  return resolveGateway(read('gatewayUrl'), read('defaultGatewayUrl'));
}

export function effectiveFromSettings(get: (key: string) => unknown): string {
  return readGatewayResolution(get).url;
}

/** A non-loopback host means a gateway whose codes come from an operator: server mode. */
export function isServerModeUrl(value: string): boolean {
  const u = parse(value);
  return u !== undefined && !isLoopbackHost(u.hostname);
}

/** Scheme, host, port and path only; never userinfo, query or fragment. Empty if unparseable. */
export function displayAddress(value: string): string {
  const u = parse(value);
  if (!u || !u.host) return '';
  const path = u.pathname === '/' ? '' : u.pathname;
  return `${u.protocol}//${u.host}${path}`.slice(0, 200);
}

/** The world default if it passes the strict check, whatever the player's own setting says. */
export function validWorldDefault(get: (key: string) => unknown): string {
  try {
    const v = get('defaultGatewayUrl');
    return typeof v === 'string' && isStrictGatewayUrl(v.trim()) ? v.trim() : '';
  } catch {
    return '';
  }
}
