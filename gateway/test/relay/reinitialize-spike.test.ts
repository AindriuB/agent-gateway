// Spike for task 69: can a proxy swap the server session behind an already-initialized client
// by replaying the captured `initialize` + `notifications/initialized` to a fresh server and
// discarding its reply? The client must keep working and must accept list_changed.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it } from 'vitest';
import { LinkRegistry } from '../../src/link/index.js';
import { createSessionServer } from '../../src/mcp/session.js';
import { createDegradedServer, STATUS_TOOL } from '../../src/mcp/degraded.js';

describe('re-initialize spike', () => {
  it('a fresh session accepts a replayed initialize and the client keeps working', async () => {
    const [clientSide, shimClient] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'c', version: '0' });
    let listChanged = 0;
    client.setNotificationHandler(ToolListChangedNotificationSchema, () => void listChanged++);
    let captured: JSONRPCMessage | undefined;
    let current: InMemoryTransport | undefined;
    const attach = async (server: ReturnType<typeof createDegradedServer>) => {
      const [a, b] = InMemoryTransport.createLinkedPair();
      await server.connect(a);
      b.onmessage = (m) => {
        if ('id' in m && m.id === 'replay') return; // discard the replayed initialize reply
        void shimClient.send(m);
      };
      await b.start();
      current = b;
    };
    shimClient.onmessage = (m) => {
      if ('method' in m && m.method === 'initialize') captured = m;
      void current?.send(m);
    };
    await shimClient.start();
    await attach(createDegradedServer({ version: '1', reason: 'first' }));
    await client.connect(clientSide);
    expect((await client.listTools()).tools.map((t) => t.name)).toEqual([STATUS_TOOL]);

    const old = current;
    await attach(createSessionServer({ version: '2', registry: new LinkRegistry() }));
    await old?.close();
    await current?.send({ ...(captured as object), id: 'replay' } as JSONRPCMessage);
    await current?.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    await shimClient.send({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' });

    // A fresh full session answers tools/list for the same, already-initialized client.
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).not.toEqual([STATUS_TOOL]);
    await new Promise((r) => setTimeout(r, 20));
    expect(listChanged).toBe(1);
  });
});
