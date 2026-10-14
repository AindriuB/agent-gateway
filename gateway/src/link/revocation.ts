import type { Store } from '../store/index.js';
import type { LinkConnection, LinkRegistry } from './registry.js';

export const REVOCATION_SWEEP_MS = 5_000;

export interface RevocationSweepOptions {
  registry: LinkRegistry;
  store: () => Store | undefined;
  /** Send `reject` PAIRING_INVALID and close the socket with 1008. */
  drop: (conn: LinkConnection) => void;
  intervalMs?: number;
  /** One line for the operator's log; the caller sanitizes nothing here, so nothing untrusted is passed. */
  warn?: (line: string) => void;
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
}
