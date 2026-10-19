import { AgentEvent } from '../events/index.js';
export { AgentEvent, EventType, EVENT_CONFIG } from '../events/index.js';
import { snapshotToolsetValue } from './toolset-value.js';
import { z } from 'zod';
import { TOOL_LIMITS } from '../tools/limits.js';
import type { AnnouncedTool } from '../tools/pack.js';
import { ErrorCode } from './errors.js';
import { IMAGE_MIME_TYPES } from '../images/sniff.js';

export const MAX_FRAME_BYTES = 1024 * 1024;

export const HelloMessage = z.strictObject({
  type: z.literal('hello'),
  protocolVersion: z.string(),
  moduleVersion: z.string(),
  foundryVersion: z.string(),
  world: z.strictObject({
    id: z.string().max(64),
    title: z.string(),
    system: z.string(),
    systemVersion: z.string(),
  }),
  user: z.strictObject({
    id: z.string().max(64),
    name: z.string().max(100),
    role: z.number().int(),
    isGM: z.boolean(),
  }),
  /** Sent only by the gateway's own headless runner; informational, the gateway classifies itself. */
  headless: z.literal(true).optional(),
  resume: z
    .strictObject({
      connectionId: z.string().min(1).max(100),
      lastSeq: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    })
    .optional(),
  auth: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('pairingCode'), code: z.string().max(64) }),
    z.strictObject({ kind: z.literal('pairingToken'), token: z.string() }),
  ]),
});

export const WelcomeMessage = z.strictObject({
  type: z.literal('welcome'),
  gatewayVersion: z.string(),
  protocolVersion: z.string(),
  connectionId: z.string(),
  agentId: z.string(),
  pairingToken: z.string().optional(),
  /** Operator-set admin flag of the pairing at this moment; never derived from `hello.user.isGM`. */
  admin: z.boolean().optional(),
  /**
   * Sent only to a connection the gateway classifies as headless from its own configuration: the
   * Foundry user id that approvals for this agent should reach. A routing hint, not a permission.
   */
  ownerUserId: z.string().max(64).optional(),
  /** True only for a connection the gateway itself classified as the headless agent. */
  headless: z.boolean().optional(),
});

export const RejectMessage = z.strictObject({
  type: z.literal('reject'),
  code: ErrorCode,
  message: z.string(),
});

export const CallMessage = z.strictObject({
  type: z.literal('call'),
  id: z.string(),
  sessionId: z.string(),
  tool: z.string(),
  args: z.record(z.string(), z.unknown()),
});

/** Raw image cap (512 KiB) from the task 52 findings; its base64 form is at most this many chars. */
export const MAX_RESULT_IMAGE_BASE64_CHARS = Math.ceil((512 * 1024) / 3) * 4;

export const ResultImage = z.strictObject({
  mimeType: z.enum(IMAGE_MIME_TYPES),
  data: z
    .string()
    .max(MAX_RESULT_IMAGE_BASE64_CHARS)
    .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/)
    .min(4),
});
export type ResultImage = z.infer<typeof ResultImage>;

export const ResultMessage = z.strictObject({
  type: z.literal('result'),
  id: z.string(),
  ok: z.literal(true),
  text: z.string(),
  structured: z.unknown().optional(),
  images: z.array(ResultImage).max(1).optional(),
});

export const ErrorMessage = z.strictObject({
  type: z.literal('error'),
  id: z.string(),
  code: ErrorCode,
  message: z.string(),
  /** Set on a refused invite-management request, so the module can match the answer. */
  requestId: z.string().min(1).max(100).optional(),
});

export const PingMessage = z.strictObject({ type: z.literal('ping') });
export const PongMessage = z.strictObject({ type: z.literal('pong') });

