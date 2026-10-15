import type { LinkMessage } from '@agent-gateway/protocol';
import { listGrantSummaries, revokeOwnGrant } from '../oauth/grants/index.js';
import type { Store } from '../store/index.js';
import { takeLinkAdminMessage } from './invite-admin.js';
import type { LinkConnection } from './registry.js';

type UserGrantRequest = Extract<LinkMessage, { type: 'listUserGrants' | 'revokeUserGrant' }>;

/** The stored row decides, read now: never the hello and never a cached value. */
function senderIsAdmin(store: Store, conn: LinkConnection): boolean {
  const row = store.getPairing(conn.agentId);
  return (
    !!row &&
    row.revokedAt === null &&
    row.admin &&
    row.worldId === conn.worldId &&
    row.userId === conn.userId
  );
}

/**
 * Answer `listUserGrants` and `revokeUserGrant` for an admin GM. Every read and write is bound to
 * `(conn.worldId, msg.userId)`: the world is the connection's own binding and no message names one.
 * The reply is the grant summary only; no token, hash or client secret is read into it. The
 * caller has already checked the connection is still the live one.
 */
export function handleUserGrantMessage(
  conn: LinkConnection,
  msg: UserGrantRequest,
  store: Store,
  send: (m: LinkMessage) => void,
  now: () => number = Date.now,
): void {
  const fail = (
    code: 'FORBIDDEN' | 'INVALID_ARGS' | 'RATE_LIMITED' | 'INTERNAL',
    message: string,
  ) => send({ type: 'error', id: '', requestId: msg.requestId, code, message });
  if (!senderIsAdmin(store, conn)) {
    fail('FORBIDDEN', 'not an admin GM');
    return;
  }
  const at = now();
  if (!takeLinkAdminMessage(conn, at)) {
    fail('RATE_LIMITED', 'too many grant requests');
    return;
  }
  try {
    // Another admin GM's grants are theirs alone, whichever pairing they connect with.
    const otherAdmin = store
      .listActivePairings()
      .some(
        (p) =>
          p.worldId === conn.worldId && p.userId === msg.userId && p.admin && p.id !== conn.agentId,
      );
    if (otherAdmin) {
      fail('FORBIDDEN', 'another admin GM cannot be managed here');
      return;
    }
    if (
      msg.type === 'revokeUserGrant' &&
      // An unknown id and one from another world or user answer alike.
      !revokeOwnGrant(store.oauth, conn.worldId, msg.userId, msg.grantId, at)
    ) {
      fail('INVALID_ARGS', 'no such grant');
      return;
    }
    send({
      type: 'userGrants',
      requestId: msg.requestId,
      userId: msg.userId,
      grants: listGrantSummaries(store.oauth, conn.worldId, msg.userId),
    });
  } catch {
    fail('INTERNAL', 'could not complete the grants request');
  }
}
