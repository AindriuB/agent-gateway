import type { OfflineQueue } from '../offline-queue/service.js';
import type { QueueOwner } from '../offline-queue/repository.js';
import type { EventBuffer } from '../events/index.js';
import { projectOutputSchema } from './output-schema.js';
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { TOOLS, toJsonSchema, type ToolDefinition } from '@agent-gateway/protocol/tools';
import { validateArgs, type AnnouncedTool, type ErrorCode } from '@agent-gateway/protocol';
import { LinkCallError, type LinkConnection, type LinkRegistry } from '../link/index.js';
import {
  SessionBinding,
  describePairs,
  safeText,
  toolsets as sharedToolsets,
  type ToolsetStore,
  type Identity,
  type UserSelector,
} from '../routing/index.js';

export const DEFAULT_CALL_TIMEOUT_MS = 30_000;

export interface SessionServerOptions {
  version: string;
  events?: EventBuffer;
  queue?: OfflineQueue;
  registry: LinkRegistry;
  selector?: UserSelector;
  /** Defaults to the protocol registry; injectable for tests. */
  tools?: readonly ToolDefinition[];
  callTimeoutMs?: number;
  /** Paired identities (connected or not) that a `--user` name is checked against. */
  knownIdentities?: () => readonly Identity[];
  /** Status lines for the operator (stderr). */
  log?: (line: string) => void;
  /** Where announced tool sets are read from. Defaults to the one the link server writes. */
  toolsets?: ToolsetStore;
  /** Minimum gap between `list_changed` notifications. */
  listChangedIntervalMs?: number;
}

const failure = (code: ErrorCode | 'UNKNOWN_TOOL', text: string) => ({
  isError: true as const,
  // No structuredContent: SDK clients validate it against the tool's outputSchema even on errors.
  content: [{ type: 'text' as const, text: `${code}: ${text}` }],
});

const offline = () =>
  failure('WORLD_OFFLINE', 'world offline: the bound Foundry user is not connected to the gateway');

/**
 * One MCP session: bound to a single (world, user) pair for its whole life, with a tool list
 * taken from that user's role and calls forwarded over the link to that user's connection only.
 */
