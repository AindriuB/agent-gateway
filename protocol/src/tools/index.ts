import { chatPost } from './chat-post.js';
import { rollFormula } from './roll-formula.js';
import { journalWrite } from './journal-write.js';
import type { ToolDefinition } from './define.js';
import { documentGet } from './document-get.js';
import { documentSearch } from './document-search.js';
import { worldInfo } from './world-info.js';
import { chatRead } from './chat-read.js';
import { compendiumGet } from './compendium-get.js';
import { compendiumSearch } from './compendium-search.js';
import { approvalStatus } from './approval-status.js';

export * from './chat-post.js';
export * from './roll-formula.js';
export * from './journal-write.js';
export * from './define.js';
export * from './json-schema.js';
export * from './document-get.js';
export * from './document-search.js';
export * from './world-info.js';
export * from './chat-read.js';
export * from './compendium-get.js';
export * from './compendium-search.js';
export * from './approval-status.js';

/** Registry of all tools. Later tasks only append entries. */
export const TOOLS: readonly ToolDefinition[] = [
  worldInfo,
  documentSearch,
  documentGet,
  compendiumSearch,
  compendiumGet,
  chatRead,
  approvalStatus,
  chatPost,
  rollFormula,
  journalWrite,
];

export function toolsForRole(isGM: boolean): readonly ToolDefinition[] {
  return isGM ? TOOLS : TOOLS.filter((t) => t.minRole === 'player');
}

export * from './rules.js';
export * from './limits.js';
export * from './validate.js';
export * from './pack.js';
