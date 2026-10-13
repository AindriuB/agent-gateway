import { actorSummaryHandler } from './actor-summary.js';
import { actionsListHandler } from './actions-list.js';
import { actionPerformHandler } from './action-perform.js';
import { inventoryHandler } from './inventory.js';
import { conditionsHandler } from './conditions.js';
import { characterBuildHandler } from './character-build.js';
import { macroRunHandler } from './macro-run.js';
import { scriptRunHandler } from './script-run.js';
import { tableRollHandler } from './table-roll.js';
import { playlistControlHandler } from './playlist-control.js';
import { notifyHandler } from './notify.js';
import { tokenManageHandler } from './token-manage.js';
import { combatManageHandler } from './combat-manage.js';
import { sceneControlHandler } from './scene-control.js';
import { documentCreateHandler } from './document-create.js';
import { documentUpdateHandler } from './document-update.js';
import { documentDeleteHandler } from './document-delete.js';
import { compendiumImportHandler } from './compendium-import.js';
import { tokenMoveHandler } from './token-move.js';
import { targetSetHandler } from './target-set.js';
import { combatStatusHandler } from './combat-status.js';
import { combatEndTurnHandler } from './combat-end-turn.js';
import { chatPostHandler } from './chat-post.js';
import { rollFormulaHandler } from './roll-formula.js';
import { journalWriteHandler } from './journal-write.js';
import type { OpHandler } from '../ops/types.js';
import { documentGetHandler } from './document-get.js';
import { documentSearchHandler } from './document-search.js';
import { worldInfoHandler } from './world-info.js';
import { chatReadHandler } from './chat-read.js';
import { compendiumGetHandler } from './compendium-get.js';
import { compendiumSearchHandler } from './compendium-search.js';
import { approvalStatusHandler } from './approval-status.js';

/** Map from tool name to handler. Later tasks only insert entries. */
export const HANDLERS: Record<string, OpHandler> = {
  actor_summary: actorSummaryHandler,
  actions_list: actionsListHandler,
  action_perform: actionPerformHandler,
  inventory: inventoryHandler,
  conditions: conditionsHandler,
  character_build: characterBuildHandler,
  macro_run: macroRunHandler,
  script_run: scriptRunHandler,
  table_roll: tableRollHandler,
  playlist_control: playlistControlHandler,
  notify: notifyHandler,
  token_manage: tokenManageHandler,
  combat_manage: combatManageHandler,
  scene_control: sceneControlHandler,
  world_info: worldInfoHandler,
  document_search: documentSearchHandler,
  document_get: documentGetHandler,
  compendium_search: compendiumSearchHandler,
  compendium_get: compendiumGetHandler,
  chat_read: chatReadHandler,
  approval_status: approvalStatusHandler,
  chat_post: chatPostHandler,
  roll_formula: rollFormulaHandler,
  journal_write: journalWriteHandler,
  token_move: tokenMoveHandler,
  target_set: targetSetHandler,
  combat_status: combatStatusHandler,
  combat_end_turn: combatEndTurnHandler,
  document_create: documentCreateHandler,
  document_update: documentUpdateHandler,
  document_delete: documentDeleteHandler,
  compendium_import: compendiumImportHandler,
};
