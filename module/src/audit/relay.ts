import { sanitiseRecord } from './record.js';
import { AUDIT_LIMITS as L, type AuditRecord } from './types.js';

type Msg = { kind: 'audit.entry'; record: AuditRecord } | { kind: 'audit.ack'; id: string };

export interface RelayDeps {
  selfId(): string;
  isGM(): boolean;
  /** The designated active GM, the one client that writes relayed entries. */
  activeGMId(): string | null;
  isUserGM(id: string): boolean;
  emit(msg: Msg): void;
  /** GM side: check a record from `senderId`, then write it to the journal. */
  write(record: AuditRecord, senderId: string): Promise<void>;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  now(): number;
}

export const RESEND_MS = 10_000;
const SEEN_MAX = 1000;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 60;

/**
 * Carries audit records from player clients to the active GM over the module socket. A player
 * client holds a record until a GM acknowledges it, and resends it while no acknowledgement comes;
 * the GM writes each entry id once. Who sent a record is the socket's attested sender (the second
 * handler argument, appended by the server), never a field of the payload.
 */
export class AuditRelay {
  private readonly buffer = new Map<string, AuditRecord>();
  private readonly seen = new Set<string>();
  private readonly sent = new Map<string, number[]>();
  private timer: unknown = null;

  constructor(private readonly deps: RelayDeps) {}

  /** Records waiting for a GM (player clients). */
  get pending(): number {
    return this.buffer.size;
  }

  async submit(record: AuditRecord): Promise<void> {
    if (this.deps.isGM()) {
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
    if (this.deps.activeGMId()) {
      for (const record of this.buffer.values()) this.deps.emit({ kind: 'audit.entry', record });
    }
    this.timer = this.deps.setTimer(() => {
      this.timer = null;
      this.flush();
    }, RESEND_MS);
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
    const msg = data as { kind?: unknown; record?: unknown; id?: unknown };
    if (msg.kind === 'audit.ack') {
      // Only a GM can acknowledge: a player must not be able to make another client drop records.
      if (typeof msg.id === 'string' && this.deps.isUserGM(senderId)) this.buffer.delete(msg.id);
      return;
    }
    if (msg.kind !== 'audit.entry') return;
    if (!this.deps.isGM() || this.deps.activeGMId() !== this.deps.selfId()) return;
    if (senderId === this.deps.selfId()) return;
    const record = sanitiseRecord(msg.record, {
      userId: senderId,
      timestamp: this.deps.now(),
      relayed: true,
    });
    if (!record) return;
    if (this.seen.has(record.entryId)) {
      this.deps.emit({ kind: 'audit.ack', id: record.entryId });
      return;
    }
    if (!this.allow(senderId)) {
      console.warn(`agent-gateway | audit relay rate limit: dropped a record from ${senderId}`);
      return;
    }
    try {
      await this.deps.write(record, senderId);
    } catch (err) {
      console.error('agent-gateway | audit write failed', err);
      return;
    }
    this.seen.add(record.entryId);
    if (this.seen.size > SEEN_MAX) this.seen.delete(this.seen.values().next().value as string);
    this.deps.emit({ kind: 'audit.ack', id: record.entryId });
  }

  private allow(senderId: string): boolean {
    const now = this.deps.now();
    const recent = (this.sent.get(senderId) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
    if (recent.length >= RATE_MAX) {
      this.sent.set(senderId, recent);
      return false;
    }
    recent.push(now);
    this.sent.set(senderId, recent);
    return true;
  }
}
