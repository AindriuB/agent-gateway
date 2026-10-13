import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

export const STATUS_TOOL = 'gateway_status';

/**
 * MCP server for an instance that could not take the link port or the pairing store because
 * another gateway already owns them. It never touches either resource. It answers the MCP
 * handshake normally and reports the conflict through tool errors, so a host that starts
 * extra copies (probes, shared pools) sees a live server, not a crash.
 */
export function createDegradedServer(opts: { version: string; reason: string }): Server {
  const text = `LINK_UNAVAILABLE: this gateway instance is not connected to Foundry: ${opts.reason}. Stop the other gateway instance, or give this one different ports.`;
  const server = new Server(
    { name: 'foundry-agent-gateway', version: opts.version },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: [
      {
        name: STATUS_TOOL,
        description: 'Explains why this gateway instance cannot reach Foundry.',
        inputSchema: { type: 'object' as const, properties: {}, additionalProperties: false },
      },
    ],
  }));
  server.setRequestHandler(CallToolRequestSchema, () => ({
    isError: true,
    content: [{ type: 'text' as const, text }],
  }));
  return server;
}