/** Full definitions for the user's current role and policy; the module re-checks every call. */
export const ToolsetMessage = z.strictObject({
  type: z.literal('toolset'),
  eventReadAllowed: z.boolean().optional(),
  tools: z
    .array(
      z.custom<AnnouncedTool>((value) => {
        const snapshot = snapshotToolsetValue(value, 1);
        if (
          !snapshot.ok ||
          !snapshot.value ||
          typeof snapshot.value !== 'object' ||
          Array.isArray(snapshot.value)
        )
          return false;
        const t = snapshot.value as Record<string, unknown>;
        return (
          typeof t.name === 'string' &&
          typeof t.description === 'string' &&
          typeof t.category === 'string' &&
          ['read', 'write', 'destructive', 'code'].includes(t.category) &&
          typeof t.minRole === 'string' &&
          ['player', 'gm'].includes(t.minRole) &&
          t.inputSchema !== null &&
          typeof t.inputSchema === 'object' &&
          !Array.isArray(t.inputSchema) &&
          t.outputSchema !== null &&
          typeof t.outputSchema === 'object' &&
          !Array.isArray(t.outputSchema) &&
          (t.pack === undefined ||
            (t.pack !== null &&
              typeof t.pack === 'object' &&
              !Array.isArray(t.pack) &&
              ['id', 'version', 'prefix'].every(
                (k) => typeof (t.pack as Record<string, unknown>)[k] === 'string',
              )))
        );
      }),
    )
    .max(TOOL_LIMITS.announcementTools)
    .refine((tools) => {
      const snapshot = snapshotToolsetValue(tools);
      if (!snapshot.ok) return false;
      try {
        return (
          new TextEncoder().encode(JSON.stringify({ type: 'toolset', tools: snapshot.value }))
            .length <= TOOL_LIMITS.announcementBytes
        );
      } catch {
        return false;
      }
    }, 'toolset exceeds announcement byte cap'),
});

export const EventMessage = z.strictObject({ type: z.literal('event'), event: AgentEvent });

export const EventPolicyMessage = z.strictObject({
  type: z.literal('eventPolicy'),
  enabled: z.boolean(),
  retentionDays: z.number().int().min(1).max(365),
});
export const PurgeEventsMessage = z.strictObject({
  type: z.literal('purgeEvents'),
  requestId: z.string().min(1).max(100),
});
export const PurgeEventsResultMessage = z.strictObject({
  type: z.literal('purgeEventsResult'),
  requestId: z.string().min(1).max(100),
  count: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
});

/** Gateway-generated receipt identity; transport calls and public arguments cannot carry it. */
export const QueuedCall = z.strictObject({
  id: z.string().regex(/^[A-Za-z0-9_-]{32}$/),
  sessionId: z.string().min(1).max(100),
  definition: ToolsetMessage.shape.tools.element,
  tool: z.string().min(1).max(100),
  args: z.record(z.string(), z.unknown()),
  expiresAt: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});
export const QueuedCallsMessage = z.strictObject({
  type: z.literal('queuedCalls'),
  calls: z.array(QueuedCall).min(1).max(5),
});
export const QueuedStatusMessage = z
  .strictObject({
    type: z.literal('queuedStatus'),
    id: QueuedCall.shape.id,
    status: z.enum(['pending', 'approved', 'denied', 'expired', 'unknown']),
    text: z.string().max(4000),
    resultFailed: z.boolean().optional(),
  })
  .refine((r) => r.resultFailed === undefined || r.status === 'approved', {
    message: 'Only approved execution results carry resultFailed',
  });

/** Remote-client grants (task 67). The gateway takes the user from the connection, never from here. */
export const GrantScope = z.enum(['read', 'write', 'destructive', 'code']);
export const ListGrantsMessage = z.strictObject({
  type: z.literal('listGrants'),
  requestId: z.string().min(1).max(100),
});
export const RevokeGrantMessage = z.strictObject({
  type: z.literal('revokeGrant'),
  requestId: z.string().min(1).max(100),
  grantId: z.string().min(1).max(100),
});
export const GrantsMessage = z.strictObject({
  type: z.literal('grants'),
  requestId: z.string().min(1).max(100),
  grants: z
    .array(
      z.strictObject({
        id: z.string().min(1).max(100),
        clientName: z.string().max(200),
        scopes: z.array(GrantScope).max(4),
        createdAt: z.number().int().min(0),
        lastUsedAt: z.number().int().min(0).nullable(),
      }),
    )
    .max(200),
});
/** The one-time consent code, sent only to the chosen user's own connection. */
export const ConsentCodeMessage = z.strictObject({
  type: z.literal('consentCode'),
  code: z.string().min(1).max(32),
  clientName: z.string().max(200),
  scopes: z.array(GrantScope).max(4),
  expiresAt: z.number().int().min(0),
  /** Set when the code is for a headless agent and goes to its owner (task 98). */
  forAgent: z.strictObject({ userId: z.string().max(200), name: z.string().max(200) }).optional(),
});

