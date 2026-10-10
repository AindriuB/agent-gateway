import { randomUUID } from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { TOOLS, toJsonSchema, type ToolDefinition } from '@agent-gateway/protocol/tools';
import type { ErrorCode } from '@agent-gateway/protocol';
import { LinkCallError, type LinkConnection, type LinkRegistry } from '../link/index.js';
import { SessionBinding, describePairs, type UserSelector } from '../routing/index.js';

export const DEFAULT_CALL_TIMEOUT_MS = 30_000;

export interface SessionServerOptions {
  version: string;
  registry: LinkRegistry;
  selector?: UserSelector;
  /** Defaults to the protocol registry; injectable for tests. */
  tools?: readonly ToolDefinition[];
  callTimeoutMs?: number;
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
  const binding = new SessionBinding(opts.registry, opts.selector);
  const timeoutMs = opts.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
  const server = new Server(
    { name: 'foundry-agent-gateway', version: opts.version },
    { capabilities: { tools: { listChanged: true } } },
  );

  const visibleFor = (conn: LinkConnection | undefined): readonly ToolDefinition[] =>
    conn?.info.isGM ? all : all.filter((t) => t.minRole === 'player');

  const currentConn = (): LinkConnection | undefined => {
    const r = binding.resolve();
    return r.kind === 'bound' ? r.conn : undefined;
  };

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: visibleFor(currentConn()).map((t) => {
      const { inputSchema, outputSchema } = toJsonSchema(t);
      return {
        name: t.name,
        description: t.description,
        inputSchema: inputSchema as { type: 'object' },
        outputSchema: outputSchema as { type: 'object' },
      };
    }),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = all.find((t) => t.name === req.params.name);
    if (!tool) return failure('UNKNOWN_TOOL', `Unknown tool: ${req.params.name}`);
    const r = binding.resolve();
    if (r.kind === 'ambiguous') {
      return failure(
        'INVALID_ARGS',
        `Several Foundry users are connected; start the gateway with --world and --user to choose one. Available: ${describePairs(r.available)}`,
      );
    }
    if (r.kind === 'unbound' || !r.conn) return offline();
    const conn = r.conn;
    if (!visibleFor(conn).includes(tool)) {
      return failure('UNKNOWN_TOOL', `Unknown tool: ${req.params.name}`);
    }
    const parsed = tool.input.safeParse(req.params.arguments ?? {});
    if (!parsed.success) {
      return failure(
        'INVALID_ARGS',
        parsed.error.issues
          .map((i) => (i.path.length ? `${i.path.map(String).join('.')}: ${i.message}` : i.message))
          .join('; '),
      );
    }
    try {
      const res = await opts.registry.call(
        conn,
        tool.name,
        parsed.data as Record<string, unknown>,
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

  // Tell the client when its bound connection comes or goes (its tool list may change).
  const changed = (c: LinkConnection): void => {
    const pair = binding.pair;
    if (pair) {
      if (c.worldId !== pair.worldId || c.userId !== pair.userId) return;
    } else if (binding.resolve().kind !== 'bound') {
      return;
    }
    void server.sendToolListChanged().catch(() => {});
  };
  opts.registry.on('connected', changed);
  opts.registry.on('disconnected', changed);
  const previousOnClose = server.onclose;
  server.onclose = () => {
    opts.registry.off('connected', changed);
    opts.registry.off('disconnected', changed);
    previousOnClose?.();
  };

  return server;
}
