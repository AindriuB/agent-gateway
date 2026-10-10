import { z } from 'zod';
import { defineTool } from './define.js';

export const documentGet = defineTool({
  name: 'document_get',
  minRole: 'player',
  category: 'read',
  handledBy: 'module',
  description:
    'Read one document by UUID as markdown (HTML fields converted). Long documents are paged: pass nextCursor back as cursor.',
  input: z.strictObject({
    uuid: z.string().min(1).max(500).describe('Document UUID, for example from document_search'),
    cursor: z.string().max(100).optional().describe('nextCursor from the previous page'),
  }),
  output: z.strictObject({
    uuid: z.string().describe('Document UUID'),
    name: z.string().describe('Document name'),
    type: z.string().describe('Document type'),
    content: z.string().describe('This page of the document as markdown'),
    nextCursor: z
      .string()
      .optional()
      .describe('Pass as cursor to read the next page; absent on the last page'),
  }),
});
