/* eslint-disable @typescript-eslint/no-explicit-any */
import { fromUuidCompat } from '../compat/index.js';
import { isAuditDocument } from './guard.js';
import { reserveUndo, type UndoReservation } from './reservation.js';
import { undoClasses } from './undo-classes.js';
export { UNDO_CLASSES, UNDO_EMBEDDED, undoClasses } from './undo-classes.js';
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
  /** Reserve the entry across clients and read its current state from the server. */
  reserve(page: any): Promise<UndoReservation | null>;
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
  reserve: reserveUndo,
});

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

const isPlain = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Remove extra keys inside one restored object without replacing its unobserved ancestors. */
function replacementData(
  value: Record<string, unknown>,
  current: unknown,
): Record<string, unknown> {
  if (!isPlain(current)) return value;
  for (const [key, child] of Object.entries(value)) {
    if (isPlain(child)) value[key] = replacementData(child, current[key]);
  }
  for (const key of Object.keys(current)) {
    if (!Object.hasOwn(value, key)) value[`-=${key}`] = null;
  }
  return value;
}

/**
 * A minimal update restoring only the observed key paths to their values in the GM's snapshot.
 * Walking a path down the snapshot:
 * - a segment the snapshot lacks: the first missing key is removed (`-=key`);
 * - a value that is not an object (a primitive, null, an array) where the path goes deeper: the
 *   change turned it into an object, so the whole value at that ancestor is restored;
 * - otherwise the leaf is restored to its snapshot value.
 * Prototype-pollution segments are refused. A key whose ancestor is also restored is dropped.
 * With current source data, object-valued paths also remove later keys so recursive document
 * updates restore those objects exactly while preserving siblings outside the observed paths.
 */
export function minimalRestore(
  before: Record<string, unknown>,
  paths: readonly string[],
  current?: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const path of paths) {
    const segs = path.split('.');
    if (segs.some((s) => !s || s === '__proto__' || s === 'constructor' || s === 'prototype')) {
      continue;
    }
    let node: unknown = before;
    let done = false;
    for (let i = 0; i < segs.length && !done; i++) {
      const here = segs.slice(0, i + 1);
      if (!isPlain(node) || !Object.hasOwn(node, segs[i]!)) {
        out[[...segs.slice(0, i), `-=${segs[i]}`].join('.')] = null;
        done = true;
        break;
      }
      node = node[segs[i]!];
      if (i < segs.length - 1 && !isPlain(node)) {
        // Primitive, null or array in the snapshot, object now: restore the ancestor whole.
        out[here.join('.')] = JSON.parse(JSON.stringify(node ?? null));
        done = true;
      }
    }
    if (!done) out[path] = JSON.parse(JSON.stringify(node ?? null));
  }
  const keys = Object.keys(out);
  for (const k of keys) {
    const base = k.replace(/(^|\.)-=/, '$1');
    if (
      keys.some((o) => o !== k && !o.includes('-=') && (base === o || base.startsWith(`${o}.`)))
    ) {
      delete out[k];
    }
  }
  if (current) {
    for (const [path, value] of Object.entries(out)) {
      if (!isPlain(value)) continue;
      let now: unknown = current;
      for (const segment of path.split('.')) {
        now = isPlain(now) && Object.hasOwn(now, segment) ? now[segment] : undefined;
      }
      out[path] = replacementData(value, now);
    }
  }
  return out;
}

export function restoreData(before: Record<string, unknown>, doc: any): Record<string, unknown> {
  const skip = new Set([...NEVER_RESTORE, ...embeddedNames(doc)]);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(before)) if (!skip.has(k)) out[k] = v;
  return out;
}

function requireMutation(result: unknown): void {
  if (!result || (Array.isArray(result) && result.length === 0)) {
    throw new Error('Foundry refused the document mutation');
  }
}

async function recreate(target: AuditTarget, deps: UndoDeps): Promise<void> {
  const parts = target.uuid.split('.');
  const before = target.before!;
  if (parts.length <= 2) {
    if (!deps.canCreate(parts[0]!)) throw new Error('not permitted to create this document');
    const cls = getDocumentClass(parts[0]!);
    requireMutation(await cls.create(before, { keepId: true }));
    return;
  }
  const docName = parts[parts.length - 2]!;
  const parent = await deps.fromUuid(parts.slice(0, -2).join('.'));
  if (!parent) throw new Error('the parent document no longer exists');
  if (!deps.isGM()) throw new Error('only a GM may undo');
  if (isAuditDocument(parent)) throw new Error('the audit log cannot be changed by undo');
  if (!deps.canCreate(docName)) throw new Error('not permitted to create this document');
  if (!deps.canModify(parent, 'update')) throw new Error('not permitted to change the parent');
  const collection = Object.entries(parent.constructor?.metadata?.embedded ?? {}).find(
    ([name]) => name === docName,
  )?.[0];
  if (!collection) throw new Error(`cannot recreate a ${docName} here`);
  requireMutation(await parent.createEmbeddedDocuments(docName, [before], { keepId: true }));
}

