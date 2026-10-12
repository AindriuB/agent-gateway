import { z } from 'zod';
import { defineTool } from './define.js';
export const inventoryOutput = z.strictObject({
  actorUuid: z.string().min(1).max(256).describe('Canonical Actor UUID'),
  systemId: z.string().min(1).max(100).describe('Active system ID'),
  supported: z.boolean().describe('Whether inventory semantics are supported'),
  items: z
    .array(
      z.strictObject({
        uuid: z.string().min(1).max(256).describe('Item UUID'),
        name: z.string().max(1000).describe('Item name'),
        type: z.string().max(100).describe('Item type'),
        quantity: z.number().finite().min(0).max(1000000000).optional().describe('Item quantity'),
        weight: z.string().max(200).optional().describe('Weight or bulk display'),
        equipped: z.boolean().optional().describe('Equipped state'),
        invested: z.boolean().optional().describe('Invested state'),
      }),
    )
    .max(256)
    .describe('Inventory items'),
  totals: z
    .array(
      z.strictObject({
        key: z.string().min(1).max(100).describe('Attribute key'),
        label: z.string().max(200).describe('Attribute label'),
        value: z.string().max(2000).describe('Display value'),
      }),
    )
    .max(16)
    .describe('System inventory totals'),
});
export type InventoryOutput = z.infer<typeof inventoryOutput>;
export const inventory = defineTool({
  name: 'inventory',
  minRole: 'player',
  category: 'read',
  handledBy: 'module',
  description:
    'Read system inventory semantics for an owned world Actor; unsupported systems return empty lists.',
  input: z.strictObject({
    actorUuid: z.string().min(1).max(256).describe('Canonical owned world Actor UUID'),
  }),
  output: inventoryOutput,
});
