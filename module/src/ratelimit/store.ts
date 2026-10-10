/* eslint-disable @typescript-eslint/no-explicit-any */
import { DEFAULT_LIMITS, loadLimits, validateLimits, type LoadedLimits } from './config.js';

declare const game: any;

const NS = 'agent-gateway';

export const RATE_LIMITS_KEY = 'rateLimits';

/** The saved limits; an unreadable setting loads as the strict limit, never unlimited. */
export function loadRateLimits(): LoadedLimits {
  let raw: unknown;
  try {
    raw = game.settings.get(NS, RATE_LIMITS_KEY);
  } catch {
    raw = undefined;
  }
  return loadLimits(raw);
}

/** Rejects an invalid configuration before it reaches storage. */
export async function saveRateLimits(limits: unknown): Promise<void> {
  await game.settings.set(NS, RATE_LIMITS_KEY, JSON.stringify(validateLimits(limits)));
}

export function registerRateLimitSettings(): void {
  game.settings.register(NS, RATE_LIMITS_KEY, {
    name: 'AGENT_GATEWAY.Settings.rateLimits.name',
    hint: 'AGENT_GATEWAY.Settings.rateLimits.hint',
    scope: 'world',
    config: false,
    type: String, // JSON StoredLimits; edited through saveRateLimits, which validates
    default: JSON.stringify(DEFAULT_LIMITS),
    restricted: true,
  });
}
