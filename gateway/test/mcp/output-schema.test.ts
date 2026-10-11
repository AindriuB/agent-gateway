import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv';
import { describe, expect, it } from 'vitest';
import { projectOutputSchema } from '../../src/mcp/output-schema.js';

const normal = {
  type: 'object',
  properties: { value: { type: 'string' } },
  required: ['value'],
  additionalProperties: false,
};
const validate = new AjvJsonSchemaValidator().getValidator(projectOutputSchema(normal));
describe('MCP output envelope', () => {
  it('accepts strict normal and pending results at an object root', () => {
    expect(projectOutputSchema(normal).type).toBe('object');
    for (const result of [
      { value: 'ok' },
      { status: 'pending_approval', id: 'a' },
      { status: 'pending_approval', id: 'a'.repeat(100) },
    ])
      expect(validate(result).valid).toBe(true);
  });
  it.each([
    {},
    { value: 2 },
    { value: 'ok', extra: true },
    { status: 'pending_approval' },
    { status: 'pending_approval', id: '' },
    { status: 'pending_approval', id: 'a'.repeat(101) },
    { status: 'approved', id: 'a' },
    { status: 'pending_approval', id: 'a', extra: true },
  ])('rejects malformed normal or pending result %j', (result) => {
    expect(validate(result).valid).toBe(false);
  });
  it('uses anyOf so overlapping normal and pending output remains valid', () => {
    const overlapping = new AjvJsonSchemaValidator().getValidator(
      projectOutputSchema({ type: 'object' }),
    );
    expect(overlapping({ status: 'pending_approval', id: 'a' }).valid).toBe(true);
  });
  it('isolates all nested projection state from canonical schemas and other calls', () => {
    const before = structuredClone(normal);
    const first = projectOutputSchema(normal);
    const second = projectOutputSchema(normal);
    (first.anyOf[0]!.properties as Record<string, unknown>).value = {};
    first.anyOf[1]!.required = [];
    expect(normal).toEqual(before);
    expect(second).toEqual(projectOutputSchema(before));
  });
});
