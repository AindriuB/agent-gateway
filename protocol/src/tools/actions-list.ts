import { z } from 'zod';
import { defineTool } from './define.js';
export const actionsListOutput = z.strictObject({
  actorUuid: z.string().min(1).max(256).describe('Canonical Actor UUID'),
  systemId: z.string().min(1).max(100).describe('Active system ID'),
  supported: z.boolean().describe('Whether the system supports actions'),
  actions: z
    .array(
      z.strictObject({
        id: z.string().min(1).max(256).describe('Action ID'),
        name: z.string().max(1000).describe('Action name'),
        description: z.string().max(2000).optional().describe('Action description'),
        group: z.string().max(200).optional().describe('Action group'),
        cost: z.string().max(200).optional().describe('Action cost'),
        uses: z.string().max(200).optional().describe('Remaining uses'),
      }),
    )
    .max(128)
    .describe('Available system actions'),
});
export type ActionsListOutput = z.infer<typeof actionsListOutput>;
export const actionsList = defineTool({
  name: 'actions_list',
  minRole: 'player',
  category: 'read',
  handledBy: 'module',
  description:
    'List system actions for an owned world Actor; unsupported systems return an empty list.',
  input: z.strictObject({
    actorUuid: z.string().min(1).max(256).describe('Canonical owned world Actor UUID'),
  }),
  output: actionsListOutput,
});
