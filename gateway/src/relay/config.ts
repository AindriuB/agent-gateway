import { safeText } from '../routing/index.js';

/**
 * The parts of a gateway's configuration that must agree between a primary and the instances that
 * relay to it: they decide what a session may do (role) and who may reach the link (origins). It
 * holds no secrets. `startedAt` is the process start time, used only to order mismatched configs.
 */
export interface RelayConfig {
  role: string;
  origins: string[];
  startedAt: number;
}

export const makeRelayConfig = (
  role: string,
  origins: readonly string[],
  startedAt: number,
): RelayConfig => ({ role, origins: [...origins].sort(), startedAt });

export function parseRelayConfig(v: unknown): RelayConfig | undefined {
  if (typeof v !== 'object' || v === null) return undefined;
  const c = v as Record<string, unknown>;
  if (
    typeof c.role !== 'string' ||
    typeof c.startedAt !== 'number' ||
    !Array.isArray(c.origins) ||
    c.origins.length > 64 ||
    !c.origins.every((o) => typeof o === 'string')
  )
    return undefined;
  return { role: c.role, origins: [...(c.origins as string[])].sort(), startedAt: c.startedAt };
}

export const sameConfig = (a: RelayConfig, b: RelayConfig): boolean =>
  a.role === b.role &&
  a.origins.length === b.origins.length &&
  a.origins.every((o, i) => o === b.origins[i]);

/** Names what differs, for logs and the degraded reason. Untrusted text is sanitised. */
export function describeConfigDiff(mine: RelayConfig, theirs: RelayConfig | undefined): string {
  if (!theirs) return 'the other gateway did not report its configuration';
  const parts: string[] = [];
  if (mine.role !== theirs.role)
    parts.push(`role ${safeText(mine.role)} here vs ${safeText(theirs.role)} there`);
  if (mine.origins.join(',') !== theirs.origins.join(','))
    parts.push(
      `allowed origins [${mine.origins.map(safeText).join(', ')}] here vs [${theirs.origins.map(safeText).join(', ')}] there`,
    );
  return parts.join('; ') || 'configuration differs';
}
