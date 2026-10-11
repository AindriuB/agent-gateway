import { z } from 'zod';
import { defineTool } from './define.js';
export const targetSet = defineTool({
  name: 'target_set',
  minRole: 'player',
  category: 'write',
  handledBy: 'module',
  description:
    'Replace, add to, or clear only your own visible token targets on the rendered scene.',
  input: z.strictObject({
    tokenUuids: z
      .array(z.string().min(1).max(256).describe('Canonical scene token UUID'))
      .max(10)
      .describe('Tokens to target; must be empty for clear'),
    mode: z.enum(['replace', 'add', 'clear']).describe('How to change your targets'),
  }),
  output: z.strictObject({
    tokenUuids: z
      .array(z.string().max(256).describe('Targeted token UUID'))
      .max(10)
      .describe('Your resulting targets'),
  }),
});
