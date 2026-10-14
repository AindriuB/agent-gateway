import { AgentEvent } from '../events/index.js';
export { AgentEvent, EventType, EVENT_CONFIG } from '../events/index.js';
import { snapshotToolsetValue } from './toolset-value.js';
import { z } from 'zod';
import { TOOL_LIMITS } from '../tools/limits.js';
import type { AnnouncedTool } from '../tools/pack.js';
import { ErrorCode } from './errors.js';

export const MAX_FRAME_BYTES = 1024 * 1024;

export const HelloMessage = z.strictObject({
  type: z.literal('hello'),
  protocolVersion: z.string(),
  moduleVersion: z.string(),
  foundryVersion: z.string(),
  world: z.strictObject({
    id: z.string(),
    title: z.string(),
    system: z.string(),
    systemVersion: z.string(),
  }),
  user: z.strictObject({
    id: z.string(),
    name: z.string(),
    role: z.number().int(),
    isGM: z.boolean(),
  }),
  resume: z
    .strictObject({
      connectionId: z.string().min(1).max(100),
      lastSeq: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    })
    .optional(),
  auth: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('pairingCode'), code: z.string() }),
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

export const ResultMessage = z.strictObject({
  type: z.literal('result'),
  id: z.string(),
  ok: z.literal(true),
  text: z.string(),
  structured: z.unknown().optional(),
});

export const ErrorMessage = z.strictObject({
  type: z.literal('error'),
  id: z.string(),
  code: ErrorCode,
  message: z.string(),
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
