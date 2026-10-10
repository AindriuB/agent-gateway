import { z } from 'zod';
import { defineTool } from './define.js';

export const compendiumGet = defineTool({
  name: 'compendium_get',
  minRole: 'player',
  category: 'read',
  handledBy: 'module',
  description:
    'Read one compendium entry as markdown, paged. Pass nextCursor back as cursor to continue.',
  input: z.strictObject({
    uuid: z.string().min(1).max(500).describe('UUID of a compendium entry, starting Compendium.'),
    cursor: z.string().max(100).optional().describe('Cursor from a previous page of this entry'),
  }),
  output: z.strictObject({
    uuid: z.string().describe('UUID that was read'),
    name: z.string().describe('Entry name'),
    type: z.string().describe('Document type'),
    pack: z.string().describe('Pack id the entry belongs to'),
    markdown: z.string().describe('This page of the entry as markdown'),
    nextCursor: z.string().optional().describe('Cursor for the next page; absent on the last page'),
  }),
});
