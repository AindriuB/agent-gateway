import { projectOutputSchema } from './output-schema.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { TOOLS, toJsonSchema, type ToolDefinition } from '@agent-gateway/protocol/tools';
import type { ModuleConnections } from '../app.js';

export interface McpServerOptions {
  version: string;
  role: 'player' | 'gm';
  connections: ModuleConnections;
  /** Defaults to the protocol registry; injectable for tests. */
  tools?: readonly ToolDefinition[];
}

export function createMcpServer(opts: McpServerOptions): Server {
  const all = (opts.tools ?? TOOLS).filter((t) => t.handledBy === 'module');
  const visible = opts.role === 'gm' ? all : all.filter((t) => t.minRole === 'player');
  const server = new Server(
    { name: 'foundry-agent-gateway', version: opts.version },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: visible.map((t) => {
      const { inputSchema, outputSchema } = toJsonSchema(t);
      return {
        name: t.name,
        description: t.description,
        inputSchema: inputSchema as { type: 'object' },
        outputSchema: projectOutputSchema(outputSchema),
      };
    }),
  }));

  server.setRequestHandler(CallToolRequestSchema, (req) => {
    const tool = visible.find((t) => t.name === req.params.name);
    if (!tool) {
      return {
        isError: true,
        content: [
          { type: 'text' as const, text: `UNKNOWN_TOOL: Unknown tool: ${req.params.name}` },
        ],
      };
    }
    // Routing to a connected module arrives in task 11; until then the world is offline.
    return {
      isError: true,
      content: [
        {
          type: 'text' as const,
          text: 'WORLD_OFFLINE: world offline: no Foundry world is connected to the gateway',
        },
      ],
    };
  });

  return server;
}
