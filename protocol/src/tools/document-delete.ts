import { z } from 'zod';
import { defineTool } from './define.js';

export const documentDelete = defineTool({
  name: 'document_delete',
  minRole: 'gm',
  category: 'destructive',
  handledBy: 'module',
  description:
    'Delete up to 20 supported documents with one grouped approval; native deletions are not transactional.',
  input: z.strictObject({
    uuids: z
      .array(z.string().min(1).max(500))
      .min(1)
      .max(20)
      .describe('Supported world document UUIDs, at most 20'),
  }),
  output: z.strictObject({
    uuids: z.array(z.string().min(1).max(500)).max(20).describe('Deleted canonical UUIDs'),
    deleted: z.number().int().min(0).max(20).describe('Number of distinct documents deleted'),
  }),
});
