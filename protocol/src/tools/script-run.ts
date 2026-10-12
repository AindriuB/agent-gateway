import { z } from 'zod';
import { defineTool } from './define.js';

export const scriptRun = defineTool({
  name: 'script_run',
  minRole: 'gm',
  category: 'code',
  handledBy: 'module',
  description:
    'Run an async script with game, canvas and ui after mandatory full-source human approval.',
  input: z.strictObject({
    source: z.string().min(1).max(20000).describe('Full async JavaScript source for human review'),
  }),
  output: z.strictObject({
    result: z
      .string()
      .max(4000)
      .describe('Bounded serialised native return value; undefined establishes no action outcome'),
    truncated: z.boolean().describe('Whether the serialised result exceeded 4000 characters'),
  }),
});
