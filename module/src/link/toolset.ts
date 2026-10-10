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