/**
 * Undo one audit entry. Humans only: nothing here is a tool, and a non-GM is refused. Targets are
 * restored last to first. If any target changed since the call, nothing is touched until the GM
 * confirms. Changes during a confirmation require renewed confirmation before any restore.
 * A server reservation serializes callers across GM clients, through completion recording.
 * The entry is marked undone only when every restorable target succeeded.
 */
export async function undoEntry(
  page: any,
  confirm: UndoDeps['confirmConflicts'],
  overrides: Partial<UndoDeps> = {},
): Promise<UndoOutcome> {
  const deps = { ...defaultDeps(confirm), ...overrides };
  const out: UndoOutcome = { status: 'done', restored: 0, skipped: [], failed: [], conflicts: [] };
  const system = page?.system;
  // Undo applies only data this GM client captured or observed. A relayed record's own fields
  // view-only in the log, whatever its stored fields say.
  if (!deps.isGM() || !system || system.undoneAt) {
    return { ...out, status: 'refused' };
  }
  const key = String(page.id ?? system.entryId ?? '');
  if (inFlight.has(key)) return { ...out, status: 'busy' };
  inFlight.add(key);
  let reservation: UndoReservation | null = null;
  let outcome: UndoOutcome | undefined;
  try {
    try {
      reservation = await deps.reserve(page);
    } catch (err) {
      console.error('agent-gateway | could not reserve audit undo', err);
      outcome = { ...out, status: 'failed', failed: [String(page.uuid ?? key)] };
      return outcome;
    }
    if (!reservation) {
      outcome = { ...out, status: 'busy' };
      return outcome;
    }
    // Completion and targets come from a server read made while holding the reservation.
    // Another GM may have finished before this client's original page cache caught up.
    const fresh = reservation.page;
    const held = reservation;
    const guarded = { ...deps, isGM: () => deps.isGM() && held.isHeld() };
    if (!guarded.isGM() || !fresh.system || fresh.system.undoneAt) {
      outcome = { ...out, status: 'refused' };
      return outcome;
    }
    outcome = await run(page, fresh.system, guarded, out);
    return outcome;
  } finally {
    // Release only after all mutations and the completion write settle. An unexpected throw
    // leaves a reservation for human recovery instead of permitting a potentially duplicate undo.
    if (reservation && outcome) {
      try {
        await reservation.release();
      } catch (err) {
        console.error('agent-gateway | could not release audit undo reservation', err);
        outcome.status = 'failed';
        outcome.failed.push(String(page.uuid ?? key));
      }
    }
    inFlight.delete(key);
  }
}

