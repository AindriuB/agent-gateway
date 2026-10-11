import { z } from 'zod';
import { defineTool } from './define.js';
const uuid = z.string().min(1).max(256).describe('Canonical world document UUID');
export const combatManage = defineTool({
  name: 'combat_manage',
  minRole: 'gm',
  category: 'write',
  handledBy: 'module',
  description:
    'Manage an explicit encounter. Progression changes world time and runs native hooks; end deletes it. Initiative creates no chat.',
  input: z.strictObject({
    combatUuid: uuid,
    action: z
      .enum([
        'start',
        'end',
        'next_turn',
        'previous_turn',
        'next_round',
        'add_combatants',
        'remove_combatants',
        'roll_initiative',
      ])
      .describe('Encounter operation'),
    tokenUuids: z
      .array(uuid)
      .min(1)
      .max(20)
      .describe('Selected unique tokens for addition')
      .optional(),
    combatantUuids: z
      .array(uuid)
      .min(1)
      .max(20)
      .describe('Selected unique encounter participants')
      .optional(),
  }),
  output: z.strictObject({
    action: z.string().max(32).describe('Completed operation'),
    uuid,
    completed: z.boolean().describe('Native operation completed'),
    affected: z.array(uuid).max(20).describe('Affected embedded documents'),
    worldTimeDelta: z.number().finite().describe('Native progression time delta in seconds'),
  }),
});
