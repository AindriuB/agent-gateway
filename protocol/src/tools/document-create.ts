import { z } from 'zod';
import { defineTool } from './define.js';

export const documentCreate = defineTool({
  name: 'document_create',
  minRole: 'gm',
  category: 'write',
  handledBy: 'module',
  description: 'Create a supported world or embedded document after approval.',
  input: z.strictObject({
    type: z
      .enum(['Actor', 'Item', 'JournalEntry', 'ActiveEffect', 'JournalEntryPage'])
      .describe('Supported Foundry document class'),
    data: z.string().min(2).max(65536).describe('JSON object, at most 64 KiB UTF-8'),
    folder: z.string().min(1).max(256).optional().describe('Existing matching world folder ID'),
    parentUuid: z
      .string()
      .min(1)
      .max(256)
      .optional()
      .describe('Canonical supported embedded parent UUID'),
  }),
  output: z.strictObject({
    uuid: z.string().min(1).max(500).describe('Canonical document UUID'),
  }),
});
