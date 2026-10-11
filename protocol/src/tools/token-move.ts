import { z } from 'zod';
import { defineTool } from './define.js';
const point = z.strictObject({
  x: z.number().finite().min(0).max(1000000).describe('Horizontal coordinate in grid-size units'),
  y: z.number().finite().min(0).max(1000000).describe('Vertical coordinate in grid-size units'),
});
export const tokenMove = defineTool({
  name: 'token_move',
  minRole: 'player',
  category: 'write',
  handledBy: 'module',
  description:
    'Move an owned token on the rendered scene using normal movement rules. Supply x/y or a path, never both.',
  input: z.strictObject({
    tokenUuid: z.string().min(1).max(256).describe('Canonical scene token UUID'),
    x: point.shape.x.optional(),
    y: point.shape.y.optional(),
    path: z.array(point).min(1).max(20).optional().describe('Up to twenty grid-unit waypoints'),
  }),
  output: z.strictObject({
    tokenUuid: z.string().max(256).describe('Moved token UUID'),
    completed: z
      .boolean()
      .describe('Whether native movement completed; false when blocked or stopped'),
    x: z.number().finite().describe('Actual horizontal position in grid-size units'),
    y: z.number().finite().describe('Actual vertical position in grid-size units'),
  }),
});
