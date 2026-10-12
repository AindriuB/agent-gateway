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

export class OpAdmissionError extends Error {
  constructor(
    readonly code: 'INVALID_ARGS' | 'FORBIDDEN',
    message: string,
  ) {
    super(message);
  }
}
export type AdmissionContext = Readonly<
  Pick<OpContext, 'user' | 'agent' | 'sessionId' | 'tool' | 'args'>
>;

export type OpHandler = ((ctx: OpContext) => Promise<DispatchResult> | DispatchResult) & {
  prepare?: (ctx: OpContext) => void;
  /** Trusted core read-only admission; returns replacement review arguments only. */
  admit?: (ctx: AdmissionContext) => Promise<unknown>;
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

/** Trusted link provenance lives outside caller arguments and mutable handler contexts. */
export interface ReplayContext {
  readonly id: string;
  readonly expiresAt: number;
  current(): boolean;
  markApproved?(gm: boolean): void;
  gmApproved?(): boolean;
  report(status: 'pending' | 'approved' | 'denied' | 'expired' | 'unknown', text: string): void;
}
const replayContexts = new WeakMap<object, ReplayContext>();
export function bindReplay(value: object, replay: ReplayContext): void {
  replayContexts.set(value, Object.freeze(replay));
}
export function replayOf(value: object): ReplayContext | undefined {
  return replayContexts.get(value);
}
