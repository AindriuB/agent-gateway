import { z } from 'zod';
import { defineTool } from './define.js';
import { EventReadOutput, EventType } from '../events/index.js';
export const eventsHistory = defineTool({
  name: 'events_history',
  minRole: 'player',
  category: 'read',
  handledBy: 'gateway',
  description:
    'Read buffered events by gateway receipt time and event type. Available only when offline event reading is enabled by the world.',
  input: z.strictObject({
    since: z
      .string()
      .max(100)
      .refine(
        (v) =>
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(v) &&
          Number.isFinite(Date.parse(v)) &&
          new Date(v).toISOString().slice(0, 19) === v.slice(0, 19),
      )
      .describe('UTC ISO timestamp; filters gateway receipt time'),
    types: z
      .array(EventType)
      .max(32)
      .optional()
      .describe('Event types to include; omitted includes every type'),
    limit: z.number().int().min(1).max(100).default(100).describe('Maximum events, 1 to 100'),
  }),
  output: EventReadOutput,
});
