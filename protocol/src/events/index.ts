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
