import { z } from 'zod';
import { defineTool } from '../../src/tools/define.js';

const out = z.strictObject({ ok: z.boolean().describe('Whether it worked') });

function make(name: string, input: z.ZodObject) {
  return defineTool({
    name,
    minRole: 'player',
    category: 'read',
    handledBy: 'module',
    description: 'Fixture tool',
    input,
    output: out,
  });
}

export const goodTool = make(
  'fixture_good',
  z.strictObject({ id: z.string().describe('Document id') }),
);

export const unionTool = make(
  'fixture_union',
  z.strictObject({
    v: z
      .union([z.strictObject({ a: z.string() }), z.strictObject({ b: z.string() })])
      .describe('Either'),
  }),
);

export const multiTypeTool = make(
  'fixture_multitype',
  z.strictObject({ v: z.union([z.string(), z.number()]).describe('Either') }),
);

export const openTool = make('fixture_open', z.object({ id: z.string().describe('Document id') }));

export const deepTool = make(
  'fixture_deep',
  z.strictObject({
    a: z
      .strictObject({
        b: z.strictObject({ c: z.strictObject({ d: z.string() }) }),
      })
      .describe('Deep'),
  }),
);

export const undocumentedTool = make('fixture_undoc', z.strictObject({ id: z.string() }));
