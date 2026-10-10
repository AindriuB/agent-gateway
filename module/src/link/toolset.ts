import type { LinkClient } from './client.js';
import { evaluate, type PolicyInputs } from '../policy/evaluate.js';
import {
  toolsForRole as registryToolsForRole,
  type ToolCategory,
  type ToolDefinition,
} from '@agent-gateway/protocol';

export interface ToolsetDeps {
  /** From `game.user`, read at announce time. */
  isGM(): boolean;
  /** True when policy resolves this category to `deny` for this agent. Default: nothing denied. */
  isCategoryDenied?(category: ToolCategory): boolean;
  /** Role-to-tools lookup; defaults to the protocol registry. Injectable for tests. */
  toolsForRole?(isGM: boolean): readonly ToolDefinition[];
  /** Put a `toolset` frame on the link, if it is up. */
  send(msg: { type: 'toolset'; tools: string[] }): void;
}

/** Role tools minus tools whose category policy denies. Sorted, so equal sets compare equal. */
export function computeToolset(
  isGM: boolean,
  isCategoryDenied: (category: ToolCategory) => boolean = () => false,
  toolsForRole: (isGM: boolean) => readonly ToolDefinition[] = registryToolsForRole,
): string[] {
  return toolsForRole(isGM)
    .filter((t) => !isCategoryDenied(t.category))
    .map((t) => t.name)
    .sort();
}

/**
 * Announces the user's tool set to the gateway: once per connection (`connected()`), then only
 * when it changes (`refresh()`, called on user role updates and policy setting changes).
 */
export class ToolsetAnnouncer {
  private last: string | undefined;

  constructor(private readonly deps: ToolsetDeps) {}

  private compute(): string[] {
    return computeToolset(this.deps.isGM(), this.deps.isCategoryDenied, this.deps.toolsForRole);
  }

  /** The link has just been welcomed: send unconditionally, the gateway has no set for it yet. */
  connected(): void {
    const tools = this.compute();
    this.last = tools.join(',');
    this.deps.send({ type: 'toolset', tools });
  }

  /** Re-evaluate; sends only if the set differs from what was last sent. */
  refresh(): void {
    if (this.last === undefined) return;
    const tools = this.compute();
    const sig = tools.join(',');
    if (sig === this.last) return;
    this.last = sig;
    this.deps.send({ type: 'toolset', tools });
  }

  /** The link dropped: the next welcome starts over. */
  disconnected(): void {
    this.last = undefined;
  }
}

/**
 * Whether policy hides a category from this user: the player or headless switch is off, or the
 * world ceiling combined with the owner policy resolves to `deny`. `ask_*` stays listed.
 */
export function policyDenies(
  inputs: () => PolicyInputs,
  isGM: () => boolean,
): (category: ToolCategory) => boolean {
  return (category) => {
    const v = evaluate(inputs(), { isGM: isGM(), headless: false, category });
    return v.kind === 'disabled' || v.decision === 'deny';
  };
}

/**
 * Announce the tool set once the link is welcomed (state `connected`, which the client sets only
 * after `welcome`), and forget it when the link drops so the next welcome sends in full.
 */
export function installToolsetAnnouncer(
  client: LinkClient,
  deps: Omit<ToolsetDeps, 'send'>,
): ToolsetAnnouncer {
  const announcer = new ToolsetAnnouncer({ ...deps, send: (m) => client.sendMessage(m) });
  let up = false;
  client.onState((s) => {
    if (s.kind === 'connected') {
      if (!up) announcer.connected();
      up = true;
    } else {
      if (up) announcer.disconnected();
      up = false;
    }
  });
  return announcer;
}
