export interface OpUser {
  id: string;
  isGM: boolean;
}

export interface OpAgent {
  id: string;
  ownerUserId: string;
  headless: boolean;
}

export interface OpCall {
  tool: string;
  args: unknown;
  agent: OpAgent;
  sessionId: string;
}

export interface OpContext {
  user: OpUser;
  agent: OpAgent;
  sessionId: string;
  tool: string;
  args: unknown;
}

export interface OpResult {
  text: string;
  structured: Record<string, unknown>;
}

export type OpHandler = (ctx: OpContext) => Promise<DispatchResult> | DispatchResult;

export type OpErrorCode =
  'TOOL_NOT_FOUND' | 'FORBIDDEN' | 'INVALID_ARGS' | 'RATE_LIMITED' | 'DENIED' | 'INTERNAL';

export interface OpError {
  error: { code: OpErrorCode; message: string };
}

export type DispatchResult = OpResult | OpError;

export function isOpError(r: DispatchResult): r is OpError {
  return 'error' in r;
}
