/* eslint-disable @typescript-eslint/no-explicit-any */
import { jsonSize, safeText } from './record.js';
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
  | {
      kind: 'update';
      uuid: string;
      paths: string[];
      complete: boolean;
      modifiedTime: number | null;
    }
  | { kind: 'delete'; uuid: string }
  | { kind: 'create'; uuid: string; modifiedTime: number | null };

interface Call {
  sender: string;
  callId: string;
  openedAt: number;
  creates: boolean;
  snaps: Map<string, Snap>;
  /** Bytes held: snapshots, plus a count for every stored observation. */
  bytes: number;
  observed: Observed[];
  /** uuid to the user who changed or deleted it outside this call after the intent. */
  stale: Map<string, string>;
  /** A memory cap was hit: nothing more is recorded and nothing in the call is undoable. */
  capped: boolean;
}

export interface WitnessDeps {
  fromUuid(uuid: string): Promise<any>;
  now(): number;
  /** Wait before assembling a record, so hook events that trail the player's message are seen. */
  grace(): Promise<void>;
  /** Run `fn` every `ms` until the returned function is called. Optional: tests drive `sweep` directly. */
  every?(fn: () => void, ms: number): () => void;
}

export const EXPIRED_NOTE = 'the witness record expired';
export const CAPPED_NOTE = 'witness memory limit reached';
export const RECREATED_NOTE = 'deleted and recreated in one call';
export const PATH_LIMIT_NOTE = 'changed key paths exceed the capture limit';

/** Enumerate own entries without materialising an unbounded list of leaves or sibling nodes. */
function* changeEntries(node: Record<string, unknown>): Generator<[string, unknown]> {
  for (const key in node) if (Object.hasOwn(node, key)) yield [key, node[key]];
}

/** Flatten a hook diff completely, or throw if a path or the distinct-path count cannot fit. */
export function changedKeyPaths(change: unknown, recursive = true): string[] {
  if (!change || typeof change !== 'object' || Array.isArray(change)) return [];
  const out = new Set<string>();
  const stack = [
    { entries: changeEntries(change as Record<string, unknown>), path: '', visited: false },
  ];
  const add = (path: string) => {
    if (path.length > L.changedPath) throw new Error(PATH_LIMIT_NOTE);
    out.add(path);
    if (out.size > L.changedPaths) throw new Error(PATH_LIMIT_NOTE);
  };
  while (stack.length) {
    const frame = stack[stack.length - 1]!;
    const next = frame.entries.next();
    if (next.done) {
      stack.pop();
      if (!frame.visited && frame.path) add(frame.path);
      continue;
    }
    frame.visited = true;
    const [k, value] = next.value;
    const rawParts = k.split('.');
    const operator = rawParts.findIndex((segment) => /^(?:-=|==)/.test(segment));
    const parts = rawParts.map((segment) => segment.replace(/^(-=|==)/, ''));
    if (parts.some((segment) => !segment || BAD_SEGMENT.has(segment))) continue;
    if (!frame.path && (parts[0] === '_id' || parts[0] === '_stats')) continue;
    // A replacement/deletion changes its entire ancestor, including omitted sibling keys.
    const key = parts.slice(0, operator < 0 ? parts.length : operator + 1).join('.');
    // Non-recursive updates replace entire root objects after dotted paths are expanded.
    if (!recursive) {
      add(parts[0]!);
      continue;
    }
    const path = frame.path ? `${frame.path}.${key}` : key;
    if (path.length > L.changedPath) throw new Error(PATH_LIMIT_NOTE);
    if (k === key && value && typeof value === 'object' && !Array.isArray(value)) {
      stack.push({
        entries: changeEntries(value as Record<string, unknown>),
        path,
        visited: false,
      });
    } else add(path);
  }
  return [...out];
}

/**
 * Runs on the active GM's client. A player's agent declares what it will touch (the intent); the
 * GM client copies those documents from its OWN world data, then watches Foundry's document hooks.
 * A change counts only when the hook's `userId` (server-set) is the intent's sender and the uuid
 * was declared. Undo later uses only what this class captured, never a field the player sent.
 */
