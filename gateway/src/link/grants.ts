import type { LinkMessage } from '@agent-gateway/protocol';
import { listGrantSummaries, revokeOwnGrant } from '../oauth/grants/index.js';
import type { OAuthRepository } from '../oauth/repository.js';
import type { LinkConnection } from './registry.js';

/**
 * Answer `listGrants` and `revokeGrant` for the connection that sent them. The (world, user) is
 * the connection's own binding; the message carries a request id and, for a revoke, a grant id,
 * and nothing that names a user.
 */
export function handleGrantMessage(
  conn: LinkConnection,
  msg: Extract<LinkMessage, { type: 'listGrants' | 'revokeGrant' }>,
  repo: OAuthRepository,
  send: (m: LinkMessage) => void,
  now: () => number = Date.now,
): void {
  if (msg.type === 'revokeGrant')
    revokeOwnGrant(repo, conn.worldId, conn.userId, msg.grantId, now());
  send({
    type: 'grants',
    requestId: msg.requestId,
    grants: listGrantSummaries(repo, conn.worldId, conn.userId),
  });
}
