import { z } from 'zod';
import { defineTool } from './define.js';

export const compendiumImport = defineTool({
  name: 'compendium_import',
  minRole: 'gm',
  category: 'write',
  handledBy: 'module',
  description:
    'Import one supported compendium entry as a fresh world document after approval. With actorUuid, embed one Item entry in that owned world Actor instead; overrides are applied by the game system.',
  input: z
    .strictObject({
      uuid: z.string().min(1).max(500).describe('Canonical document UUID'),
      folder: z.string().min(1).max(256).optional().describe('Existing matching world folder ID'),
      actorUuid: z
        .string()
        .min(1)
        .max(256)
        .optional()
        .describe('Embed the Item entry in this owned world Actor instead of a world import'),
      overrides: z
        .strictObject({
          quantity: z.number().int().min(1).max(9999).optional().describe('Item quantity'),
          equipped: z.boolean().optional().describe('Carry the item equipped or not'),
          slot: z.string().min(1).max(100).optional().describe('Feat slot ID on the Actor'),
        })
        .optional()
        .describe('System-translated settings for the embedded Item; requires actorUuid'),
    })
    .refine((a) => a.actorUuid === undefined || a.folder === undefined, {
      message: 'folder cannot be combined with actorUuid',
    })
    .refine((a) => a.overrides === undefined || a.actorUuid !== undefined, {
      message: 'overrides require actorUuid',
    }),
  output: z.strictObject({
    uuid: z.string().min(1).max(500).describe('Canonical document UUID (the primary created one)'),
    created: z
      .array(z.string().min(1).max(500))
      .max(50)
      .optional()
      .describe('Every document created, including system grants'),
  }),
});
