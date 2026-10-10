import type { JsonSchemaObject } from './json-schema.js';
import { checkToolDefinition, isSchemaObject } from './rules.js';

export interface ValidationIssue {
  path: string;
  message: string;
}
export type ArgsValidation =
  { ok: true; value: unknown } | { ok: false; issues: ValidationIssue[] };

/** Validates the conservative subset. Defaults apply only to missing root properties. */
export function validateArgs(schema: JsonSchemaObject, value: unknown): ArgsValidation {
  try {
    return validate(schema, value);
  } catch {
    return {
      ok: false,
      issues: [{ path: '', message: 'Schema or value cannot be validated as JSON' }],
    };
  }
}

function validate(schema: JsonSchemaObject, value: unknown): ArgsValidation {
  const problems = checkToolDefinition(
    {
      name: 'schema_validation',
      description: 'Argument validation',
      category: 'read',
      minRole: 'player',
      inputSchema: schema,
      outputSchema: { type: 'object', additionalProperties: false },
    },
    'core',
  );
  if (problems.length)
    return { ok: false, issues: problems.map((message) => ({ path: '', message })) };
  const issues: ValidationIssue[] = [];
  const issue = (path: string, message: string) => {
    issues.push({ path, message });
  };
  type Check = (value: unknown, path: string) => void;
  const compile = (node: JsonSchemaObject): Check => {
    const properties = isSchemaObject(node.properties) ? node.properties : {};
    const fields = Object.entries(properties).map(
      ([name, child]) => [name, compile(child as JsonSchemaObject)] as const,
    );
    const required = new Set(Array.isArray(node.required) ? (node.required as string[]) : []);
    const allowed = new Set(Object.keys(properties));
    const items = isSchemaObject(node.items) ? compile(node.items) : undefined;
    const enumeration = Array.isArray(node.enum) ? new Set(node.enum) : undefined;
    return (current, path) => {
      const type = node.type;
      const valid =
        type === 'object'
          ? isSchemaObject(current)
          : type === 'array'
            ? Array.isArray(current)
            : type === 'null'
              ? current === null
              : type === 'integer'
                ? typeof current === 'number' && Number.isInteger(current)
                : type === 'number'
                  ? typeof current === 'number' && Number.isFinite(current)
                  : typeof current === type;
      if (!valid) {
        issue(path, `Expected ${String(type)}`);
        return;
      }
      if (enumeration && !enumeration.has(current)) issue(path, 'Value is not in enum');
      if (typeof current === 'number') {
        for (const [keyword, failed] of [
          ['minimum', current < Number(node.minimum)],
          ['maximum', current > Number(node.maximum)],
          ['exclusiveMinimum', current <= Number(node.exclusiveMinimum)],
          ['exclusiveMaximum', current >= Number(node.exclusiveMaximum)],
        ] as const)
          if (keyword in node && failed) issue(path, `Value violates ${keyword}`);
      }
      if (typeof current === 'string') {
        const length = Array.from(current).length;
        if ('minLength' in node && length < Number(node.minLength))
          issue(path, 'String violates minLength');
        if ('maxLength' in node && length > Number(node.maxLength))
          issue(path, 'String violates maxLength');
      }
      if (Array.isArray(current)) {
        if ('minItems' in node && current.length < Number(node.minItems))
          issue(path, 'Array violates minItems');
        if ('maxItems' in node && current.length > Number(node.maxItems))
          issue(path, 'Array violates maxItems');
        current.forEach((v, i) => items?.(v, `${path}/${i}`));
      } else if (type === 'object' && isSchemaObject(current)) {
        for (const name of Object.keys(current))
          if (!allowed.has(name)) issue(`${path}/${name}`, 'Additional property is not allowed');
        for (const [name, check] of fields) {
          if (Object.hasOwn(current, name)) check(current[name], `${path}/${name}`);
          else if (required.has(name)) issue(`${path}/${name}`, 'Required property is missing');
        }
      }
    };
  };
  let result = value;
  if (isSchemaObject(value)) {
    result = { ...value };
    const properties = isSchemaObject(schema.properties) ? schema.properties : {};
    for (const [name, child] of Object.entries(properties)) {
      if (!Object.hasOwn(value, name) && isSchemaObject(child) && Object.hasOwn(child, 'default'))
        (result as JsonSchemaObject)[name] = structuredClone(child.default);
    }
  }
  compile(schema)(result, '');
  return issues.length ? { ok: false, issues } : { ok: true, value: result };
}
