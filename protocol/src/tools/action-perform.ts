import { z } from 'zod';
import { defineTool } from './define.js';
export const actionPerformOutput = z.strictObject({
  actorUuid: z.string().min(1).max(256).describe('Canonical Actor UUID'),
  systemId: z.string().min(1).max(100).describe('Active system ID'),
  completed: z.boolean().describe('Whether the action completed'),
  message: z.string().max(2000).describe('Native action outcome'),
});
export type ActionPerformOutput = z.infer<typeof actionPerformOutput>;
export const actionPerform = defineTool({
  name: 'action_perform',
  minRole: 'player',
  category: 'write',
  handledBy: 'module',
  description:
    'Perform a listed system action for an owned world Actor through native system behavior.',
  input: z.strictObject({
    actorUuid: z.string().min(1).max(256).describe('Canonical owned world Actor UUID'),
    actionId: z.string().min(1).max(256).describe('System action ID from actions_list'),
    options: z
      .string()
      .max(8192)
      .optional()
      .describe('Bounded inert JSON object of system action options'),
  }),
  output: actionPerformOutput,
});
