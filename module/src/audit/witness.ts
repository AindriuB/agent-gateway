/* eslint-disable @typescript-eslint/no-explicit-any */
import { jsonSize } from './record.js';
import { AUDIT_LIMITS as L, type AuditRecord, type AuditTarget } from './types.js';
import { undoClasses, UNDO_CLASSES, UNDO_EMBEDDED } from './undo-classes.js';
import { assertNotAudit } from './guard.js';

const UUID_OK = /^[A-Za-z0-9_.-]+$/;
const BAD_SEGMENT = new Set(['__proto__', 'constructor', 'prototype']);

export const NOT_WITNESSED_NOTE = 'no GM online to witness';
export const NOT_OBSERVED_NOTE = 'change not observed by a GM';

export interface IntentMessage {
  kind: 'audit.intent';
  callId: string;
  /** A document the call will update or delete. */
  uuid?: string;
  /** The call may create documents. */
  creates?: boolean;
}

interface Snap {
  existed: boolean;
  /** The GM client's own copy of the document, before the call. Never data from the player. */
  before: Record<string, unknown> | null;
}

type Observed =
  | { kind: 'update'; uuid: string; paths: string[]; modifiedTime: number | null }
  | { kind: 'delete'; uuid: string }
  | { kind: 'create'; uuid: string; modifiedTime: number | null };

interface Call {
  sender: string;
  callId: string;
  openedAt: number;
  creates: boolean;
  snaps: Map<string, Snap>;
  chars: number;
  observed: Observed[];
}

export interface WitnessDeps {
  fromUuid(uuid: string): Promise<any>;
  now(): number;
  /** Wait before assembling a record, so hook events that trail the player's message are seen. */
  grace(): Promise<void>;
}

/** Flatten a hook `change` diff to the key paths it set. `-=k` and `==k` forms name the key `k`. */
export function changedKeyPaths(change: unknown): string[] {
  const out: string[] = [];
  const stack: Array<[unknown, string[]]> = [[change, []]];
  while (stack.length && out.length < L.changedPaths) {
    const [node, path] = stack.pop()!;
    if (node && typeof node === 'object' && !Array.isArray(node)) {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        if (path.length === 0 && (k === '_id' || k === '_stats')) continue;
        const key = k.replace(/^(-=|==)/, '');
        if (!key || BAD_SEGMENT.has(key)) continue;
        const marker = k !== key;
        if (!marker && v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length) {
          stack.push([v, [...path, key]]);
        } else out.push([...path, key].join('.'));
      }
    } else if (path.length) out.push(path.join('.'));
  }
  return [...new Set(out.map((p) => p.slice(0, L.changedPath)))].slice(0, L.changedPaths);
}

/**
 * Runs on the active GM's client. A player's agent declares what it will touch (the intent); the
 * GM client copies those documents from its OWN world data, then watches Foundry's document hooks.
 * A change counts only when the hook's `userId` (server-set) is the intent's sender and the uuid
 * was declared. Undo later uses only what this class captured, never a field the player sent.
 */
export class AuditWitness {
  private readonly calls = new Map<string, Call>();
  constructor(private readonly deps: WitnessDeps) {}

  private key(sender: string, callId: string): string {
    return `${sender}\u0000${callId}`;
  }

  private sweep(): void {
    const now = this.deps.now();
    for (const [k, c] of this.calls) if (now - c.openedAt > L.callTtlMs) this.calls.delete(k);
  }

  /** Handle an intent from `sender` (the attested socket user). Resolves whether it was witnessed. */
  async onIntent(msg: unknown, sender: string): Promise<boolean> {
    const m = msg as Partial<IntentMessage>;
    const callId = typeof m.callId === 'string' ? m.callId : '';
    if (!/^[A-Za-z0-9_-]{8,40}$/.test(callId)) return false;
    this.sweep();
    const k = this.key(sender, callId);
    let call = this.calls.get(k);
    if (!call) {
      const open = [...this.calls.values()].filter((c) => c.sender === sender).length;
      if (open >= L.openCalls) return false;
      call = {
        sender,
        callId,
        openedAt: this.deps.now(),
        creates: false,
        snaps: new Map(),
        chars: 0,
        observed: [],
      };
      this.calls.set(k, call);
    }
    if (m.creates === true) call.creates = true;
    const uuid = typeof m.uuid === 'string' ? m.uuid : '';
    if (!uuid) return m.creates === true;
    if (uuid.length > L.uuid || !UUID_OK.test(uuid) || !undoClasses(uuid)) return false;
    if (call.snaps.has(uuid)) return true;
    if (call.snaps.size >= L.callUuids) return false;
    let doc: any = null;
    try {
      doc = await this.deps.fromUuid(uuid);
    } catch {
      doc = null;
    }
    if (doc) {
      try {
        assertNotAudit(doc);
      } catch {
        return false;
      }
    }
    let before: Record<string, unknown> | null = null;
    if (doc) {
      try {
        before = doc.toObject();
      } catch {
        return false;
      }
      const size = jsonSize(before);
      if (size > L.beforeChars || call.chars + size > L.beforeTotalChars) return false;
      call.chars += size;
    }
    call.snaps.set(uuid, { existed: !!doc, before });
    return true;
  }

