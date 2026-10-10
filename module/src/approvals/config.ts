import { APPROVAL_WAIT_MS } from '@agent-gateway/protocol';

export const APPROVAL_CONFIG = {
  /** How long a call waits for an answer before it returns pending_approval. */
  APPROVAL_WAIT_MS,
  /** A request nobody answers within this long expires and can no longer be approved. */
  APPROVAL_TTL_MS: 60 * 60_000,
  /** Resolved and expired records stay readable through approval_status this long. */
  APPROVAL_RETAIN_MS: 60 * 60_000,
  /** Pending requests one agent may have open at once. */
  MAX_PENDING_PER_AGENT: 20,
  /** Records kept per user in client storage. */
  MAX_RECORDS: 200,
  /** Requests an approver client holds, in total and per requester. */
  MAX_INBOX: 100,
  MAX_INBOX_PER_SENDER: 20,
  /** Longest reason, and longest stored handler result text. */
  MAX_REASON_CHARS: 500,
  MAX_RESULT_CHARS: 100_000,
} as const;

/** The module socket channel. */
export const APPROVAL_CHANNEL = 'module.agent-gateway';
