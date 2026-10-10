import { z } from 'zod';
import { defineTool } from './define.js';

export const worldInfo = defineTool({
  name: 'world_info',
  minRole: 'player',
  category: 'read',
  handledBy: 'module',
  description:
    'Describe the running world: world, game system, Foundry version, the user you act as, the active scene and whether combat is active.',
  input: z.strictObject({}),
  output: z.strictObject({
    worldId: z.string().describe('World id'),
    worldTitle: z.string().describe('World title'),
    systemId: z.string().describe('Game system id'),
    systemVersion: z.string().describe('Game system version'),
    foundryGeneration: z.number().int().describe('Foundry generation (13 or 14)'),
    userName: z.string().describe('Name of the user the agent acts as'),
    userRole: z
      .string()
      .describe('Role of that user: NONE, PLAYER, TRUSTED, ASSISTANT or GAMEMASTER'),
    activeScene: z.string().describe('Name of the active scene, or empty when there is none'),
    combatActive: z.boolean().describe('Whether a combat is active'),
  }),
});
