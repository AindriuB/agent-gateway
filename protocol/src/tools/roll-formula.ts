import { z } from 'zod';
import { defineTool } from './define.js';

export const rollFormula = defineTool({
  name: 'roll_formula',
  minRole: 'player',
  category: 'write',
  handledBy: 'module',
  description:
    'Evaluate bounded arithmetic and dice (up to 100 dice, 1000 faces, 8 parenthesis levels). Posts an AI-marked roll by default; requires owner approval.',
  input: z.strictObject({
    formula: z
      .string()
      .min(1)
      .max(200)
      .describe(
        'Numbers, dice such as 2d6, parentheses and + - * / only; no attributes, functions or dice modifiers',
      ),
    flavor: z.string().max(1000).optional().describe('Optional plain-text roll description'),
    toChat: z.boolean().default(true).describe('Whether to create an AI-marked chat message'),
  }),
  output: z.strictObject({
    total: z.number().finite().describe('Evaluated roll total'),
    terms: z
      .array(
        z.strictObject({
          formula: z.string().max(200).describe('A bounded roll term'),
          total: z.number().finite().optional().describe('Term total where applicable'),
        }),
      )
      .max(128)
      .describe('Evaluated terms'),
    messageUuid: z
      .string()
      .max(256)
      .optional()
      .describe('Created chat message UUID, when toChat is true'),
  }),
});
