import { z } from 'zod';
import { defineTool } from './define.js';
export const combatStatus = defineTool({
  name: 'combat_status',
  minRole: 'player',
  category: 'read',
  handledBy: 'module',
  description:
    'Read the current combat and visible combatants. Hidden combatants and their turn identity are omitted for players.',
  input: z.strictObject({}),
  output: z.strictObject({
    active: z.boolean().describe('Whether a current combat exists'),
    combatUuid: z.string().max(256).optional().describe('Current combat UUID'),
    round: z.number().int().min(0).max(1000000).optional().describe('Current round'),
    turn: z.number().int().min(0).max(999).optional().describe('Current turn index, when set'),
    currentCombatantUuid: z
      .string()
      .max(256)
      .optional()
      .describe('Current combatant UUID, only when visible'),
    combatants: z
      .array(
        z.strictObject({
          uuid: z.string().max(256).describe('Visible combatant UUID'),
          name: z.string().max(1000).describe('Visible combatant name'),
          initiative: z.number().finite().optional().describe('Initiative when assigned'),
          defeated: z.boolean().describe('Whether this combatant is defeated'),
        }),
      )
      .max(1000)
      .describe('Visible combatants in turn order'),
  }),
});
