import { safeText } from '../routing/index.js';

/**
 * The parts of a gateway's configuration that must agree between a primary and the instances that
 * relay to it. `allowOrigins` is the optional `--allow-origin` restriction (empty means any
 * origin); the ports and log level are the settings a user can change without restarting the host.
 * It holds no secrets. `startedAt` is the process start time, used only to order mismatched configs.
 */
export interface RelayConfig {
  allowOrigins: string[];
  httpPort: number;
  logLevel: string;
  startedAt: number;
  /** The external origin, or `''` when unset. Session-affecting: it decides what a session may see. */
  publicUrl: string;
  /** Always-on, many users. Session-affecting. */
  serverMode: boolean;
  /** Bind addresses and proxy trust: session-neutral, like `httpPort`. */
  linkHost: string;
  httpHost: string;
  trustProxy: boolean;
}

export const makeRelayConfig = (
  allowOrigins: readonly string[],
  httpPort: number,
  logLevel: string,
  startedAt: number,
  extra: Partial<
    Pick<RelayConfig, 'publicUrl' | 'serverMode' | 'linkHost' | 'httpHost' | 'trustProxy'>
  > = {},
): RelayConfig => ({
  allowOrigins: [...allowOrigins].sort(),
  httpPort,
  logLevel,
  startedAt,
  publicUrl: extra.publicUrl ?? '',
  serverMode: extra.serverMode ?? false,
  linkHost: extra.linkHost ?? '127.0.0.1',
  httpHost: extra.httpHost ?? '127.0.0.1',
  trustProxy: extra.trustProxy ?? false,
});

const str = (v: unknown, fallback: string): string =>
  typeof v === 'string' ? v.slice(0, 300) : fallback;

export function parseRelayConfig(v: unknown): RelayConfig | undefined {
  if (typeof v !== 'object' || v === null) return undefined;
  const c = v as Record<string, unknown>;
  if (
    typeof c.httpPort !== 'number' ||
    typeof c.logLevel !== 'string' ||
    typeof c.startedAt !== 'number' ||
    !Array.isArray(c.allowOrigins) ||
    c.allowOrigins.length > 64 ||
    !c.allowOrigins.every((o) => typeof o === 'string')
  )
    return undefined;
  return {
    allowOrigins: [...(c.allowOrigins as string[])].sort(),
    httpPort: c.httpPort,
    logLevel: c.logLevel,
    startedAt: c.startedAt,
    // A peer from before these settings existed reads as off.
    publicUrl: str(c.publicUrl, ''),
    serverMode: c.serverMode === true,
    linkHost: str(c.linkHost, '127.0.0.1'),
    httpHost: str(c.httpHost, '127.0.0.1'),
    trustProxy: c.trustProxy === true,
  };
}

/**
 * The session-affecting part: a relayed MCP session runs on the primary's link, store and
 * selector, so only `allowOrigins` (which decides who may reach that link) changes what such a
 * session can do. A mismatch here is never served.
 */
export const sameSessionConfig = (a: RelayConfig, b: RelayConfig): boolean =>
  a.publicUrl === b.publicUrl &&
  a.serverMode === b.serverMode &&
  a.allowOrigins.length === b.allowOrigins.length &&
  a.allowOrigins.every((o, i) => o === b.allowOrigins[i]);

/**
 * Every compared field. `httpPort` and `logLevel` are session-neutral: they do not change what a
 * relayed session can do, so a primary serves a relay that differs only in those. A strictly newer
 * caller that differs in any field still makes the primary step down (see `RelayServer`), and an
 * `allowOrigins` mismatch from an older caller is refused (it becomes a standby).
 */
export const sameConfig = (a: RelayConfig, b: RelayConfig): boolean =>
  a.httpPort === b.httpPort &&
  a.logLevel === b.logLevel &&
  a.linkHost === b.linkHost &&
  a.httpHost === b.httpHost &&
  a.trustProxy === b.trustProxy &&
  sameSessionConfig(a, b);

/** Names what differs, for logs and the degraded reason. Untrusted text is sanitised. */
export function describeConfigDiff(mine: RelayConfig, theirs: RelayConfig | undefined): string {
  if (!theirs) return 'the other gateway did not report its configuration';
  const parts: string[] = [];
  if (mine.allowOrigins.join(',') !== theirs.allowOrigins.join(','))
    parts.push(
      `allowed origins [${mine.allowOrigins.map(safeText).join(', ')}] here vs [${theirs.allowOrigins.map(safeText).join(', ')}] there`,
    );
  if (mine.httpPort !== theirs.httpPort)
    parts.push(
      `http port ${safeText(String(mine.httpPort))} here vs ${safeText(String(theirs.httpPort))} there`,
    );
  if (mine.logLevel !== theirs.logLevel)
    parts.push(`log level ${safeText(mine.logLevel)} here vs ${safeText(theirs.logLevel)} there`);
  if (mine.publicUrl !== theirs.publicUrl)
    parts.push(
      `public URL ${safeText(mine.publicUrl) || '(none)'} here vs ${safeText(theirs.publicUrl) || '(none)'} there`,
    );
  if (mine.serverMode !== theirs.serverMode)
    parts.push(
      `server mode ${mine.serverMode ? 'on' : 'off'} here vs ${theirs.serverMode ? 'on' : 'off'} there`,
    );
  if (mine.linkHost !== theirs.linkHost)
    parts.push(`link host ${safeText(mine.linkHost)} here vs ${safeText(theirs.linkHost)} there`);
  if (mine.httpHost !== theirs.httpHost)
    parts.push(`http host ${safeText(mine.httpHost)} here vs ${safeText(theirs.httpHost)} there`);
  if (mine.trustProxy !== theirs.trustProxy)
    parts.push(
      `trust proxy ${mine.trustProxy ? 'on' : 'off'} here vs ${theirs.trustProxy ? 'on' : 'off'} there`,
    );
  return parts.join('; ') || 'configuration differs';
}
