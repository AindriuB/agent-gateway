import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { TOOLS, defineTool } from '../../src/tools/index.js';
import { conservativeProblems, walk } from '../../src/tools/rules.js';
import {
  deepTool,
  goodTool,
  openTool,
  undocumentedTool,
  multiTypeTool,
  unionTool,
  undocumentedOutputTool,
  keywordNamedFieldsTool,
} from './fixtures.js';

describe('conservative schema rules', () => {
  it.each([...TOOLS, goodTool, keywordNamedFieldsTool].map((t) => [t.name, t] as const))(
    '%s conforms',
    (_n, tool) => {
      expect(conservativeProblems(tool)).toEqual([]);
    },
  );

  describe('fixtures prove each rule fires', () => {
    it('oneOf/anyOf (union)', () => {
      expect(conservativeProblems(unionTool).join('\n')).toMatch(/anyOf|oneOf/);
    });
    it('allOf (raw schema; zod merges intersections)', () => {
      const problems: string[] = [];
      walk({ allOf: [{ type: 'string' }] }, 0, 'raw', problems);
      expect(problems.join('\n')).toMatch(/allOf/);
    });
    it('multi-type unions', () => {
      expect(conservativeProblems(multiTypeTool).join('\n')).toMatch(/multi-type/);
    });
    it('nesting deeper than 3', () => {
      expect(conservativeProblems(deepTool).join('\n')).toMatch(/nesting deeper/);
    });
    it('open objects', () => {
      expect(conservativeProblems(openTool).join('\n')).toMatch(/additionalProperties/);
    });
    it('missing output property description', () => {
      expect(conservativeProblems(undocumentedOutputTool).join('\n')).toMatch(
        /output\/properties\/ok: missing description/,
      );
    });
    it('propertyNames is checked as a single-schema keyword', () => {
      const problems: string[] = [];
      walk({ type: 'string', propertyNames: { anyOf: [{ type: 'string' }] } }, 0, 'raw', problems);
      expect(problems.join('\n')).toMatch(/raw\/propertyNames: uses anyOf/);
    });
    it('follows $ref so a shared def cannot hide deep nesting', () => {
      const Inner = z
        .strictObject({ deeper: z.strictObject({ v: z.string().describe('v') }).describe('d') })
        .meta({ id: 'FixtureInner' });
      const tool = defineTool({
        name: 'fixture_ref_deep',
        minRole: 'player',
        category: 'read',
        handledBy: 'module',
        description: 'Fixture tool',
        input: z.strictObject({
          a: z
            .strictObject({ b: z.strictObject({ i: Inner.describe('Shared') }).describe('b') })
            .describe('a'),
        }),
        output: z.strictObject({ ok: z.boolean().describe('Whether it worked') }),
      });
      expect(conservativeProblems(tool).join('\n')).toMatch(/nesting deeper/);
    });
    it('rejects a recursive schema', () => {
      const Node: z.ZodObject = z.strictObject({
        name: z.string().describe('Name'),
        get child() {
          return Node.optional().describe('Child');
        },
      });
      const tool = defineTool({
        name: 'fixture_recursive',
        minRole: 'player',
        category: 'read',
        handledBy: 'module',
        description: 'Fixture tool',
        input: Node,
        output: z.strictObject({ ok: z.boolean().describe('Whether it worked') }),
      });
      expect(conservativeProblems(tool).join('\n')).toMatch(/recursive \$ref/);
    });
    it('reports an unresolvable $ref', () => {
      const problems: string[] = [];
      walk({ $ref: '#/$defs/missing' }, 0, 'raw', problems);
      expect(problems.join('\n')).toMatch(/unresolvable \$ref/);
    });
    it('missing property description', () => {
      expect(conservativeProblems(undocumentedTool).join('\n')).toMatch(/missing description/);
    });
  });
});
