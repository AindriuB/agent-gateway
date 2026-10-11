import { z } from 'zod';
import { defineTool } from './define.js';

export const documentUpdate = defineTool({
  name: 'document_update',
  minRole: 'gm',
  category: 'write',
  handledBy: 'module',
  description: 'Update a supported world document using raw JSON data reviewed as a diff.',
  input: z.strictObject({
    uuid: z.string().min(1).max(500).describe('Canonical document UUID'),
    update: z.string().min(2).max(65536).describe('Raw JSON object, at most 64 KiB UTF-8'),
  }),
  output: z.strictObject({
    uuid: z.string().min(1).max(500).describe('Canonical document UUID'),
  }),
});
