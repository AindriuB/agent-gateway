/** The JournalEntryPage subtype this module defines (module subtypes are prefixed by the module id). */
export const AUDIT_TYPE = 'agent-gateway.audit';
export const AUDIT_NS = 'agent-gateway';
/** Flag (under the module namespace) that marks the audit journal; the journal is found by it, never by name. */
export const AUDIT_JOURNAL_FLAG = 'auditJournal';
export const AUDIT_SOCKET = 'module.agent-gateway';

export type AuditCategory = 'write' | 'destructive' | 'code';

export interface AuditTarget {
  uuid: string;
  /** The document existed before the call. False means the call created it (undo deletes it). */
  existed: boolean;
  /** `toObject()` before the call; null when it did not exist or was too large to keep. */
  before: Record<string, unknown> | null;
  /** The document exists after the call. False for a deleted one (undo recreates it). */
  existsAfter: boolean;
  /** `_stats.modifiedTime` after the call; undo warns when the document is newer than this. */
  afterModifiedTime: number | null;
  undoable: boolean;
  /**
   * Key paths the GM's client observed changing (a witnessed update). Non-empty means undo restores
   * only these paths from `before`; empty means the whole document, which only a record captured by
   * the acting GM's own client may do.
   */
  changedPaths: string[];
  /** Why the target cannot be undone, when it cannot. */
  note: string;
}

export interface AuditRecord {
  /** Random id, so a relayed record that is resent is written once. */
  entryId: string;
  timestamp: number;
  userId: string;
  agentId: string;
  tool: string;
  category: AuditCategory;
  /** The call's arguments as bounded JSON text (never an object: it is shown, not used). */
  args: string;
  argsTruncated: boolean;
  targets: AuditTarget[];
  targetsDropped: number;
  /** Short result summary, or the error message. */
  result: string;
  status: 'ok' | 'error';
  /** The record came from a player client over the module socket. */
  relayed: boolean;
}

/** A target as stored on the page: the snapshot is JSON text ('' for none). */
export type StoredTarget = Omit<AuditTarget, 'before'> & { before: string };

/** What is stored in the page's `system` data: the record plus its undo state. */
export interface AuditSystemData extends Omit<AuditRecord, 'targets'> {
  targets: StoredTarget[];
  /** Targets already restored, persisted after each mutation so retries never repeat them. */
  undoCompleted: string[];
  undoneAt: number | null;
  undoneBy: string;
}

/** Hard limits on stored data. Args and snapshots can be large or hostile. */
export const AUDIT_LIMITS = {
  /** Characters of args JSON kept. */
  argsChars: 8000,
  /** Longest single string inside args before it is cut. */
  argsString: 500,
  argsDepth: 6,
  /** Keys per object and items per array kept inside args. */
  argsBreadth: 30,
  /** Total values visited when bounding args. */
  argsNodes: 500,
  /** Serialised characters of one before-snapshot; larger ones are not kept and not undoable. */
  beforeChars: 200_000,
  /** Total before-snapshot characters kept for one entry. */
  beforeTotalChars: 600_000,
  targets: 50,
  result: 500,
  label: 120,
  uuid: 300,
  /** Records held on a player client while no GM is online. */
  buffer: 200,
  /** Key paths kept per witnessed update, and the longest one. */
  changedPaths: 200,
  changedPath: 200,
  /** Witnessed calls a sender may have open at once, and uuids per call. */
  openCalls: 30,
  callUuids: 50,
  /** Observed changes kept per call. */
  observed: 200,
  /** How long a witnessed call stays open. */
  callTtlMs: 600_000,
  /** How long a player client waits for the GM to witness an intent. */
  intentWaitMs: 5000,
  /** Witness memory: bytes held across a sender's open calls, and across all of them. */
  witnessSenderBytes: 2_000_000,
  witnessTotalBytes: 16_000_000,
  /** How often expired witnessed calls are freed. */
  sweepMs: 60_000,
} as const;
