import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { safeText } from '../routing/index.js';
import { STATUS_TOOL } from '../mcp/status-tool.js';

/**
 * MCP server for a standby gateway: another gateway holds the link with settings this instance
 * may not relay to. It answers `gateway_status` with the reason, returns a clear error for every
 * other tool, and never touches the link port, the db or the relay. The owner keeps watching the
 * link port and swaps this session out when it can relay or take over.
 */
export function createStandbyServer(opts: { version: string; reason: string }): Server {
  const status = `Standby: another gateway is primary with different settings (${opts.reason}). This instance keeps its session and takes over when that gateway goes away.`;
  const server = new Server(
    { name: 'foundry-agent-gateway', version: opts.version },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: [
      {
        name: STATUS_TOOL,
        description: 'Explains why this standby gateway instance is not serving Foundry tools.',
        inputSchema: { type: 'object' as const, properties: {}, additionalProperties: false },
      },
    ],
  }));
  server.setRequestHandler(CallToolRequestSchema, (req) =>
    req.params.name === STATUS_TOOL
      ? { content: [{ type: 'text' as const, text: status }] }
      : {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: `LINK_UNAVAILABLE: another gateway is primary with different settings (${opts.reason}); this standby instance cannot serve ${safeText(req.params.name)}. Call ${STATUS_TOOL} for details, or restart the clients so every instance uses the same settings.`,
            },
          ],
        },
  );
  return server;
}
