import type { ToolCategory } from '@agent-gateway/protocol';
import type { ApprovalRequest } from '../policy/types.js';

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
  /** Dispatcher-owned, available only during synchronous core preparation. */
  escalate?(category: ToolCategory): void;
  /** Set by the policy stage when the call needs an approver's answer. */
  approval?: ApprovalRequest;
  /** Set by the approval stage once an approver (or a session grant) allowed this very call. */
  approved?: true;
}

export interface OpResult {
  text: string;
  structured: Record<string, unknown>;
}

export type OpHandler = ((ctx: OpContext) => Promise<DispatchResult> | DispatchResult) & {
  prepare?: (ctx: OpContext) => void;
};

export type OpErrorCode =
  'TOOL_NOT_FOUND' | 'FORBIDDEN' | 'INVALID_ARGS' | 'RATE_LIMITED' | 'DENIED' | 'INTERNAL';

export interface OpError {
  error: { code: OpErrorCode; message: string };
}

export type DispatchResult = OpResult | OpError;

export function isOpError(r: DispatchResult): r is OpError {
  return 'error' in r;
}
