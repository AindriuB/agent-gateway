import type { OpHandler } from '../ops/types.js';
import { documentGetHandler } from './document-get.js';
import { documentSearchHandler } from './document-search.js';
import { worldInfoHandler } from './world-info.js';

/** Map from tool name to handler. Later tasks only insert entries. */
export const HANDLERS: Record<string, OpHandler> = {
  world_info: worldInfoHandler,
  document_search: documentSearchHandler,
  document_get: documentGetHandler,
};
