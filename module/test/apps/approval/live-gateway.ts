/** In-process real MCP session and authenticated WebSocket link, with explicit fixture definitions. */
import { TOOLS } from '@agent-gateway/protocol';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { LinkRegistry, LinkServer, PairingCodes } from '../../../../gateway/src/link/index.js';
import { createSessionServer } from '../../../../gateway/src/mcp/session.js';
import { openStore } from '../../../../gateway/src/store/index.js';
import type { E2eConfig, E2ePaths } from '../../../../e2e/lib/config.js';
import { fixtures } from './live-definitions.js';

export async function liveGateway(config: E2eConfig, paths: E2ePaths) {
  const store = openStore(paths.db);
  const registry = new LinkRegistry();
  const link = new LinkServer({
    port: config.linkPort,
    store,
    codes: new PairingCodes(),
    registry,
    allowedOrigins: [config.foundryOrigin],
    gatewayVersion: '0.1.0',
  });
  await link.listen();
  const server = createSessionServer({
    version: '0.1.0',
    registry,
    selector: { world: config.world, user: config.gmUser },
    tools: [...TOOLS, ...fixtures.filter((t) => t.name !== 'fixture_review')],
    knownIdentities: () =>
      store
        .listActivePairings()
        .map((p) => ({ worldId: p.worldId, userId: p.userId, userName: p.userName })),
    log: () => {},
  });
  const client = new Client({ name: 'approval-ui-live-fixture', version: '0.0.0-test' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return {
    user: config.gmUser,
    async call(name: string, args: Record<string, unknown> = {}) {
      const result = await client.callTool({ name, arguments: args });
      const content = (result.content ?? []) as Array<{ type: string; text?: string }>;
      return {
        isError: result.isError === true,
        text: content
          .filter((c) => c.type === 'text')
          .map((c) => c.text ?? '')
          .join('\n'),
        structured: result.structuredContent as Record<string, unknown> | undefined,
        raw: result,
      };
    },
    async stop() {
      await client.close();
      await server.close();
      await link.close();
      store.close();
    },
  };
}
