import { describe, expect, it } from 'vitest';
import { TOOLS, toJsonSchema, type ToolDefinition } from '../../src/tools/index.js';
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

function walkMap(node: unknown, depth: number, path: string, problems: string[]): void {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) return;
  for (const [k, v] of Object.entries(node as Json)) walk(v, depth, `${path}/${k}`, problems);
}

// Applies schema-keyword checks to a schema node only; dictionaries such as
// `properties` are traversed by value without being treated as schemas.
function walk(node: unknown, depth: number, path: string, problems: string[]): void {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) return;
  const obj = node as Json;
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
  walkMap(obj.properties, next, `${path}/properties`, problems);
  walkMap(obj.$defs, next, `${path}/$defs`, problems);
  walkMap(obj.definitions, next, `${path}/definitions`, problems);
  for (const key of ['items', 'additionalProperties', 'not']) {
    walk(obj[key], next, `${path}/${key}`, problems);
  }
  for (const key of [...COMBINATORS, 'prefixItems']) {
    const arr = obj[key];
    if (Array.isArray(arr)) arr.forEach((n, i) => walk(n, next, `${path}/${key}[${i}]`, problems));
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
    it('missing property description', () => {
      expect(conservativeProblems(undocumentedTool).join('\n')).toMatch(/missing description/);
    });
  });
});