export class AuditWitness {
  private readonly calls = new Map<string, Call>();
  private stopSweep: (() => void) | null = null;
  constructor(private readonly deps: WitnessDeps) {}

  private key(sender: string, callId: string): string {
    return `${sender}\u0000${callId}`;
  }

  private expired(c: Call): boolean {
    return this.deps.now() - c.openedAt > L.callTtlMs;
  }

  /** Free every expired call. Runs on a timer (see `start`) and before each new intent. */
  sweep(): void {
    for (const [k, c] of this.calls) if (this.expired(c)) this.calls.delete(k);
  }

  /** Start the periodic sweep. */
  start(): void {
    this.stopSweep ??= this.deps.every?.(() => this.sweep(), L.sweepMs) ?? null;
  }

  /** Stop the sweep timer and drop everything held. */
  stop(): void {
    this.stopSweep?.();
    this.stopSweep = null;
    this.calls.clear();
  }

  /** Release witness state only after its assembled record has been persisted. */
  complete(entryId: string, sender: string): void {
    this.calls.delete(this.key(sender, entryId));
  }

  /** Number of open calls (for tests and diagnostics). */
  get open(): number {
    return this.calls.size;
  }

  private bytesFor(sender?: string): number {
    let n = 0;
    for (const c of this.calls.values()) if (!sender || c.sender === sender) n += c.bytes;
    return n;
  }

