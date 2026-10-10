import type { ToolCategory, ToolRole } from './define.js';
import type { JsonSchemaObject } from './json-schema.js';

export const PACK_API_VERSION = '1.0';

export interface AnnouncedTool {
  name: string;
  description: string;
  category: ToolCategory;
  minRole: ToolRole;
  inputSchema: JsonSchemaObject;
  outputSchema: JsonSchemaObject;
  pack?: { id: string; version: string; prefix: string };
}

export function parseApiVersion(value: unknown): { major: number; minor: number } | undefined {
  if (typeof value !== 'string' || !/^\d{1,4}\.\d{1,4}$/.test(value)) return undefined;
  const [major, minor] = value.split('.').map(Number);
  return { major: major!, minor: minor! };
}
