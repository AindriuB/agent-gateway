import type { ToolDefinition } from './define.js';

export * from './define.js';
export * from './json-schema.js';

/** Registry of all tools. Later tasks only append entries. */
export const TOOLS: readonly ToolDefinition[] = [];

export function toolsForRole(isGM: boolean): readonly ToolDefinition[] {
  return isGM ? TOOLS : TOOLS.filter((t) => t.minRole === 'player');
}
