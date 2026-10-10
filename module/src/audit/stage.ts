/* eslint-disable @typescript-eslint/no-explicit-any */
import { TOOLS } from '@agent-gateway/protocol';
import { fromUuidCompat } from '../compat/index.js';
import type { Stage } from '../ops/stages.js';
import { isOpError, type DispatchResult, type OpContext } from '../ops/types.js';
import { assertNotAudit } from './guard.js';
import { requestAuditIntent, submitAudit } from './sink.js';
import { boundedJson, jsonSize, newEntryId, safeText } from './record.js';
import {
  AUDIT_LIMITS as L,
  type AuditCategory,
  type AuditRecord,
  type AuditTarget,
} from './types.js';

declare module '../ops/types.js' {
  interface OpContext {
    /**
     * Record the document as it is now, before the handler changes it. Present only on calls the
     * audit stage records (writes, destructive and code calls). Call it for every document the
     * handler will update or delete, before touching it. The first snapshot of a uuid wins.
     */
    snapshot?(uuid: string): Promise<void>;
    /** Record a document the handler created, after creating it. Undo deletes it. */
    created?(uuid: string, parent?: unknown): Promise<void>;
    /**
     * Declare, before the handler creates anything, that this call will create documents. On a
     * player's client this is how the GM client learns to watch for the creation. Pass the parent
     * document (or its uuid) the new documents will go into; the audit log is refused.
     */
    intendCreate?(parent?: unknown): Promise<void>;
    /** The id of this audited call (also its audit entry id). */
    callId?: string;
    /**
     * Pass as the operation options of every create, update and delete the handler makes
     * (`{...ctx.callOptions, ...other}`). A GM client uses it only to correlate a document hook
     * with this call; trust comes from the hook's server-set user id.
     */
    callOptions?: { agentGateway: { callId: string } };
  }
}

export const AUDIT_STAGE_ORDER = 40;

export interface AuditStageDeps {
  /** Category of a tool by name; `read` is never recorded. */
  categoryOf(tool: string): string | undefined;
  fromUuid(uuid: string): Promise<any>;
  /** Hand the finished record to the journal (GM client) or the relay (player client). */
  submit(record: AuditRecord): Promise<void>;
  /** This client belongs to a GM, so it captures and undoes with its own data. */
  isGM(): boolean;
  /** Player client: tell the active GM what the call will touch and wait for it to be copied. */
  requestIntent(callId: string, what: { uuid?: string; creates?: boolean }): Promise<boolean>;
  now(): number;
  newId(): string;
}

const defaultDeps: AuditStageDeps = {
  categoryOf: (tool) => TOOLS.find((t) => t.name === tool)?.category,
  fromUuid: (uuid) => fromUuidCompat(uuid),
  submit: submitAudit,
  isGM: () => (globalThis as { game?: { user?: { isGM?: boolean } } }).game?.user?.isGM === true,
  requestIntent: (callId, what) => requestAuditIntent(callId, what),
  now: () => Date.now(),
  newId: newEntryId,
};

/** Which documents a call touched, and what each looked like before. */
class Snapshots {
  private readonly pending = new Map<string, Promise<AuditTarget | null>>();
  private chars = 0;
  dropped = 0;
  /** Set on a player's client: declarations go to the GM, which captures the data itself. */
  witnessed: ((what: { uuid?: string; creates?: boolean }) => Promise<boolean>) | null = null;
  private createsDeclared = false;
  constructor(private readonly fromUuid: AuditStageDeps['fromUuid']) {}

  /** Refuse a parent that is, or sits inside, the audit log. A uuid is looked up first. */
  private async guardParent(parent: unknown): Promise<void> {
    const doc = typeof parent === 'string' ? await this.lookup(parent) : parent;
    if (doc) assertNotAudit(doc);
  }

  async intendCreate(parent?: unknown): Promise<void> {
    await this.guardParent(parent);
    if (!this.witnessed || this.createsDeclared) return;
    this.createsDeclared = true;
    await this.witnessed({ creates: true });
  }

  private async lookup(uuid: string): Promise<any> {
    try {
      return await this.fromUuid(uuid);
    } catch {
      return null;
    }
  }

  snapshot(uuid: string): Promise<void> {
    return this.add(uuid, async () => {
      const doc = await this.lookup(uuid);
      if (this.witnessed) {
        // A player's snapshot is never used: the GM client copies the document from its own data.
        if (doc) assertNotAudit(doc);
        await this.witnessed({ uuid });
        return viewOnlyTarget(uuid);
      }
      // The write-side guard: a handler cannot snapshot (so cannot change) the audit log.
      if (doc) assertNotAudit(doc);
      if (!doc) return blank(uuid, false);
      let before: Record<string, unknown> | null = null;
      let note = '';
      try {
        before = doc.toObject();
      } catch {
        note = 'snapshot failed';
      }
      const size = before ? jsonSize(before) : 0;
      if (before && (size > L.beforeChars || size > L.beforeTotalChars - this.chars)) {
        before = null;
        note = 'snapshot too large to keep';
      } else this.chars += size;
      return { ...blank(uuid, true), before, undoable: before !== null, note };
    });
  }

