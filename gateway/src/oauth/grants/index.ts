import type { OAuthRepository, Scope } from '../repository.js';

/** What the owner sees of one of their grants. */
export interface GrantSummary {
  id: string;
  clientName: string;
  scopes: Scope[];
  createdAt: number;
  lastUsedAt: number | null;
}

/**
 * The grants bound to one (world, user). The caller passes the identity of an authenticated link
 * connection, never a value read from a message: nothing here can name another user's grants.
 */
export function listGrantSummaries(
  repo: OAuthRepository,
  worldId: string,
  userId: string,
): GrantSummary[] {
  return repo.listLiveGrants(worldId, userId).map((g) => ({
    id: g.id,
    clientName: g.clientName,
    scopes: g.scopes,
    createdAt: g.createdAt,
    lastUsedAt: g.lastUsedAt,
  }));
}

/**
 * Revoke one grant and all its tokens, but only when it is bound to this (world, user). A grant id
 * that is unknown or belongs to someone else changes nothing and gives nothing away.
 */
export function revokeOwnGrant(
  repo: OAuthRepository,
  worldId: string,
  userId: string,
  grantId: string,
  now: number,
): boolean {
  const g = repo.getGrant(grantId);
  if (!g || g.worldId !== worldId || g.userId !== userId) return false;
  return repo.revokeGrant(grantId, now);
}
