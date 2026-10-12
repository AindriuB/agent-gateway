import { z } from 'zod';
import { defineTool } from './define.js';

export const macroRun = defineTool({
  name: 'macro_run',
  minRole: 'gm',
  category: 'code',
  handledBy: 'module',
  description:
    'Invoke a native world or compendium Macro after mandatory full-source human approval.',
  input: z.strictObject({
    macroUuid: z.string().min(1).max(256).describe('Canonical world or compendium Macro UUID'),
    args: z
      .string()
      .max(65536)
      .optional()
      .describe('Optional bounded JSON value passed as the native args binding'),
  }),
  output: z.strictObject({
    result: z
      .string()
      .max(4000)
      .describe('Bounded serialised native return value; undefined establishes no action outcome'),
    truncated: z.boolean().describe('Whether the serialised result exceeded 4000 characters'),
  }),
});
