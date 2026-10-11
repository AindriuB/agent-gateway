import { z } from 'zod';
import { defineTool } from './define.js';
export const combatEndTurn = defineTool({
  name: 'combat_end_turn',
  minRole: 'player',
  category: 'write',
  handledBy: 'module',
  description: 'End the current combat turn only when you own its current combatant.',
  input: z.strictObject({
    combatUuid: z
      .string()
      .min(1)
      .max(256)
      .describe('Expected current combat UUID from combat_status'),
    currentCombatantUuid: z
      .string()
      .min(1)
      .max(256)
      .describe('Expected visible current combatant UUID from combat_status'),
    round: z
      .number()
      .int()
      .min(1)
      .max(999999)
      .describe('Expected current round from combat_status'),
    turn: z
      .number()
      .int()
      .min(0)
      .max(999)
      .describe('Expected current turn index from combat_status'),
  }),
  output: z.strictObject({
    combatUuid: z.string().max(256).describe('Updated combat UUID'),
    round: z.number().int().min(0).max(1000000).describe('Resulting round'),
    turn: z.number().int().min(0).max(999).optional().describe('Resulting turn index, when set'),
  }),
});