export function createSessionServer(opts: SessionServerOptions): Server {
  const all = opts.tools ?? TOOLS;
  const sessionId = randomUUID();
  const binding = new SessionBinding(opts.registry, opts.selector, opts.knownIdentities, (who) =>
    opts.log?.(
      `Bound MCP session to ${safeText(who.userName || who.userId)} in ${safeText(who.worldId)}; start with --user to choose.`,
    ),
  );
  let queueOwner: QueueOwner | undefined;
  const timeoutMs = opts.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
  const server = new Server(
    { name: 'foundry-agent-gateway', version: opts.version },
    { capabilities: { tools: { listChanged: true } } },
  );

  const toolsets = opts.toolsets ?? sharedToolsets;

  const warned = new WeakMap<LinkConnection, readonly AnnouncedTool[]>();
  type VisibleTool = { definition: AnnouncedTool; core?: ToolDefinition };
  const coreDefinition = (t: ToolDefinition): AnnouncedTool => ({
    name: t.name,
    description: t.description,
    category: t.category,
    minRole: t.minRole,
    ...toJsonSchema(t),
  });
  const moduleVisibleFor = (conn: LinkConnection | undefined): readonly VisibleTool[] => {
    const announced = conn ? toolsets.get(conn) : undefined;
    if (!announced)
      return all
        .filter((t) => t.handledBy === 'module' && (conn?.info.isGM || t.minRole === 'player'))
        .map((core) => ({
          core,
          definition: coreDefinition(core),
        }));
    const report = conn && warned.get(conn) !== announced;
    if (conn) warned.set(conn, announced);
    const coreNames = new Set(announced.filter((t) => !t.name.includes('-')).map((t) => t.name));
    if (report)
      for (const t of announced.filter((t) => !t.name.includes('-'))) {
        const core = all.find((c) => c.name === t.name);
        if (!core)
          (opts.log ?? console.warn)(
            `dropped tool ${safeText(t.name.slice(0, 64))}: unknown core name`,
          );
        else if (!isDeepStrictEqual(coreDefinition(core), t))
          (opts.log ?? console.warn)(
            `tool ${safeText(t.name)} differs from gateway definition (version skew)`,
          );
      }
    return [
      ...all
        .filter((t) => t.handledBy === 'module' && coreNames.has(t.name))
        .map((core) => ({ core, definition: coreDefinition(core) })),
      ...announced
        .filter((t) => t.name.includes('-'))
        .map((t) => ({
          definition: {
            ...t,
            description: `[Third-party tool pack ${t.pack!.prefix}: ${t.pack!.id} ${t.pack!.version}] ${t.description}`,
          },
        })),
    ];
  };

  let eventOwner: ReturnType<NonNullable<typeof opts.events>['ownerFor']> | undefined;
  const pinnedEventOwner = (pair: { worldId: string; userId: string }) => {
    if (!opts.registry.get(pair.worldId, pair.userId) && !binding.offlineEventReady)
      throw new LinkCallError(
        'WORLD_OFFLINE',
        'Offline first binding requires an exact native user ID',
      );
    const owner = opts.events!.ownerFor(pair, eventOwner?.agentId);
    if (
      eventOwner &&
      (owner.agentId !== eventOwner.agentId ||
        owner.worldId !== eventOwner.worldId ||
        owner.userId !== eventOwner.userId)
    )
      throw new LinkCallError('FORBIDDEN', 'Event pairing changed; start a new session');
    eventOwner ??= owner;
    return eventOwner;
  };
  const visibleFor = (conn: LinkConnection | undefined): readonly VisibleTool[] => {
    const modules = moduleVisibleFor(conn);
    if (!opts.events || !binding.pair) return modules;
    try {
      const owner = pinnedEventOwner(binding.pair);
      opts.events.authorizeOwner(owner);
      return [
        ...modules,
        ...all
          .filter((t) => {
            if (t.handledBy !== 'gateway') return false;
            if (t.name === 'events_poll') return true;
            if (t.name !== 'events_history') return false;
            try {
              opts.events!.authorizeOwner(owner, true);
              return true;
            } catch {
              return false;
            }
          })
          .map((core) => ({ core, definition: coreDefinition(core) })),
      ];
    } catch {
      return modules;
    }
  };

  const currentConn = (): LinkConnection | undefined => {
    const r = binding.resolve(true, true);
    return r.kind === 'bound' ? r.conn : undefined;
  };

  const listed = (conn: LinkConnection | undefined) =>
    visibleFor(conn).map(({ definition: t }) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema as { type: 'object' },
      outputSchema: projectOutputSchema(t.outputSchema),
    }));
  const signature = (conn: LinkConnection | undefined): string =>
    createHash('sha256')
      .update(JSON.stringify(listed(conn)))
      .digest('hex');
  let lastSig = signature(undefined);
  server.setRequestHandler(ListToolsRequestSchema, () => {
    const conn = currentConn();
    lastSig = signature(conn);
    return { tools: listed(conn) };
  });

  server.setRequestHandler(CallToolRequestSchema, async (req, extra) => {
    if (!req.params.name.includes('-') && !all.some((t) => t.name === req.params.name))
      return failure('UNKNOWN_TOOL', `Unknown tool: ${req.params.name}`);
    const gatewayTool = all.find((t) => t.name === req.params.name && t.handledBy === 'gateway');
    const r = binding.resolve(true, !!gatewayTool || !!opts.queue);
    if (r.kind === 'ambiguous') {
      return failure(
        'INVALID_ARGS',
        r.permanent
          ? `Several paired Foundry users match that name; restart the gateway with --world and --user <id> to choose one. Available: ${describePairs(r.available)}`
          : `Several Foundry users are paired; start the gateway with --world and --user to choose one. Available: ${describePairs(r.available)}`,
      );
    }
    if (r.kind === 'unbound') return offline();
    if (gatewayTool && opts.events) {
      const parsed = gatewayTool.input.safeParse(req.params.arguments ?? {});
      if (!parsed.success) return failure('INVALID_ARGS', parsed.error.message);
      try {
        const owner = pinnedEventOwner(r.pair);
        const conn = opts.events.authorizeOwner(owner, gatewayTool.name === 'events_history');
        const input = parsed.data as {
          after?: number;
          limit: number;
          since?: string;
          types?: string[];
        };
        const result =
          gatewayTool.name === 'events_history'
            ? opts.events.history(owner, Date.parse(input.since!), input.types, input.limit)
            : conn
              ? await opts.events.poll(conn, sessionId, input.after, input.limit, extra.signal)
              : opts.events.readOffline(owner, input.after, input.limit);
        if (conn) opts.events.authorize(conn);
        opts.events.authorizeOwner(owner, gatewayTool.name === 'events_history');
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
          structuredContent: result,
        };
      } catch (e) {
        if (e instanceof LinkCallError) return failure(e.code, e.message);
        return failure('INTERNAL', 'Event read failed');
      }
    }
    if (opts.queue) {
      try {
        if (r.conn || binding.offlineEventReady) queueOwner = opts.queue.owner(r.pair, queueOwner);
        if (req.params.name === 'approval_status' && queueOwner) {
          const id = all
            .find((t) => t.name === 'approval_status')!
            .input.safeParse(req.params.arguments ?? {});
          if (!id.success) return failure('INVALID_ARGS', 'Invalid approval id');
          const row = opts.queue.status(queueOwner, (id.data as { id: string }).id);
          if (row) {
            const status = row.state === 'claimed' ? 'unknown' : row.state;
            const result = { id: row.id, status, ...(row.result ? { result: row.result } : {}) };
            return {
              content: [
                {
                  type: 'text' as const,
                  text:
                    status === 'queued'
                      ? 'World offline: queued intent; no approval or execution yet.'
                      : status === 'unknown'
                        ? 'Execution outcome unknown; reconcile before any new request.'
                        : JSON.stringify(result),
                },
              ],
              structuredContent: result,
            };
          }
        }
        if (
          !r.conn &&
          queueOwner &&
          req.params.name !== 'approval_status' &&
          all.find((t) => t.name === req.params.name)?.category !== 'read' &&
          !opts.queue.isRead(queueOwner, req.params.name)
        ) {
          const row = opts.queue.enqueue(
            queueOwner,
            sessionId,
            req.params.name,
            req.params.arguments,
            extra.signal,
          );
          return {
            content: [
              {
                type: 'text' as const,
                text: 'World offline: intent queued; no human approval or execution has occurred.',
              },
            ],
            structuredContent: { status: 'pending_approval', id: row.id },
          };
        }
      } catch (e) {
        return e instanceof LinkCallError
          ? failure(e.code, e.message)
          : failure('INTERNAL', 'Offline queue storage failed');
      }
    }
    if (!r.conn) return offline();
    const conn = r.conn;
    const visible = visibleFor(conn).find((t) => t.definition.name === req.params.name);
    if (!visible) {
      // Answered here: not in this user's current set, so nothing goes over the link.
      return failure('FORBIDDEN', `Tool not available to this user: ${req.params.name}`);
    }
    const tool = visible.definition;
    const parsed = visible.core
      ? visible.core.input.safeParse(req.params.arguments ?? {})
      : undefined;
    const packParsed = visible.core
      ? undefined
      : validateArgs(tool.inputSchema, req.params.arguments ?? {});
    if (parsed?.success === false || packParsed?.ok === false) {
      const issues =
        parsed?.success === false
          ? parsed.error.issues.map((i) => ({
              path: i.path.map(String).join('.'),
              message: i.message,
            }))
          : packParsed?.ok === false
            ? packParsed.issues
            : [];
      return failure('INVALID_ARGS', issues.map((i) => `${i.path}: ${i.message}`).join('; '));
    }
    const args = parsed?.success ? parsed.data : packParsed?.ok ? packParsed.value : {};
    try {
      const res = await opts.registry.call(
        conn,
        tool.name,
        args as Record<string, unknown>,
        timeoutMs,
        sessionId,
      );
      const structured =
        res.structured !== null && typeof res.structured === 'object'
          ? (res.structured as Record<string, unknown>)
          : undefined;
      return {
        content: [{ type: 'text' as const, text: res.text }],
        ...(structured ? { structuredContent: structured } : {}),
      };
    } catch (e) {
      if (e instanceof LinkCallError) return failure(e.code, e.message);
      return failure('INTERNAL', e instanceof Error ? e.message : String(e));
    }
  });

  // Tell the client when its visible tool list changed. Reconnect storms are coalesced: at most
  // one notification per interval, and none when the list is the same as the client last saw.
  const interval = opts.listChangedIntervalMs ?? 250;
  let lastSent = Number.NEGATIVE_INFINITY;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = (): void => {
    timer = undefined;
    const r = binding.resolve(false);
    const sig = signature(r.kind === 'bound' ? r.conn : undefined);
    if (sig === lastSig) return;
    lastSig = sig;
    lastSent = Date.now();
    void server.sendToolListChanged().catch(() => {});
  };
  const changed = (allowBind: boolean) => (c: LinkConnection) => {
    const pair = binding.pair;
    if (pair) {
      if (c.worldId !== pair.worldId || c.userId !== pair.userId) return;
    } else if (!allowBind || binding.resolve(true).kind !== 'bound') {
      return;
    }
    if (timer) return;
    timer = setTimeout(flush, Math.max(0, lastSent + interval - Date.now()));
    timer.unref();
  };
  const onConnected = changed(true);
  const onDisconnected = changed(false);
  opts.registry.on('connected', onConnected);
  opts.registry.on('disconnected', onDisconnected);
  const onToolset = changed(false);
  toolsets.on('changed', onToolset);
  const onEventsChanged = () => {
    if (!timer) {
      timer = setTimeout(flush, interval);
      timer.unref();
    }
  };
  opts.events?.on('changed', onEventsChanged);
  const previousOnClose = server.onclose;
  server.onclose = () => {
    opts.events?.cancelSession(sessionId);
    opts.registry.off('connected', onConnected);
    opts.registry.off('disconnected', onDisconnected);
    toolsets.off('changed', onToolset);
    opts.events?.off('changed', onEventsChanged);
    if (timer) clearTimeout(timer);
    previousOnClose?.();
  };

  return server;
}
