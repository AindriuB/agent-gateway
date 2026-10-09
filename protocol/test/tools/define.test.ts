import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineTool, toJsonSchema } from '../../src/tools/index.js';
import { goodTool } from './fixtures.js';

const base = {
  minRole: 'gm',
  category: 'read',
  handledBy: 'module',
  description: 'x',
  input: z.strictObject({}),
  output: z.strictObject({}),
} as const;

describe('defineTool', () => {
  it.each(['Bad', 'ab', '1abc', 'has-dash', 'a'.repeat(42)])('rejects name %s', (name) => {
    expect(() => defineTool({ ...base, name })).toThrow(/Invalid tool name/);
  });
  it('accepts a valid name', () => {
    expect(defineTool({ ...base, name: 'get_actor' }).name).toBe('get_actor');
  });
  it('emits JSON Schema', () => {
    const { inputSchema, outputSchema } = toJsonSchema(goodTool);
    expect(inputSchema.type).toBe('object');
    expect(inputSchema.additionalProperties).toBe(false);
    expect(outputSchema.type).toBe('object');
  });
});
