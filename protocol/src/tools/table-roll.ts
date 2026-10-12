import { z } from 'zod';
import { defineTool } from './define.js';
export const tableRoll = defineTool({
  name: 'table_roll',
  minRole: 'gm',
  category: 'write',
  handledBy: 'module',
  description:
    'Draw bounded nonrecursive results from a world RollTable, optionally posting an AI-marked chat.',
  input: z.strictObject({
    tableUuid: z.string().min(1).max(256).describe('Canonical world RollTable UUID'),
    toChat: z.boolean().default(true).describe('Create one AI-marked result chat'),
    rollMode: z
      .enum(['publicroll', 'gmroll', 'blindroll', 'selfroll'])
      .default('publicroll')
      .describe('Native chat visibility'),
  }),
  output: z.strictObject({
    results: z
      .array(
        z.strictObject({
          text: z.string().max(4000).describe('Inert result text'),
          documentUuid: z.string().min(1).max(256).describe('Referenced document UUID').optional(),
        }),
      )
      .max(20)
      .describe('Drawn results'),
    messageUuid: z.string().min(1).max(256).describe('Created chat UUID').optional(),
  }),
});
