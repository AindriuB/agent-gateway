/* eslint-disable @typescript-eslint/no-explicit-any */
import { fromUuidCompat } from '../compat/index.js';
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
const OWNER = 3;

/** The audit journal, found by its flag. Several (a race between two GMs) resolve to the lowest id. */
export function findAuditJournal(): any | null {
  const all: any[] = Array.from(game.journal?.contents ?? []);
  const hits = all.filter((j) => j?.flags?.[AUDIT_NS]?.[AUDIT_JOURNAL_FLAG] === true);
  hits.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return hits[0] ?? null;
}

let creating: Promise<any> | null = null;

/**
 * The audit journal, created if missing. Only a GM client may create it, with default ownership
 * NONE so players do not see it in Foundry's UI and tools cannot read it for them. An existing
 * journal whose default ownership was raised is reported, not silently changed.
 */
export async function ensureAuditJournal(): Promise<any | null> {
  const existing = findAuditJournal();
  if (existing) {
    const level = existing.ownership?.default;
    if (typeof level === 'number' && level > NONE) {
      console.warn(
        'agent-gateway | the audit journal is visible to players; set its default ownership to None',
      );
    }
    return existing;
  }
  if (game.user?.isGM !== true) return null;
  creating ??= (async () => {
    try {
      const levels = CONST?.DOCUMENT_OWNERSHIP_LEVELS;
      return await getDocumentClass('JournalEntry').create({
        name: game.i18n.localize('AGENT_GATEWAY.Audit.journalName'),
        ownership: { default: levels?.NONE ?? NONE },
        flags: { [AUDIT_NS]: { [AUDIT_JOURNAL_FLAG]: true } },
      });
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
      before: t.before ? JSON.stringify(t.before) : '',
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

const canModify = (doc: any, user: any): boolean =>
  typeof doc?.canUserModify === 'function'
    ? doc.canUserModify(user, 'update') === true
    : typeof doc?.testUserPermission === 'function' &&
      doc.testUserPermission(user, 'OWNER') === true;

/** The uuid of the document that holds this embedded one, or null for a world document. */
export function parentUuid(uuid: string): string | null {
  const parts = uuid.split('.');
  return parts.length > 2 ? parts.slice(0, -2).join('.') : null;
}

/**
 * A relayed record is the player client's claim. A target is kept undoable only when the sender
 * could have changed that document: they may modify it now, or (a deleted one) they may modify
 * its parent, or the snapshot itself gives them ownership. Anything else is recorded but cannot
 * be undone, so a forged record cannot make a GM's undo write arbitrary data.
 */
export async function verifyRelayedTargets(
  record: AuditRecord,
  sender: any,
  lookup: (uuid: string) => Promise<any> = (u) => fromUuidCompat(u),
): Promise<AuditRecord> {
  const targets = await Promise.all(
    record.targets.map(async (t) => {
      if (!t.undoable) return t;
      let ok = false;
      try {
        const doc = await lookup(t.uuid);
        if (doc) ok = canModify(doc, sender);
        else if (!t.existed) ok = true;
        else {
          const up = parentUuid(t.uuid);
          const parent = up ? await lookup(up) : null;
          const own = (t.before as any)?.ownership;
          const level = Number(own?.[sender.id] ?? own?.default ?? NONE);
          ok = parent ? canModify(parent, sender) : up === null && level >= OWNER;
        }
      } catch {
        ok = false;
      }
      return ok ? t : { ...t, undoable: false, note: 'the sender could not be verified as owner' };
    }),
  );
  return { ...record, targets };
}
