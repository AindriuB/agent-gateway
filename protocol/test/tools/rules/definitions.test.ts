import { describe, expect, it } from 'vitest';
import {
  checkToolDefinition,
  TOOLS,
  toJsonSchema,
  parseApiVersion,
  type AnnouncedTool,
} from '../../../src/tools/index.js';

export const objectSchema = () => ({ type: 'object', additionalProperties: false, properties: {} });
export function definition(inputSchema: Record<string, unknown> = objectSchema()): AnnouncedTool {
  return {
    name: 'hello-world_clock',
    description: 'A useful tool',
    category: 'read',
    minRole: 'player',
    inputSchema,
    outputSchema: objectSchema(),
    pack: { id: 'hello', version: '1.0.0', prefix: 'hello' },
  };
}
const check = (schema: Record<string, unknown>) =>
  checkToolDefinition(definition(schema), 'pack').join('\n');

describe('hostile schemas', () => {
  it.each(['pattern', 'format', '$ref', '$defs', 'oneOf', 'anyOf', 'allOf', 'not', 'if', 'title'])(
    'refuses %s',
    (key) => {
      expect(check({ ...objectSchema(), [key]: key === '$ref' ? '#/$defs/x' : {} })).toContain(key);
    },
  );
  it('refuses remote refs', () =>
    expect(check({ ...objectSchema(), $ref: 'https://example.com' })).toContain('$ref'));
  it('refuses type arrays', () =>
    expect(check({ ...objectSchema(), type: ['object', 'null'] })).toContain('type'));
  it.each([undefined, true, { type: 'string' }])(
    'refuses open additionalProperties %s',
    (additionalProperties) => {
      expect(check({ ...objectSchema(), additionalProperties })).toContain('additionalProperties');
    },
  );
  it('refuses depth 4', () => {
    let schema: Record<string, unknown> = objectSchema();
    for (let i = 0; i < 3; i++)
      schema = {
        ...objectSchema(),
        properties: { x: { ...schema, description: 'Nested object' } },
      };
    expect(check(schema)).toContain('nesting deeper');
  });
  it('refuses 33 properties', () =>
    expect(
      check({
        ...objectSchema(),
        properties: Object.fromEntries(
          Array.from({ length: 33 }, (_, i) => [`p${i}`, { type: 'string', description: 'Field' }]),
        ),
      }),
    ).toContain('32 properties'));
  it('refuses 51 enum values', () =>
    expect(
      check({
        ...objectSchema(),
        properties: {
          x: {
            type: 'string',
            description: 'Field',
            enum: Array.from({ length: 51 }, (_, i) => `v${i}`),
          },
        },
      }),
    ).toContain('enum'));
  it('refuses bidi enum', () =>
    expect(
      check({
        ...objectSchema(),
        properties: { x: { type: 'string', description: 'Field', enum: ['x\u202e'] } },
      }),
    ).toContain('enum'));
  it('refuses large schema', () =>
    expect(check({ ...objectSchema(), description: 'x'.repeat(17 * 1024) })).toContain('16 KiB'));
  it('refuses array root', () =>
    expect(check({ type: 'array', items: { type: 'string' } })).toContain('root type'));
  it.each(['__proto__', 'constructor'])('refuses dangerous property %s', (key) =>
    expect(
      check({ ...objectSchema(), properties: { [key]: { type: 'string', description: 'Field' } } }),
    ).toContain(key),
  );
  it('bounds repeated forbidden ref expansion', () => {
    const defs: Record<string, unknown> = { leaf: { type: 'string' } };
    let previous = 'leaf';
    for (let i = 0; i < 14; i++) {
      defs[`level${i}`] = {
        allOf: [{ $ref: `#/$defs/${previous}` }, { $ref: `#/$defs/${previous}` }],
      };
      previous = `level${i}`;
    }
    expect(check({ ...objectSchema(), $defs: defs, $ref: `#/$defs/${previous}` })).toContain(
      'traversal limit',
    );
  });
  it.each(['string', 'number', 'boolean', 'null', 'array'])(
    'checks required shape on %s nodes',
    (type) => {
      expect(
        check({
          ...objectSchema(),
          properties: {
            x: {
              type,
              description: 'X',
              required: 42,
              ...(type === 'array' ? { items: { type: 'string' } } : {}),
            },
          },
        }),
      ).toContain('required');
    },
  );
  it('checks additionalProperties shape on irrelevant nodes', () => {
    expect(
      check({
        ...objectSchema(),
        properties: { x: { type: 'string', description: 'X', additionalProperties: true } },
      }),
    ).toContain('additionalProperties');
  });
  it.each([
    () => 1,
    undefined,
    Symbol('value'),
    NaN,
    Infinity,
    new Date(),
    new Map(),
    { nested: () => 1 },
    [undefined],
  ])('refuses nonJSON default %j', (value) => {
    expect(
      check({
        ...objectSchema(),
        properties: { x: { type: 'string', description: 'X', default: value } },
      }),
    ).toContain('default');
  });
  it('refuses malformed required', () =>
    expect(check({ ...objectSchema(), required: ['missing'] })).toContain('required'));
  it('refuses missing array items', () =>
    expect(
      check({ ...objectSchema(), properties: { x: { type: 'array', description: 'Field' } } }),
    ).toContain('items'));
});

