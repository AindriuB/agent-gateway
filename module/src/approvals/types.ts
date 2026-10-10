export type ApprovalStatus = 'pending' | 'approved' | 'denied' | 'expired';
export type ApproverClass = 'owner' | 'gm';
export type ApprovalScope = 'once' | 'session';

export interface ApprovalRecord {
  id: string;
  agentId: string;
  /** The user the agent belongs to. */
  agentOwnerId: string;
  headless: boolean;
  sessionId: string;
  /** The Foundry user whose client made the call. */
  requesterId: string;
  tool: string;
  args: unknown;
  /** Hash of the exact tool and arguments; an approval binds to it. */
  argsHash: string;
  category: string;
  approver: ApproverClass;
  createdAt: number;
  expiresAt: number;
  status: ApprovalStatus;
  reason?: string;
  resolvedBy?: string;
  resolvedAt?: number;
  scope?: ApprovalScope;
  /** Set after approval: what the handler returned. */
  result?: { text: string; failed: boolean };
}

/** What an approver client is told about a request. */
export interface ApprovalRequestPayload {
  id: string;
  agentId: string;
  sessionId: string;
  tool: string;
  args: unknown;
  argsHash: string;
  category: string;
  approver: ApproverClass;
  createdAt: number;
  expiresAt: number;
}

/** A request held by an approver client. `requesterId` is the attested socket sender. */
export interface InboxEntry extends ApprovalRequestPayload {
  requesterId: string;
  requesterName: string;
  receivedAt: number;
}

export interface EnvUser {
  id: string;
  name: string;
  isGM: boolean;
  active: boolean;
}

/** Everything the manager needs from Foundry, so tests can run several clients side by side. */
export interface ApprovalEnv {
  localUser(): EnvUser | undefined;
  user(id: string): EnvUser | undefined;
  users(): EnvUser[];
  /** Send on the module socket; without recipients it goes to everyone else. */
  emit(data: unknown, recipients?: string[]): void;
  callHook(name: string, payload: unknown): void;
  /** Client storage: one JSON text for all users of this browser. */
  load(): string;
  save(text: string): void | Promise<unknown>;
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  random(bytes: number): Uint8Array;
  t(key: string, data?: Record<string, string>): string;
}

export interface ResolveOptions {
  decision: 'approve' | 'deny';
  reason?: string;
  scope?: ApprovalScope;
}
