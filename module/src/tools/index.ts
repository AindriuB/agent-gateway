import type { OpHandler } from '../ops/types.js';
import { documentGetHandler } from './document-get.js';
import { documentSearchHandler } from './document-search.js';
import { worldInfoHandler } from './world-info.js';
import { chatReadHandler } from './chat-read.js';
import { compendiumGetHandler } from './compendium-get.js';
import { compendiumSearchHandler } from './compendium-search.js';

/** Map from tool name to handler. Later tasks only insert entries. */
export const HANDLERS: Record<string, OpHandler> = {
  world_info: worldInfoHandler,
  document_search: documentSearchHandler,
  document_get: documentGetHandler,
  compendium_search: compendiumSearchHandler,
  compendium_get: compendiumGetHandler,
  chat_read: chatReadHandler,
};
