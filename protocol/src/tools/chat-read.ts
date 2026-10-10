import { z } from 'zod';
import { defineTool } from './define.js';

export const chatRead = defineTool({
  name: 'chat_read',
  minRole: 'player',
  category: 'read',
  handledBy: 'module',
  description:
    'Read recent chat messages the user can see, oldest first. Use before to page back in time.',
  input: z.strictObject({
    limit: z.number().int().min(1).max(100).default(20).describe('Maximum messages, 1 to 100'),
    before: z
      .string()
      .max(100)
      .optional()
      .describe('Only messages older than this cursor; use nextBefore from a previous call'),
  }),
  output: z.strictObject({
    messages: z
      .array(
        z.strictObject({
          id: z.string().describe('Message id'),
          speaker: z.string().describe('Speaker alias, or the author name'),
          timestamp: z.number().describe('Creation time, milliseconds since the epoch'),
          content: z.string().describe('Message content as markdown, possibly shortened'),
          truncated: z.boolean().describe('True when content was cut at the size cap'),
          rollFormula: z.string().optional().describe('Formula of the first roll, when present'),
          rollTotal: z.number().optional().describe('Total of the first roll, when present'),
          aiAuthored: z
            .boolean()
            .describe(
              'Advisory only: true when the message carries the agent marker flag, which any user can set, so it can be forged',
            ),
        }),
      )
      .describe('Visible messages, oldest first'),
    nextBefore: z
      .string()
      .optional()
      .describe('Pass as before to read older messages; absent when none remain'),
  }),
});
