import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { TOOLS, defineTool, toJsonSchema, type ToolDefinition } from '../../src/tools/index.js';
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

const MAX_OBJECT_DEPTH = 3;
const COMBINATORS = ['oneOf', 'anyOf', 'allOf'];

type Json = Record<string, unknown>;

// `root` resolves local `$ref`s; `chain` holds the refs being followed, to catch recursion.
interface Refs {
  root: Json;
  chain: readonly string[];
}

function walkMap(node: unknown, depth: number, path: string, problems: string[], refs: Refs): void {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) return;
  for (const [k, v] of Object.entries(node as Json)) walk(v, depth, `${path}/${k}`, problems, refs);
}

function resolveRef(root: Json, ref: string): unknown {
  if (ref !== '#' && !ref.startsWith('#/')) return undefined;
  let cur: unknown = root;
  for (const part of ref === '#' ? [] : ref.slice(2).split('/')) {
    const key = part.replace(/~1/g, '/').replace(/~0/g, '~');
    if (cur === null || typeof cur !== 'object' || !Object.hasOwn(cur, key)) return undefined;
    cur = (cur as Json)[key];
  }
  return cur;
}

// Applies schema-keyword checks to a schema node only; dictionaries such as
// `properties` are traversed by value without being treated as schemas.
function walk(
  node: unknown,
  depth: number,
  path: string,
  problems: string[],
  refs: Refs = { root: node as Json, chain: [] },
): void {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) return;
  const obj = node as Json;
  if (typeof obj.$ref === 'string') {
    if (refs.chain.includes(obj.$ref)) {
      problems.push(`${path}: recursive $ref ${obj.$ref} (unbounded nesting)`);
    } else {
      const target = resolveRef(refs.root, obj.$ref);
      if (target === undefined) problems.push(`${path}: unresolvable $ref ${obj.$ref}`);
      else
        walk(target, depth, `${path}/$ref`, problems, {
          ...refs,
          chain: [...refs.chain, obj.$ref],
        });
    }
  }
  for (const key of COMBINATORS) {
    if (key in obj) problems.push(`${path}: uses ${key}`);
  }
  let next = depth;
  if (Array.isArray(obj.type)) problems.push(`${path}: multi-type union (type array)`);
  if (obj.type === 'object' || 'properties' in obj) {
    next = depth + 1;
    if (next > MAX_OBJECT_DEPTH)
      problems.push(`${path}: object nesting deeper than ${MAX_OBJECT_DEPTH}`);
    if (obj.additionalProperties !== false)
      problems.push(`${path}: additionalProperties is not false`);
  }
  walkMap(obj.properties, next, `${path}/properties`, problems, refs);
  walkMap(obj.$defs, next, `${path}/$defs`, problems, refs);
  walkMap(obj.definitions, next, `${path}/definitions`, problems, refs);
  for (const key of ['items', 'additionalProperties', 'not', 'propertyNames']) {
    walk(obj[key], next, `${path}/${key}`, problems, refs);
  }
  for (const key of [...COMBINATORS, 'prefixItems']) {
    const arr = obj[key];
    if (Array.isArray(arr))
      arr.forEach((n, i) => walk(n, next, `${path}/${key}[${i}]`, problems, refs));
  }
}

export function conservativeProblems(tool: ToolDefinition): string[] {
  const problems: string[] = [];
  const { inputSchema, outputSchema } = toJsonSchema(tool);
  for (const [label, schema] of [
    ['input', inputSchema],
    ['output', outputSchema],
  ] as const) {
    walk(schema, 0, label, problems);
  }
  for (const [label, schema] of [
    ['input', inputSchema],
    ['output', outputSchema],
  ] as const) {
    const props = (schema.properties ?? {}) as Record<string, Json>;
    for (const [name, p] of Object.entries(props)) {
      if (typeof p.description !== 'string' || p.description === '') {
        problems.push(`${label}/properties/${name}: missing description`);
      }
    }
  }
  return problems;
}

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
