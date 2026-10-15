import type { InviteSummary, PairingSummary } from '../../link/client.js';

export interface InviteRow {
  id: string;
  userName: string;
  expires: string;
  status: string;
  /** One of the protocol's invite statuses. */
  statusKey: string;
  canCancel: boolean;
}

export interface PairingRow {
  id: string;
  userName: string;
  userId: string;
  origin: string;
  created: string;
  admin: boolean;
  connected: boolean;
  self: boolean;
  /** Another admin GM's pairing can only be revoked by the operator. */
  canRevoke: boolean;
}

export interface UserChoice {
  id: string;
  name: string;
}

const MAX_ROWS = 200;
const NAME_CHARS = 100;

/** Invite lifetimes offered, in ms. The gateway's minimum is 10 minutes and its cap 7 days. */
export const TTL_CHOICES: ReadonlyArray<{ ms: number; key: string }> = [
  { ms: 10 * 60_000, key: 'ttl10m' },
  { ms: 60 * 60_000, key: 'ttl1h' },
  { ms: 24 * 60 * 60_000, key: 'ttl1d' },
  { ms: 7 * 24 * 60 * 60_000, key: 'ttl7d' },
];
export const DEFAULT_TTL_MS = 24 * 60 * 60_000;

const when = (ms: number): string =>
  Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString().replace('T', ' ').slice(0, 19) : '';

/** Printable text only, bounded: names and origins come from remote peers. */
const plain = (s: unknown, max: number): string =>
  [...String(s ?? '').replace(/[\p{C}\p{Zl}\p{Zp}]/gu, '')].slice(0, max).join('');

/** Resolve a user id to a name through Foundry's users, falling back to the id. */
export function nameFor(users: readonly UserChoice[], id: string): string {
  return plain(users.find((u) => u.id === id)?.name || id, NAME_CHARS);
}

export function inviteRows(
  invites: readonly InviteSummary[],
  users: readonly UserChoice[],
  statusLabel: (status: string) => string,
): InviteRow[] {
  return invites.slice(0, MAX_ROWS).map((i) => ({
    id: String(i.id),
    userName: nameFor(users, i.userId),
    expires: when(i.expiresAt),
    status: statusLabel(i.status),
    statusKey: i.status,
    canCancel: i.status === 'unused',
  }));
}

export function pairingRows(pairings: readonly PairingSummary[]): PairingRow[] {
  return pairings.slice(0, MAX_ROWS).map((p) => ({
    id: String(p.id),
    userName: plain(p.userName || p.userId, NAME_CHARS),
    userId: plain(p.userId, 64),
    origin: plain(p.origin ?? '', 300),
    created: when(p.createdAt),
    admin: p.admin,
    connected: p.connected,
    self: p.self,
    canRevoke: !p.admin || p.self,
  }));
}
