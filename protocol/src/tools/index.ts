import type { ToolDefinition } from './define.js';
import { documentGet } from './document-get.js';
import { documentSearch } from './document-search.js';
import { worldInfo } from './world-info.js';

export * from './define.js';
export * from './json-schema.js';
export * from './document-get.js';
export * from './document-search.js';
export * from './world-info.js';

/** Registry of all tools. Later tasks only append entries. */
export const TOOLS: readonly ToolDefinition[] = [worldInfo, documentSearch, documentGet];

export function toolsForRole(isGM: boolean): readonly ToolDefinition[] {
  return isGM ? TOOLS : TOOLS.filter((t) => t.minRole === 'player');
}
