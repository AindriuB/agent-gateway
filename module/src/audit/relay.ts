import { sanitiseRecord } from './record.js';
import { AUDIT_LIMITS as L, type AuditRecord } from './types.js';

type Msg =
  | { kind: 'audit.entry'; record: AuditRecord }
  | { kind: 'audit.ack'; id: string }
  | { kind: 'audit.intent'; callId: string; uuid?: string; creates?: boolean }
  | { kind: 'audit.intent.ack'; callId: string; uuid: string; ok: boolean };

export interface RelayDeps {
  selfId(): string;
  isGM(): boolean;
  /** The designated active GM, the one client that writes relayed entries. */
  activeGMId(): string | null;
  isUserGM(id: string): boolean;
  /** Send to these users only (the server enforces `recipients`); never broadcast. */
  emit(msg: Msg, recipients: string[]): void;
  /** GM side: check a record from `senderId`, then write it to the journal. */
  write(record: AuditRecord, senderId: string): Promise<void>;
  /** GM side: copy what an intent names from this client's own world data. True when witnessed. */
  onIntent(msg: unknown, senderId: string): Promise<boolean>;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  now(): number;
}

export const RESEND_MS = 10_000;
const SEEN_MAX = 1000;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 120;
/** Intents are small and many per call, so they have their own, larger budget. */
const INTENT_RATE_MAX = 600;

/**
 * Carries audit records from player clients to the active GM over the module socket. A player
 * client holds a record until a GM acknowledges it, and resends it while no acknowledgement comes;
 * the GM writes each entry id once. Who sent a record is the socket's attested sender (the second
 * handler argument, appended by the server), never a field of the payload.
 */
export class AuditRelay {
  private readonly buffer = new Map<string, AuditRecord>();
  private readonly seen = new Set<string>();
  private readonly writing = new Set<string>();
  private readonly sent = new Map<string, number[]>();
  private timer: unknown = null;
  private readonly waiting = new Map<string, (ok: boolean) => void>();
  private readonly unwitnessed = new Set<string>();

  constructor(private readonly deps: RelayDeps) {}

  /** Records waiting for a GM (player clients). */
  get pending(): number {
    return this.buffer.size;
  }

  async submit(record: AuditRecord): Promise<void> {
    // Only the designated active GM writes. Any other client, a second GM included, buffers the
    // record and relays it, so two clients never create or write the journal.
    if (this.deps.isGM() && this.deps.activeGMId() === this.deps.selfId()) {
      await this.deps.write(record, this.deps.selfId());
      return;
    }
    this.buffer.set(record.entryId, record);
    while (this.buffer.size > L.buffer) {
      const oldest = this.buffer.keys().next().value as string;
      this.buffer.delete(oldest);
      console.warn('agent-gateway | audit buffer full; dropped the oldest unsent record');
    }
    this.flush();
  }

  /** Send everything unacknowledged if a GM is present; try again later either way. */
  flush(): void {
    if (this.timer !== null) {
      this.deps.clearTimer(this.timer);
      this.timer = null;
    }
    if (this.buffer.size === 0) return;
    const gm = this.deps.activeGMId();
    if (gm) {
      for (const record of this.buffer.values()) {
        this.deps.emit({ kind: 'audit.entry', record }, [gm]);
      }
    }
    this.timer = this.deps.setTimer(() => {
      this.timer = null;
      this.flush();
    }, RESEND_MS);
  }

  /**
   * Player side: tell the active GM what this call will touch, and wait (bounded) until the GM
   * client has copied it. False when no GM is online or none answered in time; the call then runs
   * anyway but nothing in it can be undone.
   */
  requestIntent(callId: string, what: { uuid?: string; creates?: boolean }): Promise<boolean> {
    const gm = this.deps.activeGMId();
    if (!gm || this.unwitnessed.has(callId)) return Promise.resolve(false);
    const key = `${callId}\u0000${what.uuid ?? '*creates'}`;
    return new Promise<boolean>((resolve) => {
      const timer = this.deps.setTimer(() => {
        if (this.waiting.delete(key)) {
          this.unwitnessed.add(callId);
          if (this.unwitnessed.size > SEEN_MAX) {
            this.unwitnessed.delete(this.unwitnessed.values().next().value as string);
          }
          resolve(false);
        }
      }, L.intentWaitMs);
      this.waiting.set(key, (ok) => {
        this.deps.clearTimer(timer);
        resolve(ok);
      });
      this.deps.emit({ kind: 'audit.intent', callId, ...what }, [gm]);
    });
  }

