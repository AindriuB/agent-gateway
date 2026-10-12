import { canonicalJson } from './canonical.js';
export type ReplayStatus = 'pending' | 'approved' | 'denied' | 'expired' | 'unknown';
export const REPLAY_RECEIPTS = Object.freeze({
  max: 1000,
  retainMs: 7 * 86400000,
  maxChars: 5_000_000,
});
interface Receipt {
  id: string;
  binding: string;
  status: ReplayStatus;
  text: string;
  updatedAt: number;
}
/** Fail-closed durable browser guard. Never executes anything loaded from storage. */
export class ReplayReceipts {
  private live = new Set<string>();
  constructor(
    private storage: Pick<Storage, 'getItem' | 'setItem'>,
    private key: string,
    private now: () => number = Date.now,
  ) {}
  private read(): Receipt[] {
    const raw = this.storage.getItem(this.key);
    if (!raw) return [];
    if (raw.length > REPLAY_RECEIPTS.maxChars) throw Error('Replay storage exceeds bound');
    const rows: unknown = JSON.parse(raw);
    if (!Array.isArray(rows) || rows.length > REPLAY_RECEIPTS.max)
      throw Error('Invalid replay storage');
    for (const row of rows)
      if (
        !row ||
        typeof row.id !== 'string' ||
        typeof row.binding !== 'string' ||
        !['pending', 'approved', 'denied', 'expired', 'unknown'].includes(row.status) ||
        typeof row.text !== 'string' ||
        row.text.length > 4000 ||
        !Number.isFinite(row.updatedAt)
      )
        throw Error('Corrupt replay receipt');
    return rows as Receipt[];
  }
  private save(rows: Receipt[]): void {
    const text = JSON.stringify(rows);
    if (text.length > REPLAY_RECEIPTS.maxChars) throw Error('Replay storage full');
    this.storage.setItem(this.key, text);
    if (this.storage.getItem(this.key) !== text) throw Error('Replay receipt not durably stored');
  }
  claim(id: string, identity: unknown): { fresh: boolean; receipt: Receipt } {
    const binding = canonicalJson(identity);
    const rows = this.read();
    const existing = rows.find((row) => row.id === id);
    if (existing) {
      if (existing.binding !== binding) throw Error('Replay receipt collision');
      if (existing.status === 'pending' && !this.live.has(id)) {
        existing.status = 'unknown';
        existing.text = 'Previous execution outcome unknown; reconciliation required';
        this.save(rows);
      }
      return { fresh: false, receipt: existing };
    }
    // Seven-day queue TTL + seven-day receipt retention prevents old IDs becoming executable.
    const keep = rows.filter((row) => this.now() - row.updatedAt < REPLAY_RECEIPTS.retainMs);
    if (keep.length >= REPLAY_RECEIPTS.max) throw Error('Replay receipt capacity reached');
    const receipt: Receipt = {
      id,
      binding,
      status: 'pending',
      text: 'Awaiting explicit approval',
      updatedAt: this.now(),
    };
    keep.push(receipt);
    this.save(keep);
    this.live.add(id);
    return { fresh: true, receipt };
  }
  update(id: string, status: ReplayStatus, text: string): Receipt {
    const rows = this.read(),
      row = rows.find((row) => row.id === id);
    if (!row) throw Error('Missing replay receipt');
    if (row.status !== 'pending') return row;
    row.status = status;
    row.text = text.slice(0, 4000);
    row.updatedAt = this.now();
    this.save(rows);
    if (status !== 'pending') this.live.delete(id);
    return row;
  }
}
