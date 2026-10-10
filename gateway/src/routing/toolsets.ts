import { EventEmitter } from 'node:events';
import { TOOLS } from '@agent-gateway/protocol/tools';
import type { LinkConnection } from '../link/index.js';

/**
 * The tool names each connection's module last announced in a `toolset` frame. Held per
 * connection object, so a replaced or reconnected link starts with nothing until its module
 * announces again. What the module says is only ever used to narrow the list shown; the module
 * re-checks every call against the real Foundry user.
 */
export class ToolsetStore extends EventEmitter<{ changed: [LinkConnection] }> {
  private readonly sets = new WeakMap<LinkConnection, readonly string[]>();
  private readonly known: Set<string>;

  constructor(knownTools: Iterable<string> = TOOLS.map((t) => t.name)) {
    super();
    this.known = new Set(knownTools);
  }

  /** Also accept these names (tests register fixture tools on the shared store). */
  know(names: Iterable<string>): void {
    for (const n of names) this.known.add(n);
  }

  get(conn: LinkConnection): readonly string[] | undefined {
    return this.sets.get(conn);
  }

  /** Records the set; emits `changed` only when it differs from the last one. */
  set(conn: LinkConnection, tools: readonly string[]): void {
    // Keep only names the gateway knows, before deduping or sorting: a hostile frame full of
    // made-up names costs one pass and stores at most the registry size.
    const keep = new Set<string>();
    for (const t of tools) if (this.known.has(t)) keep.add(t);
    const next = [...keep].sort();
    const prev = this.sets.get(conn);
    if (prev && prev.length === next.length && prev.every((t, i) => t === next[i])) return;
    this.sets.set(conn, next);
    this.emit('changed', conn);
  }
}

/** Shared by the link server (writer) and MCP sessions (readers) unless a test injects its own. */
export const toolsets = new ToolsetStore();