/** Sent to a pending server-mode redeemer: post a whispered, flagged chat message carrying this nonce. */
export const PairingChallengeMessage = z.strictObject({
  type: z.literal('pairingChallenge'),
  nonce: z.string().min(1).max(200),
  expiresAt: z.number().int().min(0),
});
/** An admin GM's module vouches for the author Foundry recorded on a challenge message. */
export const AttestMessage = z.strictObject({
  type: z.literal('attest'),
  nonce: z.string().min(1).max(200),
  authorId: z.string().min(1).max(64),
  authorIsGM: z.boolean(),
});
/** The gateway's answer to an `attest` it acted on (7.3+ modules only; task 157). */
export const AttestResultMessage = z.strictObject({
  type: z.literal('attestResult'),
  nonce: z.string().min(1).max(200),
  outcome: z.enum(['paired', 'refused']),
});

/**
 * Delegated invites (task 92). An admin GM manages invites for player users of its own world. No
 * message names a world: the gateway scopes every one by the connection's binding.
 */
export const CreateInviteMessage = z.strictObject({
  type: z.literal('createInvite'),
  requestId: z.string().min(1).max(100),
  userId: z.string().min(1).max(64),
  ttlMs: z.number().int().optional(),
});
export const ListInvitesMessage = z.strictObject({
  type: z.literal('listInvites'),
  requestId: z.string().min(1).max(100),
});
export const CancelInviteMessage = z.strictObject({
  type: z.literal('cancelInvite'),
  requestId: z.string().min(1).max(100),
  inviteId: z.string().min(1).max(100),
});
/** The only place the code ever appears. */
export const InviteCreatedMessage = z.strictObject({
  type: z.literal('inviteCreated'),
  requestId: z.string().min(1).max(100),
  inviteId: z.string().min(1).max(100),
  code: z.string().min(1).max(64),
  expiresAt: z.number().int().min(0),
});
export const InviteStatus = z.enum(['unused', 'paired', 'mismatch', 'expired', 'cancelled']);
export const InvitesMessage = z.strictObject({
  type: z.literal('invites'),
  requestId: z.string().min(1).max(100),
  invites: z
    .array(
      z.strictObject({
        id: z.string().min(1).max(100),
        userId: z.string().min(1).max(64),
        createdAt: z.number().int().min(0),
        expiresAt: z.number().int().min(0),
        status: InviteStatus,
      }),
    )
    .max(200),
});

/**
 * Pairing management (task 93). An admin GM lists and revokes the pairings of its own world. No
 * message names a world, and no reply carries a token or its hash.
 */
export const ListPairingsMessage = z.strictObject({
  type: z.literal('listPairings'),
  requestId: z.string().min(1).max(100),
});
export const RevokePairingMessage = z.strictObject({
  type: z.literal('revokePairing'),
  requestId: z.string().min(1).max(100),
  pairingId: z.string().min(1).max(100),
});
export const PairingsMessage = z.strictObject({
  type: z.literal('pairings'),
  requestId: z.string().min(1).max(100),
  pairings: z
    .array(
      z.strictObject({
        id: z.string().min(1).max(100),
        userId: z.string().min(1).max(64),
        userName: z.string().max(200),
        origin: z.string().max(300).nullable(),
        createdAt: z.number().int().min(0),
        admin: z.boolean(),
        connected: z.boolean(),
        self: z.boolean(),
      }),
    )
    .max(200),
});

/**
 * Per-player grants view (task 94). The admin GM sees the metadata of the apps a player in its own
 * world has authorized, and can revoke them. No message names a world; no reply carries a token,
 * hash or secret. A grant is the player's summary without its last-used time.
 */
export const ListUserGrantsMessage = z.strictObject({
  type: z.literal('listUserGrants'),
  requestId: z.string().min(1).max(100),
  userId: z.string().min(1).max(64),
});
export const RevokeUserGrantMessage = z.strictObject({
  type: z.literal('revokeUserGrant'),
  requestId: z.string().min(1).max(100),
  userId: z.string().min(1).max(64),
  grantId: z.string().min(1).max(100),
});
export const UserGrantsMessage = z.strictObject({
  type: z.literal('userGrants'),
  requestId: z.string().min(1).max(100),
  userId: z.string().min(1).max(64),
  // Metadata only: no `lastUsedAt`, which would be per-player activity tracking (Amendment 1).
  grants: z
    .array(
      z.strictObject({
        id: z.string().min(1).max(100),
        clientName: z.string().max(200),
        scopes: z.array(GrantScope).max(4),
        createdAt: z.number().int().min(0),
      }),
    )
    .max(200),
});

