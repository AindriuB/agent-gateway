/* eslint-disable @typescript-eslint/no-explicit-any */
import { TOOLS } from '@agent-gateway/protocol';
import { fromUuidCompat } from '../compat/index.js';
import type { Stage } from '../ops/stages.js';
import { isOpError, type DispatchResult, type OpContext } from '../ops/types.js';
import { submitAudit } from './sink.js';
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
    created?(uuid: string): Promise<void>;
  }
}

export const AUDIT_STAGE_ORDER = 40;

export interface AuditStageDeps {
  /** Category of a tool by name; `read` is never recorded. */
  categoryOf(tool: string): string | undefined;
  fromUuid(uuid: string): Promise<any>;
  /** Hand the finished record to the journal (GM client) or the relay (player client). */
  submit(record: AuditRecord): Promise<void>;
  now(): number;
  newId(): string;
}

const defaultDeps: AuditStageDeps = {
  categoryOf: (tool) => TOOLS.find((t) => t.name === tool)?.category,
  fromUuid: (uuid) => fromUuidCompat(uuid),
  submit: submitAudit,
  now: () => Date.now(),
  newId: newEntryId,
};

/** Which documents a call touched, and what each looked like before. */
class Snapshots {
  private readonly pending = new Map<string, Promise<AuditTarget | null>>();
  private chars = 0;
  dropped = 0;
  constructor(private readonly fromUuid: AuditStageDeps['fromUuid']) {}

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

  created(uuid: string): Promise<void> {
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

function blank(uuid: string, existed: boolean): AuditTarget {
  return {
    uuid,
    existed,
    before: null,
    existsAfter: false,
    afterModifiedTime: null,
    undoable: true,
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
      ctx.snapshot = (uuid) => snaps.snapshot(uuid);
      ctx.created = (uuid) => snaps.created(uuid);
      let res: DispatchResult | undefined;
      let thrown = false;
      try {
        res = await next();
        return res;
      } catch (err) {
        thrown = true;
        throw err;
      } finally {
        await record(ctx, category, snaps, summarise(res, thrown), deps);
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
): Promise<void> {
  try {
    const args = boundedJson(ctx.args);
    const cat = (
      category === 'destructive' || category === 'code' ? category : 'write'
    ) as AuditCategory;
    await deps.submit({
      entryId: deps.newId(),
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