  /** Add to a call's byte count; on exceeding a cap the call is capped and nothing more is kept. */
  private charge(call: Call, n: number): boolean {
    if (call.capped) return false;
    if (
      this.bytesFor(call.sender) + n > L.witnessSenderBytes ||
      this.bytesFor() + n > L.witnessTotalBytes
    ) {
      call.capped = true;
      call.snaps.clear();
      call.observed = [];
      call.bytes = 0;
      return false;
    }
    call.bytes += n;
    return true;
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
        bytes: 0,
        observed: [],
        stale: new Map(),
        capped: false,
      };
      this.calls.set(k, call);
    }
    if (call.capped) return false;
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
      return false;
    }
    if (doc) {
      try {
        assertNotAudit(doc);
      } catch {
        return false;
      }
    }
    let before: Record<string, unknown> | null = null;
    let size = uuid.length;
    if (doc) {
      try {
        before = doc.toObject();
      } catch {
        return false;
      }
      size += jsonSize(before);
      if (size > L.beforeChars + L.uuid) return false;
      if (call.bytes + size > L.beforeTotalChars) return false;
    }
    if (!this.charge(call, size)) return false;
    call.snaps.set(uuid, { existed: !!doc, before });
    return true;
  }

  private live(userId: unknown, options: any): Call | null {
    const id = options?.agentGateway?.callId;
    if (typeof userId !== 'string' || typeof id !== 'string') return null;
    const call = this.calls.get(this.key(userId, id)) ?? null;
    if (!call) return null;
    if (this.expired(call)) {
      this.calls.delete(this.key(userId, id));
      return null;
    }
    return call.capped ? null : call;
  }

  private push(call: Call, o: Observed): void {
    const cost =
      100 + (o.kind === 'update' ? o.paths.reduce((n, p) => n + p.length, 0) : o.uuid.length);
    if (call.observed.length >= L.observed || !this.charge(call, cost)) {
      if (!call.capped) call.capped = true;
      return;
    }
    call.observed.push(o);
  }

  /**
   * A change to a snapshotted document that is not part of the call (another user, or the sender
   * outside it) makes that snapshot stale: it no longer describes what was there before the call.
   */
  private intervene(uuid: string, userId: unknown, options: any): void {
    for (const call of this.calls.values()) {
      if (call.capped || this.expired(call) || !call.snaps.get(uuid)?.existed) continue;
      const mine = call.sender === userId && options?.agentGateway?.callId === call.callId;
      if (!mine && !call.stale.has(uuid)) call.stale.set(uuid, String(userId ?? 'unknown'));
    }
  }

  /** `updateX(document, change, options, userId)` */
  onUpdate(doc: any, change: unknown, options: any, userId: unknown): void {
    const uuid = String(doc?.uuid ?? '');
    this.intervene(uuid, userId, options);
    const call = this.live(userId, options);
    const snap = call?.snaps.get(uuid);
    if (!call || !snap?.existed) return;
    let paths: string[] = [];
    let complete = true;
    try {
      paths = changedKeyPaths(change, options?.recursive !== false);
    } catch {
      // A partial diff cannot support undo; retain the observation only to refuse it explicitly.
      complete = false;
    }
    const mt = Number(doc?._stats?.modifiedTime);
    this.push(call, {
      kind: 'update',
      uuid,
      paths,
      complete,
      modifiedTime: Number.isFinite(mt) ? mt : null,
    });
  }

  /** `deleteX(document, options, userId)` */
  onDelete(doc: any, options: any, userId: unknown): void {
    const uuid = String(doc?.uuid ?? '');
    this.intervene(uuid, userId, options);
    const call = this.live(userId, options);
    if (!call || !call.snaps.get(uuid)?.existed) return;
    this.push(call, { kind: 'delete', uuid });
  }

  /** `createX(document, options, userId)`: counts only if the server-set creator is the sender too. */
  onCreate(doc: any, options: any, userId: unknown): void {
    const call = this.live(userId, options);
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
    const k = this.key(sender, record.entryId);
    const call = this.calls.get(k);
    const claimed = record.targets;
    if (!call) {
      return { ...record, targets: claimed.map((t) => viewOnly(t, NOT_WITNESSED_NOTE)) };
    }
    // Keep this capture for retries until persistence succeeds (or the normal TTL expires).
    if (this.expired(call)) {
      return { ...record, targets: claimed.map((t) => viewOnly(t, EXPIRED_NOTE)) };
    }
    if (call.capped) {
      return { ...record, targets: claimed.map((t) => viewOnly(t, CAPPED_NOTE)) };
    }
    const targets: AuditTarget[] = [];
    const done = new Set<string>();
    const byUuid = new Map<string, Observed[]>();
    for (const o of call.observed) byUuid.set(o.uuid, [...(byUuid.get(o.uuid) ?? []), o]);
    for (const [uuid, obs] of byUuid) {
      const snap = call.snaps.get(uuid);
      const created = obs.find((o) => o.kind === 'create');
      if (created && created.kind === 'create') {
        if (snap?.existed) {
          // Deleted and recreated under one id in one call: the replacement is not something
          // undo can safely swap back, so it is left alone.
          targets.push(viewOnly({ ...blankTarget(uuid) }, RECREATED_NOTE));
        } else {
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
        }
      } else if (snap?.existed && snap.before) {
        const stale = call.stale.get(uuid);
        const deleted = obs.some((o) => o.kind === 'delete');
        const paths = [...new Set(obs.flatMap((o) => (o.kind === 'update' ? o.paths : [])))];
        const incomplete =
          paths.length > L.changedPaths || obs.some((o) => o.kind === 'update' && !o.complete);
        const last = [...obs].reverse().find((o) => o.kind === 'update');
        const updates = !deleted && paths.length > 0;
        const ok = (deleted || updates) && stale === undefined && !incomplete;
        targets.push({
          uuid,
          existed: true,
          before: snap.before,
          existsAfter: !deleted,
          afterModifiedTime: last && last.kind === 'update' ? last.modifiedTime : null,
          undoable: ok,
          changedPaths: deleted || incomplete ? [] : paths,
          note: incomplete
            ? PATH_LIMIT_NOTE
            : stale !== undefined
              ? `changed by ${safeText(stale, 40)} after the call began; its snapshot is stale`
              : ok
                ? ''
                : NOT_OBSERVED_NOTE,
        });
      } else continue;
      done.add(uuid);
    }
    for (const t of claimed) {
      if (!done.has(t.uuid)) targets.push(viewOnly(t, NOT_OBSERVED_NOTE));
    }
    return {
      ...record,
      targets: targets.slice(0, L.targets),
      targetsDropped: Math.max(record.targetsDropped, targets.length - L.targets),
    };
  }
}

const blankTarget = (uuid: string): AuditTarget => ({
  uuid,
  existed: false,
  before: null,
  existsAfter: false,
  afterModifiedTime: null,
  undoable: false,
  changedPaths: [],
  note: '',
});

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
