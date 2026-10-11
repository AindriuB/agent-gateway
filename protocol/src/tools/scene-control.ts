import { z } from 'zod';
import { defineTool } from './define.js';
const uuid = z.string().min(1).max(256).describe('Canonical world scene UUID');
export const sceneControl = defineTool({
  name: 'scene_control',
  minRole: 'gm',
  category: 'write',
  handledBy: 'module',
  description:
    'Activate a scene globally, view it locally, adjust unlocked darkness or view a v14 Scene Level.',
  input: z.strictObject({
    sceneUuid: uuid,
    action: z.enum(['activate', 'view', 'set_darkness', 'set_level']).describe('Scene operation'),
    darkness: z
      .number()
      .finite()
      .min(0)
      .max(1)
      .describe('Native environment darkness level')
      .optional(),
    levelId: z.string().min(1).max(100).describe('Existing scene level ID').optional(),
  }),
  output: z.strictObject({
    action: z.string().max(32).describe('Completed operation'),
    uuid,
    completed: z.boolean().describe('Native operation completed'),
  }),
});
