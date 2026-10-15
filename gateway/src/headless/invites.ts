import type { MemoryInviteProvider } from '../link/invites.js';
import { generateInviteCode, hashInviteCode } from '../link/invites.js';

/** A minted invite lives two minutes: long enough for the runner to type it. */
export const HEADLESS_INVITE_TTL_MS = 2 * 60_000;

interface Entry {
  worldId: string;
  userId: string;
  origin: string;
  expiresAt: number;
}

export interface HeadlessInvitesOptions {
  /** Called at mint and again at redeem; redeem time is the authority. */
  isAgentActive(worldId: string, userId: string): boolean;
  now?: () => number;
  ttlMs?: number;
}

const agentKey = (worldId: string, userId: string): string => JSON.stringify([worldId, userId]);

/**
 * The in-memory invites the gateway mints for its own headless agent. Only a hash of each code is
 * kept, never written anywhere; at most one invite per agent is live. Single use, exact target.
 */
export class HeadlessInvites implements MemoryInviteProvider {
  /** code hash -> entry. */
  private readonly byHash = new Map<string, Entry>();
  /** agent key -> the hash of its live invite. */
  private readonly byAgent = new Map<string, string>();

  constructor(private readonly opts: HeadlessInvitesOptions) {}

  private now(): number {
    return (this.opts.now ?? Date.now)();
  }

  /** The code, or undefined when the agent is not (or no longer) active. The only copy of the code. */
  mint(worldId: string, userId: string, origin: string): string | undefined {
    if (!this.opts.isAgentActive(worldId, userId)) {
      this.dropAgent(worldId, userId);
      return undefined;
    }
    this.dropAgent(worldId, userId);
    const code = generateInviteCode();
    const hash = hashInviteCode(code);
    this.byHash.set(hash, {
      worldId,
      userId,
      origin,
      expiresAt: this.now() + (this.opts.ttlMs ?? HEADLESS_INVITE_TTL_MS),
    });
    this.byAgent.set(agentKey(worldId, userId), hash);
    return code;
  }

  redeem(
    code: string,
    claim: { worldId: string; userId: string; origin: string },
  ): 'match' | 'mismatch' | 'unknown' {
    const hash = hashInviteCode(code);
    const entry = this.byHash.get(hash);
    if (!entry) return 'unknown';
    // Spent by the attempt, whatever its outcome.
    this.byHash.delete(hash);
    if (this.byAgent.get(agentKey(entry.worldId, entry.userId)) === hash)
      this.byAgent.delete(agentKey(entry.worldId, entry.userId));
    if (this.now() >= entry.expiresAt) return 'mismatch';
    if (!this.opts.isAgentActive(entry.worldId, entry.userId)) return 'mismatch';
    return entry.worldId === claim.worldId &&
      entry.userId === claim.userId &&
      entry.origin === claim.origin
      ? 'match'
      : 'mismatch';
  }

  /** Discard every outstanding invite for the agent. */
  dropAgent(worldId: string, userId: string): void {
    const key = agentKey(worldId, userId);
    const hash = this.byAgent.get(key);
    if (hash !== undefined) this.byHash.delete(hash);
    this.byAgent.delete(key);
  }

  /** Outstanding invites (tests). */
  get size(): number {
    return this.byHash.size;
  }
}
