import { z } from 'zod';
import { defineTool } from './define.js';

export const DOCUMENT_SEARCH_TYPES = [
  'Actor',
  'Item',
  'JournalEntry',
  'Scene',
  'RollTable',
  'Macro',
  'Playlist',
] as const;

export const documentSearch = defineTool({
  name: 'document_search',
  minRole: 'player',
  category: 'read',
  handledBy: 'module',
  description:
    'Search world documents of one type by name. Only documents the user can observe are listed.',
  input: z.strictObject({
    type: z.enum(DOCUMENT_SEARCH_TYPES).describe('Document type to search'),
    query: z.string().max(200).optional().describe('Case-insensitive text the name must contain'),
    folder: z.string().max(200).optional().describe('Folder name or id to restrict to'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .default(20)
      .describe('Maximum results (default 20, max 50)'),
  }),
  output: z.strictObject({
    results: z
      .array(
        z.strictObject({
          uuid: z.string().describe('Document UUID, usable with document_get'),
          name: z.string().describe('Document name'),
          type: z.string().describe('Document type'),
          folder: z.string().describe('Folder name, or empty when not in a folder'),
        }),
      )
      .describe('Matching documents, sorted by name'),
    total: z.number().int().describe('Number of matching documents before the limit'),
    truncated: z.boolean().describe('True when more documents matched than were returned'),
  }),
});
