import { afterEach, describe, expect, it } from 'vitest';
import { TOOLS } from '@agent-gateway/protocol';
import { ToolsetStore } from '../../src/routing/toolsets.js';
import { startServer, type Harness } from '../link/helpers.js';
import { openSession, pairModule, type FakeModule, type McpSession } from '../routing/harness.js';
import { FIXTURE_PACK_TOOL, coreAnnouncements } from './fake-module.js';

let h: Harness | undefined;
let m: FakeModule | undefined;
let s: McpSession | undefined;
afterEach(async () => {
  await s?.close();
  m?.tc.ws.terminate();
  await h?.server.close();
  h?.store.close();
});

describe('emitted tool schemas', () => {
  it('follow the cross-vendor rules for core and pack tools', async () => {
    h = await startServer();
    m = await pairModule(h, 'gm', { isGM: true });
    const store = new ToolsetStore(() => undefined);
    store.set(h.registry.get('w1', 'gm')!, [...coreAnnouncements(), FIXTURE_PACK_TOOL as never]);
    s = await openSession(h, { user: 'gm' }, TOOLS, 5000, { toolsets: store });
    const tools = (await s.client.listTools()).tools;
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
