import type { OpHandler } from '../ops/types.js';

/** Map from tool name to handler. Later tasks only insert entries. */
export const HANDLERS: Record<string, OpHandler> = {};
