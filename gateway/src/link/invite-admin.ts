import type { LinkMessage } from '@agent-gateway/protocol';
import type { InviteRow, Store } from '../store/index.js';
import { INVITE_TTL_MS, MAX_INVITE_TTL_MS, createInvite, holdsAdminPairing } from './invites.js';
import type { LinkConnection } from './registry.js';

/** Unused, unexpired invites a world may hold at once, however they were minted. */
export const MAX_OPEN_INVITES_PER_WORLD = 20;
/** `createInvite` per connection per window. */
export const MAX_CREATES_PER_WINDOW = 10;
export const CREATE_WINDOW_MS = 10 * 60_000;
/** All three message types together, per connection per window. */
export const MAX_INVITE_MESSAGES_PER_WINDOW = 60;
export const INVITE_MESSAGE_WINDOW_MS = 60_000;
/** The most invites one `invites` reply carries (newest first). */
export const MAX_LISTED_INVITES = 100;

type InviteRequest = Extract<
  LinkMessage,
  { type: 'createInvite' | 'listInvites' | 'cancelInvite' }
>;

/** Sliding windows of request times per connection; each array is bounded by its cap. */
const windows = new WeakMap<LinkConnection, { all: number[]; creates: number[] }>();

/** Record a hit if fewer than `max` fall in the last `windowMs`. */
function take(hits: number[], now: number, max: number, windowMs: number): boolean {
  while (hits.length > 0 && hits[0]! <= now - windowMs) hits.shift();
  if (hits.length >= max) return false;
  hits.push(now);
  return true;
}

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

function status(
  row: InviteRow,
  now: number,
): 'unused' | 'paired' | 'mismatch' | 'expired' | 'cancelled' {
  if (row.cancelledAt !== null) return 'cancelled';
  if (row.usedAt !== null)
    return row.result === 'paired' || row.result === 'mismatch' ? row.result : 'expired';
  return row.expiresAt <= now ? 'expired' : 'unused';
}

function listReply(
  store: Store,
  conn: LinkConnection,
  requestId: string,
  now: number,
): LinkMessage {
  return {
    type: 'invites',
    requestId,
    invites: store.invites.listForWorld(conn.worldId, MAX_LISTED_INVITES).map((r) => ({
      id: r.id,
      userId: r.userId,
      createdAt: r.createdAt,
      expiresAt: r.expiresAt,
      status: status(r, now),
    })),
  };
}

/**
 * Answer `createInvite`, `listInvites` and `cancelInvite` for an admin GM. The world is the
 * connection's own binding; no message names one. The caller has already checked the connection is
 * still the live one. Admin status is read from the store row on every message.
 */
export function handleInviteMessage(
  conn: LinkConnection,
  msg: InviteRequest,
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
  let w = windows.get(conn);
  if (!w) windows.set(conn, (w = { all: [], creates: [] }));
  if (!take(w.all, at, MAX_INVITE_MESSAGES_PER_WINDOW, INVITE_MESSAGE_WINDOW_MS)) {
    fail('RATE_LIMITED', 'too many invite requests');
    return;
  }
  try {
    if (msg.type === 'listInvites') {
      send(listReply(store, conn, msg.requestId, at));
    } else if (msg.type === 'cancelInvite') {
      // A foreign-world, used or unknown id all answer the same.
      if (!store.transaction(() => store.invites.cancelInWorld(conn.worldId, msg.inviteId))) {
        fail('INVALID_ARGS', 'no such open invite');
        return;
      }
      send(listReply(store, conn, msg.requestId, at));
    } else {
      if (!take(w.creates, at, MAX_CREATES_PER_WINDOW, CREATE_WINDOW_MS)) {
        fail('RATE_LIMITED', 'too many invites created');
        return;
      }
      const ttlMs = msg.ttlMs ?? INVITE_TTL_MS;
      if (ttlMs <= 0 || ttlMs > MAX_INVITE_TTL_MS) {
        fail('INVALID_ARGS', 'ttlMs must be above 0 and at most 7 days');
        return;
      }
      const made = store.transaction(() => {
        if (holdsAdminPairing(store, conn.worldId, msg.userId)) return 'FORBIDDEN' as const;
        if (store.invites.countUnusedForWorld(conn.worldId, at) >= MAX_OPEN_INVITES_PER_WORLD)
          return 'RATE_LIMITED' as const;
        return createInvite(
          store,
          { worldId: conn.worldId, userId: msg.userId, ttlMs, createdBy: conn.agentId },
          at,
        );
      });
      if (made === 'FORBIDDEN') fail('FORBIDDEN', 'that user is an admin GM');
      else if (made === 'RATE_LIMITED') fail('RATE_LIMITED', 'too many open invites in this world');
      else
        send({
          type: 'inviteCreated',
          requestId: msg.requestId,
          inviteId: made.id,
          code: made.code,
          expiresAt: made.expiresAt,
        });
    }
  } catch {
    fail('INTERNAL', 'could not complete the invite request');
  }
}
