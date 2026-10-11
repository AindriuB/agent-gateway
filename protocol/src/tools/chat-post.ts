import { z } from 'zod';
import { defineTool } from './define.js';

export const chatPost = defineTool({
  name: 'chat_post',
  minRole: 'player',
  category: 'write',
  handledBy: 'module',
  description:
    'Post Markdown chat with a permanent visible AI marker, optionally as an owned actor or whispered to named users. Requires owner approval by default.',
  input: z.strictObject({
    content: z
      .string()
      .min(1)
      .max(4000)
      .describe('Markdown message, up to 4000 characters; raw HTML is escaped'),
    speakerActorUuid: z
      .string()
      .min(1)
      .max(256)
      .optional()
      .describe('UUID of an actor the current user owns'),
    whisperTo: z
      .array(z.string().min(1).max(100))
      .min(1)
      .max(20)
      .optional()
      .describe('Exact unique recipient user names; ambiguous or unknown names are rejected'),
  }),
  output: z.strictObject({
    messageUuid: z.string().max(256).describe('UUID of the created AI-marked message'),
  }),
});
