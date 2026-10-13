import { DEV_LINK_PORT } from '../lib/config.js';

/** The real gateway's HTTP port; the takeover scenario never binds it. */
export const DEV_HTTP_PORT = 7421;

/** Second-instance arguments: local HTTP on a throwaway port, which also differs from the default. */
export function takeoverArgs(httpPort: number): string[] {
  if (!Number.isInteger(httpPort) || httpPort < 1024 || httpPort > 65535)
    throw new Error(`not a usable HTTP port: ${httpPort}`);
  if (httpPort === DEV_LINK_PORT || httpPort === DEV_HTTP_PORT)
    throw new Error(`HTTP port ${httpPort} belongs to the real gateway`);
  return ['--http', '--http-port', String(httpPort)];
}

const TOKEN_RE = /HTTP bearer token \(shown once, stored hashed\):\s*(\S+)/;

/** The bearer token a gateway printed once on stderr, or undefined if it has not yet. */
export const parseBearerToken = (stderr: string): string | undefined => TOKEN_RE.exec(stderr)?.[1];

/** How many users the HTTP /status page lists as connected, or undefined if it is not a status page. */
export function parseConnectedCount(html: string): number | undefined {
  const m = /Connected \((\d+)\)/.exec(html);
  return m ? Number(m[1]) : undefined;
}
