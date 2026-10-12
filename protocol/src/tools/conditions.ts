import { z } from 'zod';
import { defineTool } from './define.js';
export const conditionsOutput = z.strictObject({
  actorUuid: z.string().min(1).max(256).describe('Canonical Actor UUID'),
  systemId: z.string().min(1).max(100).describe('Active system ID'),
  supported: z.boolean().describe('Whether system conditions are supported'),
  conditions: z
    .array(
      z.strictObject({
        id: z.string().min(1).max(256).describe('Condition ID'),
        name: z.string().max(1000).describe('Condition name'),
        value: z.number().finite().min(0).max(1000).optional().describe('Condition value'),
      }),
    )
    .max(128)
    .describe('Active system conditions'),
});
export type ConditionsOutput = z.infer<typeof conditionsOutput>;
export const conditions = defineTool({
  name: 'conditions',
  minRole: 'player',
  category: 'read',
  handledBy: 'module',
  description:
    'Read conditions on an owned world Actor, or request a change under write policy and approval.',
  input: z.strictObject({
    actorUuid: z.string().min(1).max(256).describe('Canonical owned world Actor UUID'),
    change: z
      .strictObject({
        id: z.string().min(1).max(256).describe('Condition ID'),
        active: z.boolean().describe('Desired condition state'),
        value: z.number().int().min(0).max(1000).optional().describe('Desired valued condition'),
      })
      .optional()
      .describe('Optional condition change requiring write policy and approval'),
  }),
  output: conditionsOutput,
});
