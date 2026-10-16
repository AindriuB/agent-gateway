import type { z } from 'zod';

export type ToolRole = 'player' | 'gm';
export type ToolCategory = 'read' | 'write' | 'destructive' | 'code';
export type ToolHandler = 'module' | 'gateway';

export const TOOL_NAME_PATTERN = /^[a-z][a-z0-9_]{2,40}$/;

export interface ToolDefinition<
  I extends z.ZodObject = z.ZodObject,
  O extends z.ZodObject = z.ZodObject,
> {
  readonly name: string;
  readonly minRole: ToolRole;
  readonly category: ToolCategory;
  readonly handledBy: ToolHandler;
  readonly description: string;
  readonly input: I;
  readonly output: O;
  /** `false`: the gateway lists this tool without an MCP `outputSchema` (it returns no `structuredContent`). */
  readonly mcpOutputSchema?: false;
  /** Top-level base64 argument fields shown only as size and SHA-256 in approvals and audit. */
  readonly redactArgs?: readonly string[];
}

export function defineTool<I extends z.ZodObject, O extends z.ZodObject>(
  tool: ToolDefinition<I, O>,
): ToolDefinition<I, O> {
  if (!TOOL_NAME_PATTERN.test(tool.name)) {
    throw new Error(`Invalid tool name "${tool.name}": must match ${TOOL_NAME_PATTERN}`);
  }
  return Object.freeze({ ...tool });
}