  private callFor(userId: unknown, options: any): Call | null {
    const id = options?.agentGateway?.callId;
    if (typeof userId !== 'string' || typeof id !== 'string') return null;
    return this.calls.get(this.key(userId, id)) ?? null;
  }

  private push(call: Call, o: Observed): void {
    if (call.observed.length < L.observed) call.observed.push(o);
  }

  /** `updateX(document, change, options, userId)` */
  onUpdate(doc: any, change: unknown, options: any, userId: unknown): void {
    const call = this.callFor(userId, options);
    const uuid = String(doc?.uuid ?? '');
    const snap = call?.snaps.get(uuid);
    if (!call || !snap?.existed) return;
    const paths = changedKeyPaths(change);
    const mt = Number(doc?._stats?.modifiedTime);
    this.push(call, { kind: 'update', uuid, paths, modifiedTime: Number.isFinite(mt) ? mt : null });
  }

  /** `deleteX(document, options, userId)` */
  onDelete(doc: any, options: any, userId: unknown): void {
    const call = this.callFor(userId, options);
    const uuid = String(doc?.uuid ?? '');
    if (!call || !call.snaps.get(uuid)?.existed) return;
    this.push(call, { kind: 'delete', uuid });
  }

  /** `createX(document, options, userId)`: counts only if the server-set creator is the sender too. */
  onCreate(doc: any, options: any, userId: unknown): void {
    const call = this.callFor(userId, options);
    if (!call?.creates) return;
    if (doc?._stats?.createdBy !== call.sender) return;
    const uuid = String(doc?.uuid ?? '');
    if (!uuid || !undoClasses(uuid)) return;
    const mt = Number(doc?._stats?.modifiedTime);
    this.push(call, { kind: 'create', uuid, modifiedTime: Number.isFinite(mt) ? mt : null });
  }

  /**
   * The record to write for a call a player's agent made. The player's record supplies display
   * fields only. Targets come from what this GM client captured and observed; anything else the
   * player named is listed as view-only.
   */
  async assemble(record: AuditRecord, sender: string): Promise<AuditRecord> {
    await this.deps.grace();
    const call = this.calls.get(this.key(sender, record.entryId));
    const claimed = record.targets;
    if (!call) {
      return {
        ...record,
        targets: claimed.map((t) => viewOnly(t, NOT_WITNESSED_NOTE)),
      };
    }
    this.calls.delete(this.key(sender, record.entryId));
    const targets: AuditTarget[] = [];
    const done = new Set<string>();
    const byUuid = new Map<string, Observed[]>();
    for (const o of call.observed) byUuid.set(o.uuid, [...(byUuid.get(o.uuid) ?? []), o]);
    for (const [uuid, obs] of byUuid) {
      const snap = call.snaps.get(uuid);
      const created = obs.find((o) => o.kind === 'create');
      if (created && created.kind === 'create') {
        targets.push({
          uuid,
          existed: false,
          before: null,
          existsAfter: true,
          afterModifiedTime: created.modifiedTime,
          undoable: true,
          changedPaths: [],
          note: '',
        });
      } else if (snap?.existed && snap.before) {
        const deleted = obs.some((o) => o.kind === 'delete');
        const paths = [...new Set(obs.flatMap((o) => (o.kind === 'update' ? o.paths : [])))].slice(
          0,
          L.changedPaths,
        );
        const last = [...obs].reverse().find((o) => o.kind === 'update');
        const updates = !deleted && paths.length > 0;
        targets.push({
          uuid,
          existed: true,
          before: snap.before,
          existsAfter: !deleted,
          afterModifiedTime: last && last.kind === 'update' ? last.modifiedTime : null,
          undoable: deleted || updates,
          changedPaths: deleted ? [] : paths,
          note: deleted || updates ? '' : NOT_OBSERVED_NOTE,
        });
      } else continue;
      done.add(uuid);
    }
    for (const t of claimed) {
      if (!done.has(t.uuid)) targets.push(viewOnly(t, NOT_OBSERVED_NOTE));
    }
    return { ...record, targets: targets.slice(0, L.targets) };
  }
}

const viewOnly = (t: AuditTarget, note: string): AuditTarget => ({
  uuid: t.uuid,
  existed: false,
  before: null,
  existsAfter: false,
  afterModifiedTime: null,
  undoable: false,
  changedPaths: [],
  note,
});

/** Document names whose hooks the witness listens to: every class undo may touch. */
export const WITNESSED_NAMES: readonly string[] = [...new Set([...UNDO_CLASSES, ...UNDO_EMBEDDED])];

/** Register the create, update and delete hooks. `active()` says whether this client is the witness. */
export function installWitnessHooks(
  hooks: { on(name: string, fn: (...a: any[]) => void): unknown },
  witness: AuditWitness,
  active: () => boolean,
): void {
  for (const n of WITNESSED_NAMES) {
    hooks.on(
      `create${n}`,
      (doc, options, userId) => active() && witness.onCreate(doc, options, userId),
    );
    hooks.on(
      `update${n}`,
      (doc, change, options, userId) => active() && witness.onUpdate(doc, change, options, userId),
    );
    hooks.on(
      `delete${n}`,
      (doc, options, userId) => active() && witness.onDelete(doc, options, userId),
    );
  }
}
