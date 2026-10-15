import type { LinkMessage } from '@agent-gateway/protocol';
import type { PairingRow, Store } from '../store/index.js';
import { takeLinkAdminMessage } from './invite-admin.js';
import type { LinkConnection, LinkRegistry } from './registry.js';

/** The most pairings one `pairings` reply carries (oldest first). */
export const MAX_LISTED_PAIRINGS = 200;

type PairingRequest = Extract<LinkMessage, { type: 'listPairings' | 'revokePairing' }>;

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

function listReply(
  store: Store,
  registry: LinkRegistry,
  conn: LinkConnection,
  requestId: string,
): LinkMessage {
  const rows = store
    .listActivePairings()
    .filter((p) => p.worldId === conn.worldId)
    .slice(0, MAX_LISTED_PAIRINGS);
  // Fields are copied one by one, so the token hash can never ride along.
  return {
    type: 'pairings',
    requestId,
    pairings: rows.map((p) => ({
      id: p.id,
      userId: p.userId,
      userName: p.userName,
      origin: p.origin,
      createdAt: p.createdAt,
      admin: p.admin,
      connected: registry.get(p.worldId, p.userId)?.closed === false,
      self: p.id === conn.agentId,
    })),
  };
}

/**
 * Answer `listPairings` and `revokePairing` for an admin GM. The world is the connection's own
 * binding; no message names one. The caller has already checked the connection is still the live
 * one. Admin status is read from the store row on every message.
 */
export function handlePairingMessage(
  conn: LinkConnection,
  msg: PairingRequest,
  store: Store,
  registry: LinkRegistry,
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
    fail('RATE_LIMITED', 'too many pairing requests');
    return;
  }
  try {
    if (msg.type === 'revokePairing') {
      // A foreign-world, already revoked or unknown id all answer the same.
      const target: PairingRow | undefined = store.getPairing(msg.pairingId);
      if (!target || target.revokedAt !== null || target.worldId !== conn.worldId) {
        fail('INVALID_ARGS', 'no such pairing');
        return;
      }
      const own = target.id === conn.agentId;
      const otherAdmin = store
        .listActivePairings()
        .some(
          (p) =>
            p.worldId === conn.worldId &&
            p.userId === target.userId &&
            p.admin &&
            p.id !== conn.agentId,
        );
      if (!own && (target.admin || otherAdmin)) {
        fail('FORBIDDEN', 'another admin GM cannot be revoked here');
        return;
      }
      // Pairings, grants and unused invites for the user go in one transaction; the socket is
      // closed by the revocation sweep.
      store.revokePairingsFor(conn.worldId, target.userId);
    }
    send(listReply(store, registry, conn, msg.requestId));
  } catch {
    fail('INTERNAL', 'could not complete the pairing request');
  }
}