describe('descriptions', () => {
  it.each([
    'x'.repeat(501),
    'x\ny',
    'x\u200by',
    'x\u202ey',
    '<system>',
    '`hello`',
    '[x](y)',
    'https://x',
    '',
    ' \t',
    'x\u2028y',
    'x\u2029y',
  ])('refuses unsafe tool description %j', (description) =>
    expect(checkToolDefinition({ ...definition(), description }, 'pack').join('\n')).toContain(
      'description',
    ),
  );
  it('accepts 500 ASCII characters', () =>
    expect(checkToolDefinition({ ...definition(), description: 'x'.repeat(500) }, 'pack')).toEqual(
      [],
    ));
  it('refuses 201 property characters', () =>
    expect(
      check({
        ...objectSchema(),
        properties: { x: { type: 'string', description: 'x'.repeat(201) } },
      }),
    ).toContain('description'));
  it.each(['https://x', 'x\n', ''])('checks defaults %j', (value) =>
    expect(
      check({
        ...objectSchema(),
        properties: { x: { type: 'string', description: 'Field', default: value } },
      }),
    ).toContain('default'),
  );
});

describe('pack names and metadata', () => {
  it('accepts valid pack name', () =>
    expect(checkToolDefinition(definition(), 'pack')).toEqual([]));
  it('refuses missing metadata', () =>
    expect(checkToolDefinition({ ...definition(), pack: undefined }, 'pack').join('\n')).toContain(
      'prefix',
    ));
  it.each([
    'other-x1',
    'ag-x1',
    'Hello-x1',
    'hello.x1',
    'hello-x-y',
    `hello-${'a'.repeat(31)}`,
    'world_info',
  ])('refuses %s', (name) =>
    expect(checkToolDefinition({ ...definition(), name }, 'pack').join('\n')).toContain('name'),
  );
  it('refuses reserved prefix', () =>
    expect(
      checkToolDefinition(
        { ...definition(), name: 'ag-x1', pack: { id: 'a', version: '1.0.0', prefix: 'ag' } },
        'pack',
      ).join('\n'),
    ).toContain('reserved'));
  it.each([{ id: '../bad' }, { version: '1.0' }, { prefix: 'Hello' }])(
    'checks metadata %j',
    (patch) =>
      expect(
        checkToolDefinition({ ...definition(), pack: { ...definition().pack!, ...patch } }, 'pack')
          .length,
      ).toBeGreaterThan(0),
  );
  it.each(TOOLS.map((t) => [t.name, t] as const))('checks core %s', (_name, tool) =>
    expect(checkToolDefinition({ ...tool, ...toJsonSchema(tool) }, 'core')).toEqual([]),
  );
  it('parses API version', () => expect(parseApiVersion('1.0')).toEqual({ major: 1, minor: 0 }));
  it.each(['1', '1.0.0', '1.0-beta', '-1.0', 1, null])('refuses API version %j', (v) =>
    expect(parseApiVersion(v)).toBeUndefined(),
  );
});
