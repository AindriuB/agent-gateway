import { z } from 'zod';
import { defineTool } from './define.js';
import { EventReadOutput } from '../events/index.js';
export const eventsPoll = defineTool({
  name: 'events_poll',
  minRole: 'player',
  category: 'read',
  handledBy: 'gateway',
  description:
    'Read buffered visible events after a durable gateway cursor. Waits up to 25 seconds when no event is new. Reads do not consume events.',
  input: z.strictObject({
    after: z
      .number()
      .int()
      .min(0)
      .max(Number.MAX_SAFE_INTEGER)
      .optional()
      .describe('Gateway cursor from nextAfter; omitted starts at retained beginning'),
    limit: z.number().int().min(1).max(100).default(100).describe('Maximum events, 1 to 100'),
  }),
  output: EventReadOutput,
});

export {
  BufferedEvent,
  GatewayGap,
  EVENT_BUFFER_CONFIG,
  EventReadOutput,
} from '../events/index.js';
