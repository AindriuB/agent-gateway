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

const storedId = (): string | null => {
  try {
    const value = game.settings.get(AUDIT_NS, AUDIT_JOURNAL_ID_SETTING);
    return typeof value === 'string' ? value : null;
  } catch {
    return null;
  }
};

/** Why a journal is not the audit journal, or null when it is trustworthy. */
function untrusted(j: any): string | null {
  if (j?.flags?.[AUDIT_NS]?.[AUDIT_JOURNAL_FLAG] !== true) return 'it is not flagged';
  const key = `${AUDIT_NS}.${AUDIT_JOURNAL_ID_SETTING}`;
  const setting = game.settings?.storage?.get?.('world')?.getSetting?.(key);
  if (
    setting?.key !== key ||
    setting.user !== null ||
    typeof setting.value !== 'string' ||
    setting.value !== j.id
  ) {
    return 'it has no matching persisted world designation';
  }
  const by = setting._stats?.lastModifiedBy;
  if (typeof by !== 'string' || game.users?.get?.(by)?.isGM !== true) {
    return 'its world designation was not written by a current GM';
  }
  if (!Array.isArray(game.users?.contents)) return 'its effective ownership is unavailable';
  for (const u of Array.from(game.users?.contents ?? [])) {
    if ((u as any).isGM) continue;
    const level = typeof j.getUserLevel === 'function' ? j.getUserLevel(u) : undefined;
    const permitted = j.testUserPermission?.(u, 'LIMITED');
    if (level === undefined && typeof permitted !== 'boolean')
      return 'its effective ownership is unavailable';
    const sees = level !== undefined ? !Number.isFinite(level) || level > NONE : permitted;
    if (sees) return 'a non-GM user has access to it';
  }
  if (j.ownership?.default !== NONE) {
    return 'its default ownership is above None';
  }
  return null;
}

/**
 * The audit journal: the journal whose id is in the world setting, and only if it is flagged,
 * designated by a current GM and closed to every non-GM user. Any other journal carrying the flag is ignored,
 * so a player cannot plant one to receive or show entries.
 */
export function findAuditJournal(): any | null {
  const id = storedId();
  if (!id) return null;
  const j = game.journal?.get?.(id) ?? null;
  if (!j || j.id !== id) return null;
  let why: string | null;
  try {
    why = untrusted(j);
  } catch {
    why = 'its provenance or ownership is inaccessible';
  }
  if (why) {
    console.warn(`agent-gateway | ignoring the audit journal ${id}: ${why}`);
    return null;
  }
  return j;
}

/** Only a readable, genuinely empty selection permits factory creation; never repair provenance. */
function unconfigured(): boolean {
  if (storedId() !== '') return false;
  try {
    const storage = game.settings.storage.get('world');
    if (typeof storage?.getSetting !== 'function') return false;
    const key = `${AUDIT_NS}.${AUDIT_JOURNAL_ID_SETTING}`;
    const setting = storage.getSetting(key);
    if (setting == null) return true;
    return (
      setting.key === key &&
      setting.user === null &&
      setting.value === '' &&
      typeof setting._stats?.lastModifiedBy === 'string' &&
      game.users?.get?.(setting._stats.lastModifiedBy)?.isGM === true
    );
  } catch {
    return false;
  }
}

let creating: Promise<any> | null = null;

/**
 * The audit journal, created only when its readable world selection is empty. Only a GM client creates it,
 * with default ownership NONE, and records its id in the world setting. A named journal that fails
 * the checks is never replaced silently: the problem is logged and no entries are written.
 */
export async function ensureAuditJournal(): Promise<any | null> {
  const existing = findAuditJournal();
  if (existing) return existing;
  if (!unconfigured()) return null;
  // Only the designated active GM creates it, so two GM clients never make two journals.
  if (game.user?.isGM !== true || game.users?.activeGM?.id !== game.user.id) return null;
  const creator = game.user.id;
  creating ??= (async () => {
    try {
      const levels = CONST?.DOCUMENT_OWNERSHIP_LEVELS;
      const j = await getDocumentClass('JournalEntry').create({
        name: game.i18n.localize('AGENT_GATEWAY.Audit.journalName'),
        ownership: { default: levels?.NONE ?? NONE },
        flags: { [AUDIT_NS]: { [AUDIT_JOURNAL_FLAG]: true } },
      });
      if (
        game.user?.id !== creator ||
        game.user?.isGM !== true ||
        game.users?.get?.(creator)?.isGM !== true ||
        game.users.activeGM?.id !== creator ||
        !unconfigured()
      ) {
        throw new Error('The designated GM or empty audit selection changed before designation');
      }
      await game.settings.set(AUDIT_NS, AUDIT_JOURNAL_ID_SETTING, j.id);
      const trusted = findAuditJournal();
      if (trusted !== j)
        throw new Error('Foundry did not persist a trusted audit journal designation');
      return trusted;
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
      // Targets are final here: a relayed record's targets were either rebuilt by the GM client
      // from its own capture (AuditWitness.assemble) or are view-only (sanitiseTarget).
      before: t.before ? JSON.stringify(t.before) : '',
    })),
    undoCompleted: [],
    undoneAt: null,
    undoneBy: '',
  };
  return {
    name: safeText(`${new Date(record.timestamp).toISOString()} ${record.tool}`, 160),
    type: AUDIT_TYPE,
    system,
  };
}

/** A server-enforced page id scoped to the authenticated sender and entry id. */
function entryPageId(record: AuditRecord): string {
  const key = JSON.stringify([AUDIT_NS, 'entry', record.userId, record.entryId]);
  let hash = 0xcbf29ce484222325n;
  for (const c of key) {
    hash = BigInt.asUintN(64, (hash ^ BigInt(c.codePointAt(0)!)) * 0x100000001b3n);
  }
  // Foundry ids contain 16 alphanumeric characters. A collision refuses persistence rather
  // than overwriting or acknowledging another entry: every read also checks the full key.
  // Like undo reservation ids, this also works on Foundry deployments served over plain HTTP.
  return hash.toString(16).padStart(16, '0');
}

/** Write once across GM tabs: Foundry rejects duplicate retained embedded-document ids. */
export async function writeAuditEntry(record: AuditRecord): Promise<boolean> {
  const journal = await ensureAuditJournal();
  if (!journal) throw new Error('no audit journal and this client cannot create one');
  const pages: any[] = Array.from(journal.pages?.contents ?? []);
  if (
    pages.some((p) => p?.system?.userId === record.userId && p?.system?.entryId === record.entryId)
  )
    return false;
  const id = entryPageId(record);
  const matches = (p: any): boolean =>
    (p?.id ?? p?._id) === id &&
    p.type === AUDIT_TYPE &&
    p.system?.entryId === record.entryId &&
    p.system?.userId === record.userId;
  try {
    const pagesCreated = await journal.createEmbeddedDocuments(
      'JournalEntryPage',
      [{ ...pageData(record), _id: id }],
      { keepId: true },
    );
    if (!pagesCreated?.some(matches)) throw new Error('Foundry did not persist the audit entry');
    return true;
  } catch (err) {
    // Another tab may have won, or the server persisted our write before the response failed.
    // Client caches can still be stale. A fresh server read must confirm the exact entry before
    // acknowledging it; never retry with a generated id or overwrite its undo completion state.
    try {
      const cls = getDocumentClass('JournalEntryPage');
      const persisted = await cls.database.get(cls, { parent: journal, query: { _id: id } });
      if (persisted.some(matches)) return false;
    } catch {
      // An unavailable read cannot establish persistence. Keep the relay unacknowledged.
    }
    throw err;
  }
}