/**
 * Approval state mirror (task 112, protocol 7.2.0), module to gateway. Either one transition of an
 * approval the module created this page session (`id` + `state`), or the list of ids still pending,
 * sent once after each `welcome` (`ids`). The gateway takes the owner from the connection.
 */
export const MAX_APPROVAL_STATE_IDS = 256;
export const ApprovalStateMessage = z
  .strictObject({
    type: z.literal('approvalState'),
    id: z.string().min(1).max(64).optional(),
    state: z.enum(['pending', 'approved', 'denied', 'expired']).optional(),
    ids: z.array(z.string().min(1).max(64)).max(MAX_APPROVAL_STATE_IDS).optional(),
  })
  .refine(
    (r) =>
      r.ids !== undefined
        ? r.id === undefined && r.state === undefined
        : r.id !== undefined && r.state !== undefined,
    { message: 'approvalState is either a transition (id, state) or a list (ids)' },
  );

/**
 * The reply to the module's post-hello `approvalState` list (task 112, protocol 7.2.0), gateway to
 * module: which of the listed approval ids this connection now owns (`ids`), and which it holds no
 * row for (`unknown`). The module keeps both, and withdraws only listed ids that appear in neither;
 * records created after the list was sent are untouched.
 */
export const ApprovalOwnershipMessage = z.strictObject({
  type: z.literal('approvalOwnership'),
  /** Owned by this connection: keep and release. */
  ids: z.array(z.string().min(1).max(64)).max(MAX_APPROVAL_STATE_IDS),
  /** Listed aliases the gateway holds no row for at all (never mirrored): keep, as before 112. */
  unknown: z.array(z.string().min(1).max(64)).max(MAX_APPROVAL_STATE_IDS).optional(),
});

// Insertion-only: later tasks add schemas above and members below.
export const LinkMessage = z.discriminatedUnion('type', [
  HelloMessage,
  WelcomeMessage,
  RejectMessage,
  CallMessage,
  ResultMessage,
  ErrorMessage,
  PingMessage,
  PongMessage,
  ToolsetMessage,
  EventMessage,
  EventPolicyMessage,
  PurgeEventsMessage,
  PurgeEventsResultMessage,
  QueuedCallsMessage,
  QueuedStatusMessage,
  ListGrantsMessage,
  RevokeGrantMessage,
  GrantsMessage,
  ConsentCodeMessage,
  PairingChallengeMessage,
  AttestMessage,
  AttestResultMessage,
  CreateInviteMessage,
  ListInvitesMessage,
  CancelInviteMessage,
  InviteCreatedMessage,
  InvitesMessage,
  ListPairingsMessage,
  RevokePairingMessage,
  PairingsMessage,
  ListUserGrantsMessage,
  RevokeUserGrantMessage,
  UserGrantsMessage,
  ApprovalStateMessage,
  ApprovalOwnershipMessage,
]);
export type LinkMessage = z.infer<typeof LinkMessage>;

export type ParseResult =
  | { ok: true; message: LinkMessage }
  | { ok: false; reason: 'oversize' | 'malformed' | 'invalid'; message: string };

export function parseLinkMessage(raw: string | Uint8Array): ParseResult {
  const bytes = typeof raw === 'string' ? new TextEncoder().encode(raw).byteLength : raw.byteLength;
  if (bytes > MAX_FRAME_BYTES) {
    return {
      ok: false,
      reason: 'oversize',
      message: `Frame of ${bytes} bytes exceeds limit ${MAX_FRAME_BYTES}`,
    };
  }
  const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'malformed', message: 'Frame is not valid JSON' };
  }
  let parsed: ReturnType<typeof LinkMessage.safeParse>;
  try {
    parsed = LinkMessage.safeParse(json);
  } catch {
    return { ok: false, reason: 'invalid', message: 'Frame cannot be validated safely' };
  }
  if (!parsed.success) {
    return { ok: false, reason: 'invalid', message: parsed.error.message };
  }
  return { ok: true, message: parsed.data };
}
