import { isDeepStrictEqual } from 'node:util';
import { EventEmitter } from 'node:events';
import {
  checkToolDefinition,
  snapshotToolsetValue,
  ToolsetMessage,
  TOOL_LIMITS,
  TOOL_NAME_PATTERN,
  type AnnouncedTool,
} from '@agent-gateway/protocol';
import type { LinkConnection } from '../link/index.js';
import { safeText } from './sanitize.js';

/** Full definitions, isolated by authenticated link connection. Core authority stays in the session. */
export class ToolsetStore extends EventEmitter<{ changed: [LinkConnection] }> {
  private readonly catalogs = new WeakMap<LinkConnection, readonly AnnouncedTool[]>();
  catalog(conn: LinkConnection): readonly AnnouncedTool[] | undefined {
    return this.catalogs.get(conn);
  }
  private readonly sets = new WeakMap<LinkConnection, readonly AnnouncedTool[]>();
  private readonly eventReads = new WeakMap<LinkConnection, boolean>();
  eventReadAllowed(conn: LinkConnection): boolean {
    return this.eventReads.get(conn) === true;
  }

  private readonly signatures = new WeakMap<LinkConnection, string>();

  revokeEventReads(conn: LinkConnection): void {
    const catalog = this.catalogs.delete(conn);
    if (!this.eventReadAllowed(conn) && !catalog) return;
    this.eventReads.set(conn, false);
    this.signatures.delete(conn);
    this.emit('changed', conn);
  }

  constructor(private readonly log: (line: string) => void = console.warn) {
    super();
  }

  get(conn: LinkConnection): readonly AnnouncedTool[] | undefined {
    return this.sets.get(conn);
  }

  set(conn: LinkConnection, tools: readonly AnnouncedTool[], eventReadAllowed = false): void {
    // Restrictive metadata is authoritative even when definitions cannot be accepted.
    if (eventReadAllowed !== true && this.eventReadAllowed(conn)) this.revokeEventReads(conn);
    const reject = (line: string) => {
      this.revokeEventReads(conn);
      this.log(line);
    };
    // Snapshot the complete input before reading fields, running validators or serializing.
    const snapshot = snapshotToolsetValue(tools);
    if (!snapshot.ok) {
      reject('ignored toolset: invalid bounded JSON representation');
      return;
    }
    const uncapped = ToolsetMessage.extend({ tools: ToolsetMessage.shape.tools.element.array() });
    const parsed = uncapped.safeParse({ type: 'toolset', tools: snapshot.value });
    if (!parsed.success) {
      reject('ignored toolset: invalid bounded JSON representation');
      return;
    }
    tools = parsed.data.tools;
    let encoded: string;
    try {
      encoded = JSON.stringify({ type: 'toolset', tools });
    } catch {
      reject('ignored toolset: serialization failed');
      return;
    }
    if (
      tools.length > TOOL_LIMITS.announcementTools ||
      Buffer.byteLength(encoded) > TOOL_LIMITS.announcementBytes
    ) {
      reject('ignored toolset: announcement count or byte cap exceeded');
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
      keep.set(tool.name, tool);
    }
    const sorted = [...keep.values()].sort((a, b) => a.name.localeCompare(b.name));
    let packs = 0;
    const next = sorted.filter(
      (t) => !t.name.includes('-') || ++packs <= TOOL_LIMITS.sessionPackTools,
    );
    if (packs > TOOL_LIMITS.sessionPackTools)
      this.log(`dropped ${packs - TOOL_LIMITS.sessionPackTools} pack tools: session cap exceeded`);
    const catalogValid =
      tools.every((tool) => isDeepStrictEqual(keep.get(tool.name), tool)) &&
      packs <= TOOL_LIMITS.sessionPackTools;
    let signature: string;
    try {
      signature = JSON.stringify({
        tools: next,
        eventReadAllowed: eventReadAllowed === true,
        catalogValid,
      });
    } catch {
      reject('ignored toolset: serialization failed');
      return;
    }
    if (catalogValid) this.catalogs.set(conn, next);
    else this.catalogs.delete(conn);
    if (this.signatures.get(conn) === signature) return;
    this.sets.set(conn, next);
    this.eventReads.set(conn, eventReadAllowed === true);
    this.signatures.set(conn, signature);
    this.emit('changed', conn);
  }
}

export const toolsets = new ToolsetStore();
