import { TOOL_NAME_PATTERN, type ToolDefinition } from './define.js';
import { toJsonSchema, type JsonSchemaObject } from './json-schema.js';
import { TOOL_LIMITS } from './limits.js';
import type { AnnouncedTool } from './pack.js';

export const PACK_PREFIX_PATTERN = /^[a-z][a-z0-9]{1,9}$/;
export const PACK_LOCAL_NAME_PATTERN = /^[a-z][a-z0-9_]{1,24}$/;
export const PACK_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
export const PACK_VERSION_PATTERN = /^\d{1,4}\.\d{1,4}\.\d{1,4}(-[0-9A-Za-z.]{1,20})?$/;
export const RESERVED_PACK_PREFIXES = new Set(['ag', 'agent', 'core', 'foundry', 'gateway', 'mcp']);
const keywords = new Set([
  'type',
  'properties',
  'required',
  'additionalProperties',
  'description',
  'items',
  'enum',
  'default',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
]);
const types = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']);
export const isSchemaObject = (value: unknown): value is JsonSchemaObject =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export function isPlainText(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    !/[\p{Cc}\p{Cf}\u2028\u2029<>`]/u.test(value) &&
    !value.includes('](') &&
    !value.includes('://')
  );
}

/** Check values that JSON.stringify would otherwise silently drop or transform. */
function isJsonValue(value: unknown): boolean {
  const stack: { value: unknown; exit?: boolean }[] = [{ value }];
  const ancestors = new Set<object>();
  let remaining = TOOL_LIMITS.schemaBytes;
  while (stack.length) {
    if (--remaining < 0) return false;
    const entry = stack.pop()!;
    const current = entry.value;
    if (entry.exit) {
      ancestors.delete(current as object);
      continue;
    }
    if (current === null || typeof current === 'string' || typeof current === 'boolean') continue;
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) return false;
      continue;
    }
    if (typeof current !== 'object') return false;
    const array = Array.isArray(current);
    if (
      !array &&
      Object.getPrototypeOf(current) !== Object.prototype &&
      Object.getPrototypeOf(current) !== null
    )
      return false;
    if (ancestors.has(current)) return false;
    ancestors.add(current);
    stack.push({ value: current, exit: true });
    const descriptors = Object.getOwnPropertyDescriptors(current);
    const keys = Reflect.ownKeys(descriptors);
    if (array && keys.length !== current.length + 1) return false;
    for (const key of keys) {
      if (array && key === 'length') continue;
      if (typeof key !== 'string') return false;
      const descriptor = descriptors[key]!;
      if (!('value' in descriptor) || !descriptor.enumerable) return false;
      if (array && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= current.length)) return false;
      stack.push({ value: descriptor.value });
    }
  }
  return true;
}

interface Refs {
  root: JsonSchemaObject;
  chain: readonly string[];
}
function resolveRef(root: JsonSchemaObject, ref: string): unknown {
  if (ref !== '#' && !ref.startsWith('#/')) return undefined;
  let cur: unknown = root;
  for (const part of ref === '#' ? [] : ref.slice(2).split('/')) {
    const key = part.replace(/~1/g, '/').replace(/~0/g, '~');
    if (!isSchemaObject(cur) || !Object.hasOwn(cur, key)) return undefined;
    cur = cur[key];
  }
  return cur;
}

/** Also walks forbidden schema-bearing keywords to give useful migration diagnostics. */
export function walk(
  node: unknown,
  depth: number,
  path: string,
  problems: string[],
  refs: Refs = { root: node as JsonSchemaObject, chain: [] },
  ancestors = new Set<unknown>(),
  budget = { remaining: 4096 },
): void {
  if (budget.remaining-- <= 0) {
    if (budget.remaining === -1) problems.push(`${path}: schema traversal limit exceeded`);
    return;
  }
  if (!isSchemaObject(node)) {
    problems.push(`${path}: schema must be an object`);
    return;
  }
  if (ancestors.has(node)) {
    problems.push(`${path}: recursive schema`);
    return;
  }
  ancestors.add(node);
  for (const key of Object.keys(node))
    if (!keywords.has(key)) problems.push(`${path}: uses ${key}`);
  if (typeof node.type !== 'string' || !types.has(node.type))
    problems.push(`${path}: invalid type${Array.isArray(node.type) ? ' (multi-type union)' : ''}`);
  if (
    'description' in node &&
    (!isPlainText(node.description) ||
      node.description.length > TOOL_LIMITS.propertyDescriptionLength)
  )
    problems.push(`${path}: invalid description`);
  const next = depth + (node.type === 'object' || 'properties' in node ? 1 : 0);
  if (next > 3) problems.push(`${path}: object nesting deeper than 3`);
  if (node.type === 'object' || 'properties' in node) {
    if (node.additionalProperties !== false)
      problems.push(`${path}: additionalProperties is not false`);
    if ('properties' in node && !isSchemaObject(node.properties))
      problems.push(`${path}: invalid properties`);
    const props = isSchemaObject(node.properties) ? node.properties : {};
    if (Object.keys(props).length > TOOL_LIMITS.properties)
      problems.push(`${path}: more than 32 properties`);
    for (const [key, value] of Object.entries(props)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key))
        problems.push(`${path}: unsafe property name ${key}`);
      if (!isSchemaObject(value) || !isPlainText(value.description))
        problems.push(`${path}/properties/${key}: missing description`);
      walk(value, next, `${path}/properties/${key}`, problems, refs, ancestors, budget);
    }
  }
  const props = isSchemaObject(node.properties) ? node.properties : {};
  if (
    'required' in node &&
    (!Array.isArray(node.required) ||
      Array.from(node.required).some(
        (k) => typeof k !== 'string' || (node.type === 'object' && !Object.hasOwn(props, k)),
      ) ||
      new Set(node.required).size !== node.required.length)
  )
    problems.push(`${path}: invalid required`);
  if ('additionalProperties' in node && node.additionalProperties !== false)
    problems.push(`${path}: additionalProperties must be false`);
  if (node.type === 'array' && !isSchemaObject(node.items))
    problems.push(`${path}: array requires items`);
  if (
    'enum' in node &&
    (!Array.isArray(node.enum) ||
      node.enum.length === 0 ||
      node.enum.length > TOOL_LIMITS.enumValues ||
      Array.from(node.enum).some(
        (v) =>
          !(typeof v === 'number' && Number.isFinite(v)) &&
          !(isPlainText(v) && v.length <= TOOL_LIMITS.enumStringLength),
      ))
  )
    problems.push(`${path}: invalid enum`);
  if ('default' in node && !isJsonValue(node.default))
    problems.push(`${path}: default must be a JSON value`);
  if (typeof node.default === 'string' && !isPlainText(node.default))
    problems.push(`${path}: invalid default plain text`);
  for (const key of [
    'minimum',
    'maximum',
    'exclusiveMinimum',
    'exclusiveMaximum',
    'minLength',
    'maxLength',
    'minItems',
    'maxItems',
  ]) {
    const v = node[key];
    if (
      key in node &&
      (typeof v !== 'number' ||
        !Number.isFinite(v) ||
        ((key.includes('Length') || key.includes('Items')) && (!Number.isInteger(v) || v < 0)))
    )
      problems.push(`${path}: invalid ${key}`);
  }
  if (typeof node.$ref === 'string') {
    if (refs.chain.includes(node.$ref)) problems.push(`${path}: recursive $ref`);
    else {
      const target = resolveRef(refs.root, node.$ref);
      if (target === undefined) problems.push(`${path}: unresolvable $ref`);
      else if (ancestors.has(target)) problems.push(`${path}: recursive $ref`);
      else
        walk(
          target,
          next,
          `${path}/$ref`,
          problems,
          { ...refs, chain: [...refs.chain, node.$ref] },
          ancestors,
          budget,
        );
    }
  }
  for (const key of ['$defs', 'definitions'])
    if (isSchemaObject(node[key]))
      for (const [k, value] of Object.entries(node[key]))
        walk(value, next, `${path}/${key}/${k}`, problems, refs, ancestors, budget);
  for (const key of ['items', 'not', 'if', 'propertyNames'])
    if (key in node) walk(node[key], next, `${path}/${key}`, problems, refs, ancestors, budget);
  for (const key of ['oneOf', 'anyOf', 'allOf', 'prefixItems'])
    if (Array.isArray(node[key]))
      node[key].forEach((value, i) =>
        walk(value, next, `${path}/${key}[${i}]`, problems, refs, ancestors, budget),
      );
  ancestors.delete(node);
}

export function checkToolDefinition(def: AnnouncedTool, origin: 'core' | 'pack'): string[] {
  const problems: string[] = [];
  if (!isSchemaObject(def)) return ['tool definition must be an object'];
  if (!isPlainText(def.description) || def.description.length > TOOL_LIMITS.toolDescriptionLength)
    problems.push('invalid tool description');
  if (!['read', 'write', 'destructive', 'code'].includes(def.category))
    problems.push('invalid category');
  if (!['player', 'gm'].includes(def.minRole)) problems.push('invalid minRole');
  if (origin === 'core') {
    if (typeof def.name !== 'string' || !TOOL_NAME_PATTERN.test(def.name))
      problems.push('invalid core name');
    if (def.pack !== undefined) problems.push('core definition cannot declare pack');
  } else {
    const pack = def.pack;
    if (!isSchemaObject(pack)) problems.push('missing pack prefix and metadata');
    else {
      if (typeof pack.prefix !== 'string' || !PACK_PREFIX_PATTERN.test(pack.prefix))
        problems.push('invalid pack prefix');
      if (RESERVED_PACK_PREFIXES.has(pack.prefix as string)) problems.push('reserved pack prefix');
      if (typeof pack.id !== 'string' || !PACK_ID_PATTERN.test(pack.id))
        problems.push('invalid pack id');
      if (typeof pack.version !== 'string' || !PACK_VERSION_PATTERN.test(pack.version))
        problems.push('invalid pack version');
      if (
        typeof def.name !== 'string' ||
        def.name.length > 36 ||
        !def.name.startsWith(`${pack.prefix}-`) ||
        !PACK_LOCAL_NAME_PATTERN.test(def.name.slice(String(pack.prefix).length + 1))
      )
        problems.push('invalid pack name or prefix mismatch');
    }
  }
  for (const [label, schema] of [
    ['input', def.inputSchema],
    ['output', def.outputSchema],
  ] as const) {
    try {
      if (new TextEncoder().encode(JSON.stringify(schema)).length > TOOL_LIMITS.schemaBytes) {
        problems.push(`${label}: schema exceeds 16 KiB`);
        continue;
      }
    } catch {
      problems.push(`${label}: schema must be serializable JSON`);
      continue;
    }
    if (!isSchemaObject(schema) || schema.type !== 'object')
      problems.push(`${label}: root type must be object`);
    walk(schema, 0, label, problems);
  }
  return problems;
}

export function conservativeProblems(tool: ToolDefinition): string[] {
  return checkToolDefinition({ ...tool, ...toJsonSchema(tool) }, 'core');
}
