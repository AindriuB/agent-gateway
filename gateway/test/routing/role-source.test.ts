import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config/index.js';
import { startServer, type Harness } from '../link/helpers.js';
import {
  expectErrorCode,
  openSession,
  pairModule,
  type FakeModule,
  type McpSession,
} from './harness.js';

let h: Harness | undefined;
const sessions: McpSession[] = [];
const modules: FakeModule[] = [];
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((s) => s.close()));
  modules.splice(0).forEach((m) => m.tc.ws.terminate());
  await h?.server.close();
  h?.store.close();
  h = undefined;
});

async function start(isGM: boolean) {
  h = await startServer();
  modules.push(await pairModule(h, 'uA', { userName: 'alice', isGM }));
  const s = await openSession(h);
  sessions.push(s);
  return s;
}
const names = async (s: McpSession, meta?: Record<string, unknown>) =>
  (await s.client.listTools(meta ? { _meta: meta } : undefined)).tools
    .filter((t) => t.name !== 'gateway_status')
    .map((t) => t.name);

// The tier is read from the authenticated hello, so no gateway setting can be involved. Loading the
// config with each value proves that setting changes nothing about the session built beside it.
describe.each([undefined, 'gm', 'player'])('tool tier with AGENT_GATEWAY_ROLE=%s', (role) => {
  it('loads the config without a role', () => {
    const config = loadConfig({ env: role ? { AGENT_GATEWAY_ROLE: role } : {} });
    expect('role' in config).toBe(false);
  });

  it('a GM user lists the GM tool', async () => {
    loadConfig({ env: role ? { AGENT_GATEWAY_ROLE: role } : {} });
    expect(await names(await start(true))).toEqual(['fixture_tool', 'fixture_gm_tool']);
  });

  it('a player does not list it, and calling it is FORBIDDEN', async () => {
    loadConfig({ env: role ? { AGENT_GATEWAY_ROLE: role } : {} });
    const s = await start(false);
    expect(await names(s)).toEqual(['fixture_tool']);
    expectErrorCode(
      await s.client.callTool({ name: 'fixture_gm_tool', arguments: {} }),
      'FORBIDDEN',
    );
  });
});

describe('MCP input cannot choose the tier', () => {
  it('ignores _meta.role and a role argument from a player session', async () => {
    const s = await start(false);
    expect(await names(s, { role: 'gm' })).toEqual(['fixture_tool']);
    const res = await s.client.callTool({
      name: 'fixture_gm_tool',
      arguments: { role: 'gm' },
      _meta: { role: 'gm' },
    });
    expectErrorCode(res, 'FORBIDDEN');
    expect(modules[0]!.tc.messages).toEqual([]);
  });
});
