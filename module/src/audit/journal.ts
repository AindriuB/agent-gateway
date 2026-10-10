/* eslint-disable @typescript-eslint/no-explicit-any */
import { safeText } from './record.js';
import {
  AUDIT_JOURNAL_FLAG,
  AUDIT_NS,
  AUDIT_TYPE,
  type AuditRecord,
  type AuditSystemData,
} from './types.js';

declare const game: any;
declare const CONST: any;
declare function getDocumentClass(name: string): any;

const NONE = 0;
export const AUDIT_JOURNAL_ID_SETTING = 'auditJournalId';

/** Register the world setting that names the audit journal. GM-written: settings writes are server-gated. */
export function registerAuditSettings(): void {
  game.settings.register(AUDIT_NS, AUDIT_JOURNAL_ID_SETTING, {
    scope: 'world',
    config: false,
    type: String,
    default: '',
  });
}

const storedId = (): string => {
  try {
    return String(game.settings.get(AUDIT_NS, AUDIT_JOURNAL_ID_SETTING) ?? '');
  } catch {
    return '';
  }
};

/** Why a journal is not the audit journal, or null when it is trustworthy. */
function untrusted(j: any): string | null {
  if (j?.flags?.[AUDIT_NS]?.[AUDIT_JOURNAL_FLAG] !== true) return 'it is not flagged';
  const by = j._stats?.createdBy;
  if (!by || game.users?.get?.(by)?.isGM !== true) return 'it was not created by a GM';
  for (const u of Array.from(game.users?.contents ?? [])) {
    if ((u as any).isGM) continue;
    const level = typeof j.getUserLevel === 'function' ? j.getUserLevel(u) : undefined;
    const sees = level !== undefined ? level > NONE : j.testUserPermission?.(u, 'LIMITED') === true;
    if (sees) return 'a non-GM user has access to it';
  }
  if (typeof j.ownership?.default === 'number' && j.ownership.default > NONE) {
    return 'its default ownership is above None';
  }
  return null;
}

/**
 * The audit journal: the journal whose id is in the world setting, and only if it is flagged,
 * created by a GM and closed to every non-GM user. Any other journal carrying the flag is ignored,
 * so a player cannot plant one to receive or show entries.
 */
export function findAuditJournal(): any | null {
  const id = storedId();
  if (!id) return null;
  const j = game.journal?.get?.(id) ?? null;
  if (!j) return null;
  const why = untrusted(j);
  if (why) {
    console.warn(`agent-gateway | ignoring the audit journal ${id}: ${why}`);
    return null;
  }
  return j;
}

let creating: Promise<any> | null = null;

/**
 * The audit journal, created if the setting names none that exists. Only a GM client creates it,
 * with default ownership NONE, and records its id in the world setting. A named journal that fails
 * the checks is never replaced silently: the problem is logged and no entries are written.
 */
export async function ensureAuditJournal(): Promise<any | null> {
  const existing = findAuditJournal();
  if (existing) return existing;
  const id = storedId();
  if (id && game.journal?.get?.(id)) return null;
  if (game.user?.isGM !== true) return null;
  creating ??= (async () => {
    try {
      const levels = CONST?.DOCUMENT_OWNERSHIP_LEVELS;
      const j = await getDocumentClass('JournalEntry').create({
        name: game.i18n.localize('AGENT_GATEWAY.Audit.journalName'),
        ownership: { default: levels?.NONE ?? NONE },
        flags: { [AUDIT_NS]: { [AUDIT_JOURNAL_FLAG]: true } },
      });
      await game.settings.set(AUDIT_NS, AUDIT_JOURNAL_ID_SETTING, j.id);
      return j;
    } finally {
      creating = null;
    }
  })();
  return creating;
}

export function pageData(record: AuditRecord): Record<string, unknown> {
  const system: AuditSystemData = {
    ...record,
    targets: record.targets.map((t) => ({
      ...t,
      // A relayed record is view-only whatever it says: no snapshot, never undoable.
      undoable: record.relayed ? false : t.undoable,
      before: !record.relayed && t.before ? JSON.stringify(t.before) : '',
    })),
    undoneAt: null,
    undoneBy: '',
  };
  return {
    name: safeText(`${new Date(record.timestamp).toISOString()} ${record.tool}`, 160),
    type: AUDIT_TYPE,
    system,
  };
}

/** Write one record as a page. A record already written (same entry id) is not written again. */
export async function writeAuditEntry(record: AuditRecord): Promise<boolean> {
  const journal = await ensureAuditJournal();
  if (!journal) throw new Error('no audit journal and this client cannot create one');
  const pages: any[] = Array.from(journal.pages?.contents ?? []);
  if (pages.some((p) => p?.system?.entryId === record.entryId)) return false;
  await journal.createEmbeddedDocuments('JournalEntryPage', [pageData(record)]);
  return true;
}
