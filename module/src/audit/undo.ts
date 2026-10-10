/* eslint-disable @typescript-eslint/no-explicit-any */
import { fromUuidCompat } from '../compat/index.js';
import { isAuditDocument } from './guard.js';
import { decodeBefore } from './record.js';
import type { AuditTarget, StoredTarget } from './types.js';

declare const game: any;
declare function getDocumentClass(name: string): any;

export interface UndoDeps {
  isGM(): boolean;
  userId(): string;
  fromUuid(uuid: string): Promise<any>;
  /** Ask the GM about changes made since; resolves true to go on. */
  confirmConflicts(conflicts: Conflict[]): Promise<boolean>;
  /** May the acting GM update or delete this document? */
  canModify(doc: any, action: 'update' | 'delete'): boolean;
  /** May the acting GM create documents of this class (a world class, or a parent's embedded one)? */
  canCreate(docName: string): boolean;
  now(): number;
}

export interface Conflict {
  uuid: string;
  reason: 'modified' | 'recreated' | 'deleted';
}

export interface UndoOutcome {
  status: 'done' | 'cancelled' | 'refused' | 'busy' | 'failed';
  restored: number;
  skipped: string[];
  failed: string[];
  conflicts: Conflict[];
}

const defaultDeps = (confirm: UndoDeps['confirmConflicts']): UndoDeps => ({
  isGM: () => game.user?.isGM === true,
  userId: () => String(game.user?.id ?? ''),
  fromUuid: (u) => fromUuidCompat(u),
  confirmConflicts: confirm,
  canModify: (doc, action) => {
    const user = game.user;
    return typeof doc?.canUserModify === 'function'
      ? doc.canUserModify(user, action) === true
      : doc?.testUserPermission?.(user, 'OWNER') === true;
  },
  canCreate: (name) => getDocumentClass(name)?.canUserCreate?.(game.user) !== false,
  now: () => Date.now(),
});

/**
 * World document classes undo may touch (update, delete or recreate). Deliberately not `User`,
 * `Setting`, `Macro`, `Adventure` or anything that carries credentials, scripts or world config.
 */
export const UNDO_CLASSES: readonly string[] = [
  'Actor',
  'Item',
  'JournalEntry',
  'Scene',
  'RollTable',
  'Playlist',
  'Cards',
  'Folder',
  'ChatMessage',
];

/** Embedded document classes undo may recreate inside an allowed parent. */
export const UNDO_EMBEDDED: readonly string[] = [
  'Item',
  'ActiveEffect',
  'JournalEntryPage',
  'Token',
  'Tile',
  'Drawing',
  'Note',
  'Wall',
  'AmbientLight',
  'AmbientSound',
  'MeasuredTemplate',
  'TableResult',
  'PlaylistSound',
  'Card',
];

/** The class of the document a uuid names, and of its root; null for a uuid undo will not handle. */
export function undoClasses(uuid: string): { root: string; own: string } | null {
  const parts = uuid.split('.');
  if (parts.length < 2 || parts.length % 2 !== 0) return null;
  const root = parts[0]!;
  const own = parts[parts.length - 2]!;
  if (!UNDO_CLASSES.includes(root)) return null;
  if (parts.length > 2 && !UNDO_EMBEDDED.includes(own)) return null;
  return { root, own };
}

/** Audit pages being undone right now, so a double click cannot run an undo twice. */
const inFlight = new Set<string>();

/** Keys of a snapshot that an update must not carry. */
const NEVER_RESTORE = ['_id', '_stats'];

/** Names of the collections a document embeds; their children are separate documents with their own snapshots. */
function embeddedNames(doc: any): string[] {
  const meta = doc?.constructor?.metadata?.embedded;
  return meta && typeof meta === 'object' ? Object.values(meta).map(String) : [];
}

/** How the document now differs from how the call left it; null when it does not. */
export function conflictFor(target: AuditTarget, current: any): Conflict | null {
  const exists = !!current;
  if (exists !== target.existsAfter) {
    // Gone when the call left it, or back when the call deleted it.
    return { uuid: target.uuid, reason: exists ? 'recreated' : 'deleted' };
  }
  if (!exists) return null;
  const now = Number(current._stats?.modifiedTime);
  if (!Number.isFinite(now)) return null;
  const after = target.afterModifiedTime;
  return after === null || now > after ? { uuid: target.uuid, reason: 'modified' } : null;
}

