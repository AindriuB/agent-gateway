import { z } from 'zod';
import type { ToolDefinition } from './define.js';

export type JsonSchemaObject = Record<string, unknown>;

export interface ToolJsonSchemas {
  inputSchema: JsonSchemaObject;
  outputSchema: JsonSchemaObject;
}

export function toJsonSchema(tool: ToolDefinition): ToolJsonSchemas {
  const opts = { target: 'draft-2020-12' } as const;
  const strip = (schema: JsonSchemaObject): JsonSchemaObject => {
    const copy = { ...schema };
    delete copy.$schema;
    return copy;
  };
  return {
    inputSchema: strip(z.toJSONSchema(tool.input, { ...opts, io: 'input' })),
    outputSchema: strip(z.toJSONSchema(tool.output, { ...opts, io: 'output' })),
  };
}
