/* eslint-disable @typescript-eslint/no-explicit-any */
import { DEFAULT_LIMITS, validateLimits, type LoadedLimits } from './config.js';

import { readWorldSnapshot, publishWorldSnapshot, snapshotLimits } from '../policy/snapshot.js';

declare const game: any;

const NS = 'agent-gateway';

export const RATE_LIMITS_KEY = 'rateLimits';

/** The saved limits; an unreadable setting loads as the strict limit, never unlimited. */
export function loadRateLimits(): LoadedLimits {
  return snapshotLimits();
}

/** Rejects an invalid configuration before it reaches storage. */
export async function saveRateLimits(limits: unknown): Promise<void> {
  const current = readWorldSnapshot();
  if (!current.valid) throw Error('Policy initialization or repair required');
  await publishWorldSnapshot({
    version: 1,
    world: current.world,
    playerEnabled: current.playerEnabled,
    headlessEnabled: current.headlessEnabled,
    folders: current.folders,
    limits: validateLimits(limits),
  });
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