export function restoreData(before: Record<string, unknown>, doc: any): Record<string, unknown> {
  const skip = new Set([...NEVER_RESTORE, ...embeddedNames(doc)]);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(before)) if (!skip.has(k)) out[k] = v;
  return out;
}

async function recreate(target: AuditTarget, deps: UndoDeps): Promise<void> {
  const parts = target.uuid.split('.');
  const before = target.before!;
  if (parts.length <= 2) {
    if (!deps.canCreate(parts[0]!)) throw new Error('not permitted to create this document');
    const cls = getDocumentClass(parts[0]!);
    await cls.create(before, { keepId: true });
    return;
  }
  const docName = parts[parts.length - 2]!;
  const parent = await deps.fromUuid(parts.slice(0, -2).join('.'));
  if (!parent) throw new Error('the parent document no longer exists');
  if (!deps.canModify(parent, 'update')) throw new Error('not permitted to change the parent');
  const collection = Object.entries(parent.constructor?.metadata?.embedded ?? {}).find(
    ([name]) => name === docName,
  )?.[0];
  if (!collection) throw new Error(`cannot recreate a ${docName} here`);
  await parent.createEmbeddedDocuments(docName, [before], { keepId: true });
}

/**
 * Undo one audit entry. Humans only: nothing here is a tool, and a non-GM is refused. Targets are
 * restored last to first. If any target changed since the call, nothing is touched until the GM
 * confirms. The entry is marked undone only when every restorable target succeeded.
 */
export async function undoEntry(
  page: any,
  confirm: UndoDeps['confirmConflicts'],
  overrides: Partial<UndoDeps> = {},
): Promise<UndoOutcome> {
  const deps = { ...defaultDeps(confirm), ...overrides };
  const out: UndoOutcome = { status: 'done', restored: 0, skipped: [], failed: [], conflicts: [] };
  const system = page?.system;
  // Only a snapshot the acting user's own client took is ever applied: a relayed record is
  // view-only in the log, whatever its stored fields say.
  if (!deps.isGM() || !system || system.undoneAt || system.relayed === true) {
    return { ...out, status: 'refused' };
  }
  const key = String(page.id ?? system.entryId ?? '');
  if (inFlight.has(key)) return { ...out, status: 'busy' };
  inFlight.add(key);
  try {
    return await run(page, system, deps, out);
  } finally {
    inFlight.delete(key);
  }
}

async function run(page: any, system: any, deps: UndoDeps, out: UndoOutcome): Promise<UndoOutcome> {
  const targets: AuditTarget[] = ([...(system.targets ?? [])] as StoredTarget[])
    .map((t) => ({ ...t, before: decodeBefore(t) }))
    .reverse();
  // A target that should restore but has no readable snapshot cannot be restored.
  for (const t of targets) {
    if (t.existed && t.before === null && t.undoable) {
      t.undoable = false;
      t.note ||= 'no readable snapshot';
    }
  }
  const plan: Array<{ target: AuditTarget; doc: any }> = [];
  for (const t of targets) {
    if (!t.undoable || !undoClasses(t.uuid)) {
      out.skipped.push(t.uuid);
      continue;
    }
    let doc: any = null;
    try {
      doc = await deps.fromUuid(t.uuid);
    } catch {
      doc = null;
    }
    if (doc && isAuditDocument(doc)) {
      out.skipped.push(t.uuid);
      continue;
    }
    const c = conflictFor(t, doc);
    if (c) out.conflicts.push(c);
    plan.push({ target: t, doc });
  }
  if (out.conflicts.length && !(await deps.confirmConflicts(out.conflicts))) {
    return { ...out, status: 'cancelled' };
  }
  for (const { target, doc } of plan) {
    try {
      if (!target.existed) {
        if (doc) {
          if (!deps.canModify(doc, 'delete')) throw new Error('not permitted to delete');
          await doc.delete();
        }
      } else if (doc) {
        if (!deps.canModify(doc, 'update')) throw new Error('not permitted to update');
        await doc.update(restoreData(target.before!, doc), { diff: false, recursive: false });
      } else {
        await recreate(target, deps);
      }
      out.restored += 1;
    } catch (err) {
      console.error(`agent-gateway | undo failed for ${target.uuid}`, err);
      out.failed.push(target.uuid);
    }
  }
  if (out.failed.length) return { ...out, status: 'failed' };
  await page.update({ 'system.undoneAt': deps.now(), 'system.undoneBy': deps.userId() });
  return out;
}
