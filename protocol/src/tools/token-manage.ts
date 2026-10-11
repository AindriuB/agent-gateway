import { z } from 'zod';
import { defineTool } from './define.js';
const uuid = z.string().min(1).max(256).describe('Canonical world document UUID');
const coordinate = z
  .number()
  .finite()
  .min(-1000000)
  .max(1000000)
  .describe('Token top-left coordinate in scene pixels');
export const tokenManage = defineTool({
  name: 'token_manage',
  minRole: 'gm',
  category: 'write',
  handledBy: 'module',
  description:
    'Place, hide, show or remove one scene token. Removal needs destructive approval and refuses combat-linked tokens.',
  input: z.strictObject({
    action: z.enum(['place', 'hide', 'show', 'remove']).describe('Token operation'),
    sceneUuid: uuid.optional(),
    actorUuid: uuid.optional(),
    tokenUuid: uuid.optional(),
    x: coordinate.optional(),
    y: coordinate.optional(),
    hidden: z.boolean().describe('Initial token visibility').optional(),
    rotation: z
      .number()
      .finite()
      .min(0)
      .max(360)
      .describe('Initial rotation in degrees')
      .optional(),
  }),
  output: z.strictObject({
    action: z.string().max(32).describe('Completed operation'),
    uuid,
    completed: z.boolean().describe('Native operation completed'),
  }),
});
