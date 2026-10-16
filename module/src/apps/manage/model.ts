import type { InviteSummary, PairingSummary, UserGrantSummary } from '../../link/client.js';

export interface InviteRow {
  id: string;
  userName: string;
  expires: string;
  status: string;
  /** One of the protocol's invite statuses. */
  statusKey: string;
  canCancel: boolean;
  /** Open invites only: the GM's browser must be online to confirm the pairing. */
  needsGm: boolean;
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

/** One of a player's grants as an admin sees it: metadata only, never a last-used time. */
export interface AdminGrantRow {
  id: string;
  clientName: string;
  scopes: string;
  created: string;
}

export interface GrantUserRow {
  id: string;
  name: string;
  selected: boolean;
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
    needsGm: i.status === 'unused',
  }));
}

/**
 * The users whose authorized apps the admin GM may view: each paired user once, in pairing order.
 * Another admin GM is left out (the gateway would refuse it); the sender's own row stays.
 */
export function grantUsers(
  pairings: readonly PairingSummary[],
  selected: string | undefined,
): GrantUserRow[] {
  const rows = pairings.slice(0, MAX_ROWS);
  const otherAdmins = new Set(rows.filter((p) => p.admin && !p.self).map((p) => p.userId));
  const seen = new Set<string>();
  const out: GrantUserRow[] = [];
  for (const p of rows) {
    if (otherAdmins.has(p.userId) || seen.has(p.userId)) continue;
    seen.add(p.userId);
    out.push({
      id: plain(p.userId, 64),
      name: plain(p.userName || p.userId, NAME_CHARS),
      selected: false,
    });
  }
  const pick = out.find((u) => u.id === selected) ?? out[0];
  if (pick) pick.selected = true;
  return out;
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

/** Plain strings for the template, which prints every one with `{{ }}` (escaped). */
export function adminGrantRows(grants: readonly UserGrantSummary[]): AdminGrantRow[] {
  return grants.slice(0, MAX_ROWS).map((g) => ({
    id: String(g.id),
    clientName: plain(g.clientName, NAME_CHARS),
    scopes: g.scopes.join(', '),
    created: when(g.createdAt),
  }));
}
