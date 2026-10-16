import { actorSummary } from './actor-summary.js';
export * from './actor-summary.js';
import { actionsList } from './actions-list.js';
export * from './actions-list.js';
import { actionPerform } from './action-perform.js';
export * from './action-perform.js';
import { inventory } from './inventory.js';
export * from './inventory.js';
import { conditions } from './conditions.js';
import { characterBuild } from './character-build.js';
import { imageAssign } from './image-assign.js';
export * from './image-assign.js';
export * from './conditions.js';
export * from './character-build.js';
import { eventsPoll } from './events-poll.js';
import { eventsHistory } from './events-history.js';
export * from './events-poll.js';
export * from './events-history.js';
import { macroRun } from './macro-run.js';
import { scriptRun } from './script-run.js';
export * from './macro-run.js';
export * from './script-run.js';
import { tableRoll } from './table-roll.js';
import { playlistControl } from './playlist-control.js';
import { notify } from './notify.js';
export * from './table-roll.js';
export * from './playlist-control.js';
export * from './notify.js';
import { tokenManage } from './token-manage.js';
import { combatManage } from './combat-manage.js';
import { sceneControl } from './scene-control.js';
export * from './token-manage.js';
export * from './combat-manage.js';
export * from './scene-control.js';
import { documentCreate } from './document-create.js';
import { documentUpdate } from './document-update.js';
import { documentDelete } from './document-delete.js';
import { compendiumImport } from './compendium-import.js';
import { tokenMove } from './token-move.js';
import { targetSet } from './target-set.js';
import { combatStatus } from './combat-status.js';
import { combatEndTurn } from './combat-end-turn.js';
import { chatPost } from './chat-post.js';
import { rollFormula } from './roll-formula.js';
import { journalWrite } from './journal-write.js';
import { imageUpload } from './image-upload.js';
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
export * from './image-upload.js';
export * from './token-move.js';
export * from './target-set.js';
export * from './combat-status.js';
export * from './combat-end-turn.js';
export * from './document-create.js';
export * from './document-update.js';
export * from './document-delete.js';
export * from './compendium-import.js';
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
  actorSummary,
  actionsList,
  actionPerform,
  inventory,
  conditions,
  characterBuild,
  imageAssign,

  macroRun,
  scriptRun,
  tableRoll,
  playlistControl,
  notify,
  tokenManage,
  combatManage,
  sceneControl,
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
  tokenMove,
  targetSet,
  combatStatus,
  combatEndTurn,
  documentCreate,
  documentUpdate,
  documentDelete,
  compendiumImport,
  eventsPoll,
  eventsHistory,
  imageUpload,
];

export function toolsForRole(isGM: boolean): readonly ToolDefinition[] {
  return isGM ? TOOLS : TOOLS.filter((t) => t.minRole === 'player');
}

export * from './rules.js';
export * from './limits.js';
export * from './validate.js';
export * from './pack.js';
