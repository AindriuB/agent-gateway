/* eslint-disable @typescript-eslint/no-explicit-any */
import type { LinkClient } from '../link/client.js';
declare const game: any;
const NS = 'agent-gateway';
export interface OfflineEventPolicy {
  enabled: boolean;
  retentionDays: number;
}
export function parseOfflineEventPolicy(value: unknown): OfflineEventPolicy {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return { enabled: false, retentionDays: 14 };
  const p = value as Record<string, unknown>;
  if (
    Object.keys(p).some((k) => k !== 'enabled' && k !== 'retentionDays') ||
    typeof p.enabled !== 'boolean' ||
    !Number.isInteger(p.retentionDays) ||
    (p.retentionDays as number) < 1 ||
    (p.retentionDays as number) > 365
  )
    return { enabled: false, retentionDays: 14 };
  return { enabled: p.enabled, retentionDays: p.retentionDays as number };
}
export function readOfflineEventPolicy(): OfflineEventPolicy {
  try {
    return parseOfflineEventPolicy(game.settings.get(NS, 'offlineEventReading'));
  } catch {
    return { enabled: false, retentionDays: 14 };
  }
}
const installed = new WeakMap<LinkClient, () => void>();
export function installOfflineEventPolicy(client: LinkClient): () => void {
  const prior = installed.get(client);
  if (prior) return prior;
  const refresh = () => client.sendEventPolicy(readOfflineEventPolicy());
  client.onState((s) => {
    if (s.kind === 'connected') refresh();
  });
  installed.set(client, refresh);
  return refresh;
}
let changed = () => {};
export function registerOfflineEventSettings(): void {
  game.settings.register(NS, 'offlineEventReading', {
    name: 'AGENT_GATEWAY.OfflineEvents.title',
    hint: 'AGENT_GATEWAY.OfflineEvents.hint',
    scope: 'world',
    config: false,
    type: Object,
    default: { enabled: false, retentionDays: 14 },
    restricted: true,
    onChange: () => changed(),
  });
}
export function onOfflineEventSettingChange(refresh: () => void): void {
  changed = refresh;
}
function currentGM(): any {
  const user = game.user;
  if (!user || user.isGM !== true || game.users?.get(user.id) !== user)
    throw new Error('A current GM is required');
  return user;
}
function recheck(user: any): void {
  if (currentGM() !== user) throw new Error('GM authority changed');
}
export async function saveOfflineEventPolicy(value: unknown): Promise<void> {
  const user = currentGM();
  const policy = parseOfflineEventPolicy(value);
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => k !== 'enabled' && k !== 'retentionDays') ||
    (value as OfflineEventPolicy).enabled !== policy.enabled ||
    (value as OfflineEventPolicy).retentionDays !== policy.retentionDays
  )
    throw new Error('Invalid offline event policy');
  recheck(user);
  await game.settings.set(NS, 'offlineEventReading', policy);
  recheck(user);
}
export async function purgeOfflineEvents(client: LinkClient): Promise<number> {
  const user = currentGM();
  recheck(user);
  const count = await client.purgeEvents();
  recheck(user);
  return count;
}
