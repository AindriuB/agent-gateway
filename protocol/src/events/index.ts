import { z } from 'zod';

export const EVENT_CONFIG = Object.freeze({ COALESCE_MS: 500, MAX_PENDING_UPDATES: 256 });
export const EventType = z.enum([
  'chat',
  'roll',
  'combat_start',
  'combat_end',
  'combat_turn',
  'combat_round',
  'actor_create',
  'actor_update',
  'actor_delete',
  'item_create',
  'item_update',
  'item_delete',
  'journal_create',
  'journal_update',
  'journal_delete',
  'scene_create',
  'scene_update',
  'scene_delete',
  'token_create',
  'token_update',
  'token_delete',
  'user_join',
  'user_leave',
  'scene_change',
  'approval_requested',
  'approval_resolved',
  'agent_action',
  'gap',
]);
export const AgentEvent = z.strictObject({
  seq: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  ts: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  type: EventType,
  userId: z.string().min(1).max(100),
  doc: z
    .strictObject({
      uuid: z.string().min(1).max(2048),
      type: z.string().min(1).max(100),
      name: z.string().max(200),
    })
    .optional(),
  summary: z.string().max(200),
  agent_action: z.boolean().optional(),
});
export type AgentEvent = z.infer<typeof AgentEvent>;

/** Gateway limits; independent of the module's connection-local sequence. */
export const EVENT_BUFFER_CONFIG = Object.freeze({
  EVENT_BUFFER_SIZE: 10_000,
  POLL_LIMIT: 100,
  POLL_TIMEOUT_MS: 25_000,
  MAX_PENDING_POLLS: 64,
});
const cursor = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
export const GatewayGap = z.strictObject({
  type: z.enum(['gap']).describe('Gateway-generated connection gap'),
  ts: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).describe('Gateway receipt time'),
  userId: z.string().min(1).max(100).describe('Authenticated observing user'),
  summary: z.string().max(200).describe('Constant connection gap description'),
  missed: z
    .union([z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), z.enum(['unknown'])])
    .describe('Inferable trailing sent events, or unknown; excludes unobserved offline activity'),
});
const describedNativeEvent = AgentEvent.extend({
  seq: AgentEvent.shape.seq.describe('Native connection-local event sequence'),
  ts: AgentEvent.shape.ts.describe('Native client event timestamp'),
  type: AgentEvent.shape.type.describe('Native event type'),
  userId: AgentEvent.shape.userId.describe('Authenticated observing user'),
  doc: z
    .strictObject({
      uuid: z.string().min(1).max(2048).describe('Visible document UUID'),
      type: z.string().min(1).max(100).describe('Visible document type'),
      name: z.string().max(200).describe('Visible document name'),
    })
    .optional()
    .describe('Visible document reference'),
  summary: AgentEvent.shape.summary.describe('Bounded plain event summary'),
  agent_action: AgentEvent.shape.agent_action.describe(
    'Whether this event came from an agent action',
  ),
});
export const BufferedEvent = z.strictObject({
  cursor: cursor.describe('Durable gateway cursor independent of native sequence'),
  event: z
    .union([describedNativeEvent, GatewayGap])
    .describe('Native event or gateway connection gap'),
});
export type BufferedEvent = z.infer<typeof BufferedEvent>;
export const EventReadOutput = z.strictObject({
  events: z.array(BufferedEvent).max(100).describe('Buffered events in gateway cursor order'),
  nextAfter: z
    .number()
    .int()
    .min(0)
    .max(Number.MAX_SAFE_INTEGER)
    .describe('Cursor for the next poll'),
  cursorGap: z
    .strictObject({
      after: z
        .number()
        .int()
        .min(0)
        .max(Number.MAX_SAFE_INTEGER)
        .describe('Requested cursor before eviction'),
      firstAvailable: cursor.describe(
        'First retained cursor, or next boundary after acknowledged eviction',
      ),
    })
    .optional()
    .describe('Explicit indication that an earlier interval was evicted'),
});
export type EventReadOutput = z.infer<typeof EventReadOutput>;
