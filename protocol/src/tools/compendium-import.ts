import { z } from 'zod';
import { defineTool } from './define.js';

export const compendiumImport = defineTool({
  name: 'compendium_import',
  minRole: 'gm',
  category: 'write',
  handledBy: 'module',
  description: 'Import one supported compendium entry as a fresh world document after approval.',
  input: z.strictObject({
    uuid: z.string().min(1).max(500).describe('Canonical document UUID'),
    folder: z.string().min(1).max(256).optional().describe('Existing matching world folder ID'),
  }),
  output: z.strictObject({
    uuid: z.string().min(1).max(500).describe('Canonical document UUID'),
  }),
});
