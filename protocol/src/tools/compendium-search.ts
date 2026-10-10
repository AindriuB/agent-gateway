import { z } from 'zod';
import { defineTool } from './define.js';

export const COMPENDIUM_PACK_TYPES = [
  'Actor',
  'Item',
  'JournalEntry',
  'RollTable',
  'Scene',
  'Macro',
] as const;

export const compendiumSearch = defineTool({
  name: 'compendium_search',
  minRole: 'player',
  category: 'read',
  handledBy: 'module',
  description:
    'Search compendium entries by name using pack indexes. Returns UUIDs to pass to compendium_get.',
  input: z.strictObject({
    query: z.string().min(1).max(200).describe('Case-insensitive text to find in entry names'),
    packType: z.enum(COMPENDIUM_PACK_TYPES).optional().describe('Only search packs of this type'),
    pack: z.string().max(200).optional().describe('Only search this pack, by id (scope.name)'),
    limit: z.number().int().min(1).max(50).default(20).describe('Maximum results, 1 to 50'),
  }),
  output: z.strictObject({
    results: z
      .array(
        z.strictObject({
          uuid: z.string().describe('Compendium UUID of the entry'),
          name: z.string().describe('Entry name'),
          type: z.string().describe('Document type, or subtype when the index has one'),
          pack: z.string().describe('Pack id the entry belongs to'),
        }),
      )
      .describe('Matching entries'),
    truncated: z.boolean().describe('True when more entries matched than the limit allowed'),
  }),
});