  async created(uuid: string, parent?: unknown): Promise<void> {
    await this.guardParent(parent);
    const made = await this.lookup(uuid);
    if (made) assertNotAudit(made);
    if (this.witnessed) return this.add(uuid, async () => viewOnlyTarget(uuid));
    return this.add(uuid, async () => blank(uuid, false));
  }

  private async add(uuid: string, make: () => Promise<AuditTarget>): Promise<void> {
    if (typeof uuid !== 'string' || uuid === '' || this.pending.has(uuid)) return;
    if (this.pending.size >= L.targets) {
      this.dropped += 1;
      return;
    }
    const p = make().then((t) => {
      // Compendium documents are not restored by undo.
      if (uuid.startsWith('Compendium.')) {
        t.undoable = false;
        t.note ||= 'compendium documents are not undone';
      }
      return t;
    });
    this.pending.set(uuid, p);
    await p;
  }

  /** Targets with their after state, read once the handler has finished. */
  async finish(): Promise<AuditTarget[]> {
    const out: AuditTarget[] = [];
    for (const p of this.pending.values()) {
      const t = await p.catch(() => null);
      if (!t) continue;
      if (this.witnessed) {
        out.push(t);
        continue;
      }
      const doc = await this.lookup(t.uuid);
      const mod = Number(doc?._stats?.modifiedTime);
      out.push({
        ...t,
        existsAfter: !!doc,
        afterModifiedTime: doc && Number.isFinite(mod) ? mod : null,
      });
    }
    return out;
  }
}

/** A target a player's client names; the GM's own capture decides whether it can be undone. */
function viewOnlyTarget(uuid: string): AuditTarget {
  return { ...blank(uuid, false), undoable: false };
}

function blank(uuid: string, existed: boolean): AuditTarget {
  return {
    uuid,
    existed,
    before: null,
    existsAfter: false,
    afterModifiedTime: null,
    undoable: true,
    changedPaths: [],
    note: '',
  };
}

function summarise(
  res: DispatchResult | undefined,
  thrown: boolean,
): { text: string; ok: boolean } {
  if (thrown || !res) return { text: 'the handler threw', ok: false };
  if (isOpError(res)) return { text: `${res.error.code}: ${res.error.message}`, ok: false };
  return { text: String(res.text ?? '').split('\n')[0] ?? '', ok: true };
}

/**
 * Records every call that is not a read: who, which agent, which tool, the args and a before
 * snapshot of each document the handler declared through `ctx.snapshot`. Reads are never recorded:
 * they have nothing to undo, and logging each one would bury the writes. The record is written
 * after the handler, so the after-state is known; a failure to record is logged, never thrown,
 * because the change has already happened.
 */
export function createAuditStage(overrides: Partial<AuditStageDeps> = {}): Stage {
  const deps = { ...defaultDeps, ...overrides };
  return {
    name: 'audit',
    order: AUDIT_STAGE_ORDER,
    async run(ctx: OpContext, next) {
      const category = deps.categoryOf(ctx.tool);
      if (category === 'read') return next();
      const snaps = new Snapshots(deps.fromUuid);
      const callId = deps.newId();
      if (!deps.isGM()) snaps.witnessed = (what) => deps.requestIntent(callId, what);
      ctx.callId = callId;
      ctx.callOptions = { agentGateway: { callId } };
      ctx.snapshot = (uuid) => snaps.snapshot(uuid);
      ctx.created = (uuid, parent) => snaps.created(uuid, parent);
      ctx.intendCreate = (parent) => snaps.intendCreate(parent);
      let res: DispatchResult | undefined;
      let thrown = false;
      try {
        res = await next();
        return res;
      } catch (err) {
        thrown = true;
        throw err;
      } finally {
        await record(ctx, category, snaps, summarise(res, thrown), deps, callId);
      }
    },
  };
}

async function record(
  ctx: OpContext,
  category: string | undefined,
  snaps: Snapshots,
  outcome: { text: string; ok: boolean },
  deps: AuditStageDeps,
  callId: string,
): Promise<void> {
  try {
    const args = boundedJson(ctx.args);
    const cat = (
      category === 'destructive' || category === 'code' ? category : 'write'
    ) as AuditCategory;
    await deps.submit({
      entryId: callId,
      timestamp: deps.now(),
      userId: ctx.user.id,
      agentId: safeText(ctx.agent.id),
      tool: safeText(ctx.tool),
      category: cat,
      args: args.text,
      argsTruncated: args.truncated,
      targets: await snaps.finish(),
      targetsDropped: snaps.dropped,
      result: safeText(outcome.text, L.result),
      status: outcome.ok ? 'ok' : 'error',
      relayed: false,
    });
  } catch (err) {
    console.error('agent-gateway | audit record failed', err);
  }
}

export const auditStage: Stage = createAuditStage();
