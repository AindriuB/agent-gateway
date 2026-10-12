import { z } from 'zod';
import { defineTool } from './define.js';
export const notify = defineTool({
  name: 'notify',
  minRole: 'gm',
  category: 'write',
  handledBy: 'module',
  description:
    'Send transient, plain-text AI-marked on-screen notifications to active world users.',
  input: z.strictObject({
    message: z.string().min(1).max(300).describe('Plain-text message'),
    level: z.enum(['info', 'warn', 'error']).default('info').describe('Notification severity'),
    users: z
      .array(z.string().min(1).max(100))
      .min(1)
      .max(20)
      .describe('Unique native active User IDs; defaults to all active users')
      .optional(),
  }),
  output: z.strictObject({
    users: z.array(z.string().min(1).max(100)).max(20).describe('Requested recipient IDs'),
    relayed: z
      .boolean()
      .describe('Server accepted remote relay; does not establish recipient display'),
    local: z.boolean().describe('Displayed on the invoking GM client'),
  }),
});