async function run(page: any, system: any, deps: UndoDeps, out: UndoOutcome): Promise<UndoOutcome> {
  const completed = new Set<string>(system.undoCompleted ?? []);
  const targets: AuditTarget[] = ([...(system.targets ?? [])] as StoredTarget[])
    .filter((t) => !completed.has(t.uuid))
    .map((t) => ({ ...t, before: decodeBefore(t) }))
    .reverse();
  // A target that should restore but has no readable snapshot cannot be restored.
  for (const t of targets) {
    if (t.existed && t.before === null && t.undoable) {
      t.undoable = false;
      t.note ||= 'no readable snapshot';
    }
  }
  type Step = { target: AuditTarget; doc: any; modifiedTime: number | null };
  let resolutionFailed = false;
  const resolveStep = async (t: AuditTarget): Promise<Step | null> => {
    // A relayed record's update is restorable only for the paths this GM client observed.
    const unobserved =
      system.relayed === true && t.existed && t.existsAfter && (t.changedPaths ?? []).length === 0;
    if (!t.undoable || unobserved || !undoClasses(t.uuid)) {
      if (!out.skipped.includes(t.uuid)) out.skipped.push(t.uuid);
      return null;
    }
    let doc: any;
    try {
      doc = await deps.fromUuid(t.uuid);
    } catch (err) {
      // A failed read proves nothing about existence: never recreate or skip deletion on that basis.
      console.error(`agent-gateway | undo lookup failed for ${t.uuid}`, err);
      if (!out.failed.includes(t.uuid)) out.failed.push(t.uuid);
      resolutionFailed = true;
      return null;
    }
    if (doc && isAuditDocument(doc)) {
      if (!out.skipped.includes(t.uuid)) out.skipped.push(t.uuid);
      return null;
    }
    // Foundry documents are mutable: save the version before awaiting a human or another mutation.
    const modifiedTime = Number(doc?._stats?.modifiedTime);
    return { target: t, doc, modifiedTime: Number.isFinite(modifiedTime) ? modifiedTime : null };
  };
  const resolvePlan = async (remaining: AuditTarget[]): Promise<Step[]> => {
    const plan: Step[] = [];
    for (const target of remaining) {
      const step = await resolveStep(target);
      if (step) plan.push(step);
    }
    return plan;
  };
  const differs = (old: Step | undefined, step: Step): boolean =>
    !old || old.doc !== step.doc || old.modifiedTime !== step.modifiedTime;
  const conflictsFor = (plan: Step[], changed = new Set<string>()): Conflict[] =>
    plan.flatMap(
      ({ target, doc }) =>
        conflictFor(target, doc) ??
        (changed.has(target.uuid) ? [{ uuid: target.uuid, reason: 'modified' as const }] : []),
    );
  const confirmPlan = async (plan: Step[], conflicts: Conflict[]): Promise<Step[] | null> => {
    while (conflicts.length) {
      out.conflicts = conflicts;
      if (!(await deps.confirmConflicts(conflicts))) {
        out.status = 'cancelled';
        return null;
      }
      if (!deps.isGM() || system.undoneAt) {
        out.status = 'refused';
        return null;
      }
      const previous = new Map(plan.map((step) => [step.target.uuid, step]));
      plan = await resolvePlan(plan.map((step) => step.target));
      if (resolutionFailed) {
        out.status = 'failed';
        return null;
      }
      const changed = new Set(
        plan
          .filter((step) => differs(previous.get(step.target.uuid), step))
          .map((step) => step.target.uuid),
      );
      if (!changed.size) break;
      // Confirmation covers these document versions, never changes made while the dialog was open.
      conflicts = conflictsFor(plan, changed);
    }
    return plan;
  };
  let plan = await resolvePlan(targets);
  if (resolutionFailed) return { ...out, status: 'failed' };
  const confirmed = await confirmPlan(plan, conflictsFor(plan));
  if (!confirmed) return out;
  plan = confirmed;
  while (plan.length) {
    const expected = plan[0]!;
    // Every earlier mutation yields to other clients. Resolve this target immediately before
    // its mutation, using the exact version approved above (or initially found conflict-free).
    const step = await resolveStep(expected.target);
    if (resolutionFailed) return { ...out, status: 'failed' };
    if (!step) {
      plan.shift();
      continue;
    }
    if (differs(expected, step)) {
      plan[0] = step;
      const renewed = await confirmPlan(plan, conflictsFor(plan, new Set([step.target.uuid])));
      if (!renewed) return out;
      plan = renewed;
      continue;
    }
    if (!deps.isGM() || system.undoneAt) return { ...out, status: 'refused' };
    const { target, doc } = step;
    try {
      if (!target.existed) {
        if (doc) {
          if (!deps.canModify(doc, 'delete')) throw new Error('not permitted to delete');
          requireMutation(await doc.delete());
        }
      } else if (doc) {
        if (!deps.canModify(doc, 'update')) throw new Error('not permitted to update');
        if (target.changedPaths.length) {
          // Observed by this GM client: restore just those paths from the GM's own snapshot.
          requireMutation(
            await doc.update(minimalRestore(target.before!, target.changedPaths, doc.toObject()), {
              diff: false,
            }),
          );
        } else {
          requireMutation(
            await doc.update(restoreData(target.before!, doc), { diff: false, recursive: false }),
          );
        }
      } else {
        await recreate(target, deps);
      }
    } catch (err) {
      console.error(`agent-gateway | undo failed for ${target.uuid}`, err);
      out.failed.push(target.uuid);
      plan.shift();
      continue;
    }
    out.restored += 1;
    completed.add(target.uuid);
    if (!deps.isGM()) throw new Error('undo authority lost before progress could be saved');
    // Persist progress while holding the reservation. An uncertain/vetoed write must
    // escape run(), retaining the reservation so another client cannot repeat this mutation.
    requireMutation(await page.update({ 'system.undoCompleted': [...completed] }));
    plan.shift();
  }
  if (out.failed.length) return { ...out, status: 'failed' };
  if (!deps.isGM() || system.undoneAt) return { ...out, status: 'refused' };
  requireMutation(
    await page.update({ 'system.undoneAt': deps.now(), 'system.undoneBy': deps.userId() }),
  );
  return out;
}
