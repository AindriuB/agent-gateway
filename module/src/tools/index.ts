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
};