  /** A GM joined or left: try now rather than waiting for the timer. */
  onPresenceChange(): void {
    if (this.buffer.size > 0) this.flush();
  }

  async onMessage(data: unknown, senderId: unknown): Promise<void> {
    if (
      typeof senderId !== 'string' ||
      senderId === '' ||
      typeof data !== 'object' ||
      data === null
    ) {
      return;
    }
    const msg = data as {
      kind?: unknown;
      record?: unknown;
      id?: unknown;
      callId?: unknown;
      uuid?: unknown;
      ok?: unknown;
    };
    if (msg.kind === 'audit.intent.ack') {
      if (!this.deps.isUserGM(senderId)) return;
      const key = `${String(msg.callId)}\u0000${typeof msg.uuid === 'string' ? msg.uuid : '*creates'}`;
      this.waiting.get(key)?.(msg.ok === true);
      this.waiting.delete(key);
      return;
    }
    if (msg.kind === 'audit.intent') {
      if (!this.deps.isGM() || this.deps.activeGMId() !== this.deps.selfId()) return;
      if (senderId === this.deps.selfId()) return;
      // Rate limit first, as for entries: nothing is read from the payload until it passes.
      if (!this.allow(senderId, 'intent')) return;
      const callId = typeof msg.callId === 'string' ? msg.callId.slice(0, 40) : '';
      const uuid = typeof msg.uuid === 'string' ? msg.uuid.slice(0, L.uuid) : undefined;
      let ok = false;
      try {
        ok = await this.deps.onIntent(data, senderId);
      } catch (err) {
        console.error('agent-gateway | audit intent failed', err);
      }
      this.deps.emit({ kind: 'audit.intent.ack', callId, uuid: uuid ?? '*creates', ok }, [
        senderId,
      ]);
      return;
    }
    if (msg.kind === 'audit.ack') {
      // Only a GM can acknowledge: a player must not be able to make another client drop records.
      if (typeof msg.id === 'string' && this.deps.isUserGM(senderId)) this.buffer.delete(msg.id);
      return;
    }
    if (msg.kind !== 'audit.entry') return;
    if (!this.deps.isGM() || this.deps.activeGMId() !== this.deps.selfId()) return;
    if (senderId === this.deps.selfId()) return;
    // Cheap checks first: nothing below parses, copies or stringifies the payload until the
    // sender is inside its rate limit. A resent record that was already written costs one lookup.
    const peek =
      typeof msg.record === 'object' && msg.record !== null
        ? (msg.record as { entryId?: unknown }).entryId
        : undefined;
    if (typeof peek === 'string' && this.seen.has(peek)) {
      this.deps.emit({ kind: 'audit.ack', id: peek }, [senderId]);
      return;
    }
    // A resend cannot start another write or be acknowledged before the first succeeds.
    if (typeof peek === 'string' && this.writing.has(peek)) return;
    if (!this.allow(senderId, 'entry')) {
      console.warn(`agent-gateway | audit relay rate limit: dropped a record from ${senderId}`);
      return;
    }
    // A GM's own client captured its snapshots, so a record from another GM (attested) keeps its
    // targets; a player's is display data only (`relayed`).
    const record = sanitiseRecord(msg.record, {
      userId: senderId,
      timestamp: this.deps.now(),
      relayed: !this.deps.isUserGM(senderId),
    });
    if (!record) return;
    // Sanitisation can normalise the ID (for example, trim whitespace).
    if (this.seen.has(record.entryId)) {
      this.deps.emit({ kind: 'audit.ack', id: record.entryId }, [senderId]);
      return;
    }
    if (this.writing.has(record.entryId)) return;
    this.writing.add(record.entryId);
    try {
      await this.deps.write(record, senderId);
      this.seen.add(record.entryId);
      if (this.seen.size > SEEN_MAX) this.seen.delete(this.seen.values().next().value as string);
      this.deps.emit({ kind: 'audit.ack', id: record.entryId }, [senderId]);
    } catch (err) {
      console.error('agent-gateway | audit write failed', err);
    } finally {
      this.writing.delete(record.entryId);
    }
  }

  private allow(senderId: string, kind: 'entry' | 'intent'): boolean {
    const now = this.deps.now();
    const bucket = `${kind}:${senderId}`;
    const recent = (this.sent.get(bucket) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
    if (recent.length >= (kind === 'intent' ? INTENT_RATE_MAX : RATE_MAX)) {
      this.sent.set(bucket, recent);
      return false;
    }
    recent.push(now);
    this.sent.set(bucket, recent);
    return true;
  }
}
