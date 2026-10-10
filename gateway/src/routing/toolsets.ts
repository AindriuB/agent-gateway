import { EventEmitter } from 'node:events';
import {
  checkToolDefinition,
  TOOL_LIMITS,
  TOOL_NAME_PATTERN,
  type AnnouncedTool,
} from '@agent-gateway/protocol';
import type { LinkConnection } from '../link/index.js';
import { safeText } from './sanitize.js';

/** Full definitions, isolated by authenticated link connection. Core authority stays in the session. */
export class ToolsetStore extends EventEmitter<{ changed: [LinkConnection] }> {
  private readonly sets = new WeakMap<LinkConnection, readonly AnnouncedTool[]>();

  constructor(private readonly log: (line: string) => void = console.warn) {
    super();
  }

  get(conn: LinkConnection): readonly AnnouncedTool[] | undefined {
    return this.sets.get(conn);
  }

  set(conn: LinkConnection, tools: readonly AnnouncedTool[]): void {
    if (
      tools.length > TOOL_LIMITS.announcementTools ||
      Buffer.byteLength(JSON.stringify({ type: 'toolset', tools })) > TOOL_LIMITS.announcementBytes
    ) {
      this.log('ignored toolset: announcement count or byte cap exceeded');
      return;
    }
    const keep = new Map<string, AnnouncedTool>();
    for (const tool of tools) {
      const problem = TOOL_NAME_PATTERN.test(tool.name)
        ? undefined
        : checkToolDefinition(tool, 'pack')[0];
      if (problem) {
        this.log(
          `dropped tool ${safeText(tool.name.slice(0, 64).replace(/\p{Cf}/gu, '�'))}: ${safeText(problem.replace(/\p{Cf}/gu, '�'))}`,
        );
        continue;
      }
      keep.set(tool.name, structuredClone(tool));
    }
    const sorted = [...keep.values()].sort((a, b) => a.name.localeCompare(b.name));
    let packs = 0;
    const next = sorted.filter(
      (t) => !t.name.includes('-') || ++packs <= TOOL_LIMITS.sessionPackTools,
    );
    if (packs > TOOL_LIMITS.sessionPackTools)
      this.log(`dropped ${packs - TOOL_LIMITS.sessionPackTools} pack tools: session cap exceeded`);
    if (JSON.stringify(this.sets.get(conn)) === JSON.stringify(next)) return;
    this.sets.set(conn, next);
    this.emit('changed', conn);
  }
}

export const toolsets = new ToolsetStore();
