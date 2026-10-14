import type { Store } from '../store/index.js';
import type { LinkConnection, LinkRegistry } from './registry.js';

export const REVOCATION_SWEEP_MS = 5_000;
/** Settled, cancelled or expired invite rows older than this are deleted. */
export const INVITE_RETENTION_MS = 30 * 24 * 3_600_000;
/** How often the sweep prunes invites; the prune scans the table, so not every pass. */
export const INVITE_PRUNE_EVERY_MS = 3_600_000;

export interface RevocationSweepOptions {
  registry: LinkRegistry;
  store: () => Store | undefined;
  /** Send `reject` PAIRING_INVALID and close the socket with 1008. */
  drop: (conn: LinkConnection) => void;
  intervalMs?: number;
  /** One line for the operator's log; the caller sanitizes nothing here, so nothing untrusted is passed. */
  warn?: (line: string) => void;
  now?: () => number;
}

/**
 * Closes live connections whose pairing was revoked, possibly by another process (the CLI). A
 * periodic check, not a per-frame one: at most one indexed lookup per connection. It fires only
 * the in-memory `onPairingRevoked` listeners; grants were revoked in the revoking transaction
 * (keyed by world and user), and revoking them here could remove a grant made after a re-pair.
 */
export class RevocationSweep {
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly dropped = new WeakSet<LinkConnection>();
  private lastPrune: number | undefined;

  constructor(private readonly opts: RevocationSweepOptions) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.sweepOnce(), this.opts.intervalMs ?? REVOCATION_SWEEP_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** One pass; returns how many connections it closed. */
  sweepOnce(): number {
    const store = this.opts.store();
    if (!store) return 0;
    let closed = 0;
    this.pruneInvites(store);
    for (const conn of this.opts.registry.list()) {
      if (this.dropped.has(conn)) continue;
      try {
        if (store.isPairingActive(conn.agentId, conn.worldId, conn.userId)) continue;
        this.dropped.add(conn);
        this.opts.drop(conn);
        closed++;
        const row = store.getPairing(conn.agentId);
        if (row) store.notifyPairingRevoked(row);
      } catch (err) {
        // A closing store must not crash the timer.
        this.opts.warn?.(`revocation sweep failed: ${(err as Error).message}`);
      }
    }
    return closed;
  }

  /** Delete old finished invite rows, at most once per `INVITE_PRUNE_EVERY_MS`. */
  private pruneInvites(store: Store): void {
    const at = (this.opts.now ?? Date.now)();
    if (this.lastPrune !== undefined && at - this.lastPrune < INVITE_PRUNE_EVERY_MS) return;
    try {
      store.invites.pruneBefore(at - INVITE_RETENTION_MS, at);
      this.lastPrune = at;
    } catch (err) {
      this.opts.warn?.(`invite prune failed: ${(err as Error).message}`);
    }
  }
}
