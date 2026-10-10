import { EventEmitter } from 'node:events';
import type { LinkConnection } from '../link/index.js';

/**
 * The tool names each connection's module last announced in a `toolset` frame. Held per
 * connection object, so a replaced or reconnected link starts with nothing until its module
 * announces again. What the module says is only ever used to narrow the list shown; the module
 * re-checks every call against the real Foundry user.
 */
export class ToolsetStore extends EventEmitter<{ changed: [LinkConnection] }> {
  private readonly sets = new WeakMap<LinkConnection, readonly string[]>();

  get(conn: LinkConnection): readonly string[] | undefined {
    return this.sets.get(conn);
  }

  /** Records the set; emits `changed` only when it differs from the last one. */
  set(conn: LinkConnection, tools: readonly string[]): void {
    const next = [...new Set(tools)].sort();
    const prev = this.sets.get(conn);
    if (prev && prev.length === next.length && prev.every((t, i) => t === next[i])) return;
    this.sets.set(conn, next);
    this.emit('changed', conn);
  }
}

/** Shared by the link server (writer) and MCP sessions (readers) unless a test injects its own. */
export const toolsets = new ToolsetStore();
