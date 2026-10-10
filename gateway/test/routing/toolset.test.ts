import { afterEach, describe, expect, it } from 'vitest';
import { ToolsetStore } from '../../src/routing/index.js';
import { startServer, type Harness } from '../link/helpers.js';
import {
  expectErrorCode,
  openSession,
  pairModule,
  tick,
  until,
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

const names = async (s: McpSession) => (await s.client.listTools()).tools.map((t) => t.name);

async function start(isGM: boolean, selector: { user?: string } = {}) {
  h = await startServer();
  const m = await pairModule(h, 'uA', { userName: 'alice', isGM });
  modules.push(m);
  const toolsets = new ToolsetStore();
  const s = await openSession(h, selector, undefined, 5000, {
    toolsets,
    listChangedIntervalMs: 20,
  });
  sessions.push(s);
  const conn = h.registry.list()[0]!;
  return { m, s, toolsets, conn };
}

describe('announced tool sets', () => {
  it('lists the role tools until the module announces a set', async () => {
    const { s } = await start(true);
    expect(await names(s)).toEqual(['fixture_tool', 'fixture_gm_tool']);
  });

  it('lists exactly the announced tools, and a GM tool is hidden when not announced', async () => {
    const { s, toolsets, conn } = await start(true);
    await names(s);
    toolsets.set(conn, ['fixture_tool']);
    expect(await names(s)).toEqual(['fixture_tool']);
  });

  it('notifies once per change, never for an identical set or a list the client already has', async () => {
    const { s, toolsets, conn } = await start(true);
    await names(s);
    toolsets.set(conn, ['fixture_tool']);
    await until(() => s.listChanged.count === 1);
    toolsets.set(conn, ['fixture_tool']);
    toolsets.set(conn, ['fixture_tool', 'fixture_tool']);
    await tick(80);
    expect(s.listChanged.count).toBe(1);
    // Two quick changes that end where the client already is notify nothing.
    toolsets.set(conn, ['fixture_tool', 'fixture_gm_tool']);
    toolsets.set(conn, ['fixture_tool']);
    await tick(80);
    expect(s.listChanged.count).toBe(1);
    // A change in the list order of announcement is not a change.
    toolsets.set(conn, ['fixture_gm_tool', 'fixture_tool']);
    await until(() => s.listChanged.count === 2);
    expect(await names(s)).toEqual(['fixture_tool', 'fixture_gm_tool']);
  });

  it('follows a role change: a promoted player gains the GM tool', async () => {
    const { s, toolsets, conn } = await start(false);
    toolsets.set(conn, ['fixture_tool']);
    expect(await names(s)).toEqual(['fixture_tool']);
    toolsets.set(conn, ['fixture_tool', 'fixture_gm_tool']);
    await until(() => s.listChanged.count === 1);
    expect(await names(s)).toEqual(['fixture_tool', 'fixture_gm_tool']);
  });

  it('answers FORBIDDEN for a tool outside the set without a link round-trip', async () => {
    const { m, s, toolsets, conn } = await start(true);
    toolsets.set(conn, ['fixture_tool']);
    const res = await s.client.callTool({ name: 'fixture_gm_tool', arguments: {} });
    expectErrorCode(res, 'FORBIDDEN');
    expect(m.tc.messages).toEqual([]);
  });

  it('ignores announcements for other users connections', async () => {
    const { s, toolsets } = await start(true, { user: 'alice' });
    const other = await pairModule(h!, 'uB', { userName: 'bob' });
    modules.push(other);
    await names(s);
    const bob = h!.registry.get('w1', 'uB')!;
    toolsets.set(bob, []);
    await tick(80);
    expect(s.listChanged.count).toBe(0);
    expect(await names(s)).toEqual(['fixture_tool', 'fixture_gm_tool']);
  });

  it('starts a reconnected link with no set rather than inheriting the old one', async () => {
    const { toolsets, conn, m } = await start(true);
    toolsets.set(conn, []);
    expect(toolsets.get(conn)).toEqual([]);
    expect(toolsets.get(h!.registry.get('w1', m.userId)!)).toEqual([]);
    const fresh = await pairModule(h!, 'uC', { userName: 'carol' });
    modules.push(fresh);
    expect(toolsets.get(h!.registry.get('w1', 'uC')!)).toBeUndefined();
  });
});
