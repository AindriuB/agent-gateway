import { afterEach, describe, expect, it } from 'vitest';
import { TOOLS } from '@agent-gateway/protocol';
import { ToolsetStore } from '../../src/routing/toolsets.js';
import { startServer, type Harness } from '../link/helpers.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { EventBuffer } from '../../src/events/index.js';
import { createSessionServer } from '../../src/mcp/session.js';
import { pairModule, type FakeModule } from '../routing/harness.js';
import { FIXTURE_PACK_TOOL, coreAnnouncements } from './fake-module.js';

let h: Harness | undefined;
let m: FakeModule | undefined;
let client: Client | undefined;
let events: EventBuffer | undefined;
afterEach(async () => {
  await client?.close();
  events?.close();
  m?.tc.ws.terminate();
  await h?.server.close();
  h?.store.close();
});

describe('emitted tool schemas', () => {
  it('follow the cross-vendor rules for core and pack tools', async () => {
    h = await startServer();
    m = await pairModule(h, 'gm', { isGM: true });
    const store = new ToolsetStore(() => undefined);
    const conn = h.registry.get('w1', 'gm')!;
    // Event reading authorized (module's eventReadAllowed) and offline history enabled for the world:
    // this is what makes the gateway-handled events_poll and events_history appear.
    store.set(conn, [...coreAnnouncements(), FIXTURE_PACK_TOOL as never], true);
    h.store.events.setPolicy('w1', { enabled: true, retentionDays: 7 });
    events = new EventBuffer(h.store, h.registry, store);
    const server = createSessionServer({
      version: '0.0.0',
      registry: h.registry,
      selector: { user: 'gm' },
      tools: TOOLS,
      events,
      toolsets: store,
      knownIdentities: () =>
        h!.store
          .listActivePairings()
          .map((p) => ({ worldId: p.worldId, userId: p.userId, userName: p.userName })),
    });
    client = new Client({ name: 't', version: '0' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    const tools = (await client.listTools()).tools;
    // Every conditionally listed tool is present, so none skips the checks below. The only
    // conditions in createSessionServer are role (a GM module sees all module tools), announcement
    // (core and pack tools) and event authorization (events_poll, events_history); all are met.
    const names = tools.map((t) => t.name);
    for (const t of TOOLS) expect(names, t.name).toContain(t.name);
    expect(tools.map((t) => t.name)).toContain('demo-echo');
    expect(tools.length).toBeGreaterThan(1);
    for (const t of tools) {
      expect(t.name, t.name).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
      expect(t.name.length, t.name).toBeLessThanOrEqual(36);
      expect(t.inputSchema.type, t.name).toBe('object');
      expect((t.inputSchema as Record<string, unknown>).additionalProperties, t.name).toBe(false);
      expect(JSON.stringify(t.inputSchema), t.name).not.toContain('"$ref"');
    }
  });
});
