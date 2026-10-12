import { toJsonSchema, type AnnouncedTool } from '@agent-gateway/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { ToolsetStore } from '../../src/routing/index.js';
import { startServer, type Harness } from '../link/helpers.js';
import {
  expectErrorCode,
  fixtureTool,
  gmFixtureTool,
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

const definition = (name: string): AnnouncedTool => {
  const t = name === 'fixture_gm_tool' ? gmFixtureTool : fixtureTool;
  return {
    name,
    category: t.category,
    minRole: t.minRole,
    description: t.description,
    ...toJsonSchema(t),
  };
};
const set = (store: ToolsetStore, conn: Parameters<ToolsetStore['set']>[0], names: string[]) =>
  store.set(conn, names.map(definition));

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

  it('projects MCP output without mutating canonical or stored announcement schemas', async () => {
    const { s, toolsets, conn } = await start(true);
    const announcement = definition('fixture_tool');
    const before = structuredClone(announcement);
    toolsets.set(conn, [announcement]);
    const stored = structuredClone(toolsets.get(conn));
    const listed = (await s.client.listTools()).tools[0]!;
    expect(listed.outputSchema).toMatchObject({
      type: 'object',
      anyOf: [before.outputSchema, { additionalProperties: false }],
    });
    expect(announcement).toEqual(before);
    expect(toolsets.get(conn)).toEqual(stored);
    expect(toJsonSchema(fixtureTool).outputSchema).toEqual(before.outputSchema);
  });

  it('lists exactly the announced tools, and a GM tool is hidden when not announced', async () => {
    const { s, toolsets, conn } = await start(true);
    await names(s);
    set(toolsets, conn, ['fixture_tool']);
    expect(await names(s)).toEqual(['fixture_tool']);
  });

  it('notifies once per change, never for an identical set or a list the client already has', async () => {
    const { s, toolsets, conn } = await start(true);
    await names(s);
    set(toolsets, conn, ['fixture_tool']);
    await until(() => s.listChanged.count === 1);
    set(toolsets, conn, ['fixture_tool']);
    set(toolsets, conn, ['fixture_tool', 'fixture_tool']);
    await tick(80);
    expect(s.listChanged.count).toBe(1);
    // Two quick changes that end where the client already is notify nothing.
    set(toolsets, conn, ['fixture_tool', 'fixture_gm_tool']);
    set(toolsets, conn, ['fixture_tool']);
    await tick(80);
    expect(s.listChanged.count).toBe(1);
    // A change in the list order of announcement is not a change.
    set(toolsets, conn, ['fixture_gm_tool', 'fixture_tool']);
    await until(() => s.listChanged.count === 2);
    expect(await names(s)).toEqual(['fixture_tool', 'fixture_gm_tool']);
  });

  it('follows a role change: a promoted player gains the GM tool', async () => {
    const { s, toolsets, conn } = await start(false);
    set(toolsets, conn, ['fixture_tool']);
    expect(await names(s)).toEqual(['fixture_tool']);
    set(toolsets, conn, ['fixture_tool', 'fixture_gm_tool']);
    await until(() => s.listChanged.count === 1);
    expect(await names(s)).toEqual(['fixture_tool', 'fixture_gm_tool']);
  });

  it('answers FORBIDDEN for a tool outside the set without a link round-trip', async () => {
    const { m, s, toolsets, conn } = await start(true);
    set(toolsets, conn, ['fixture_tool']);
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
    set(toolsets, bob, []);
    await tick(80);
    expect(s.listChanged.count).toBe(0);
    expect(await names(s)).toEqual(['fixture_tool', 'fixture_gm_tool']);
  });

  it('starts a reconnected link with no set rather than inheriting the old one', async () => {
    const { toolsets, conn, m } = await start(true);
    set(toolsets, conn, []);
    expect(toolsets.get(conn)).toEqual([]);
    expect(toolsets.get(h!.registry.get('w1', m.userId)!)).toEqual([]);
    const fresh = await pairModule(h!, 'uC', { userName: 'carol' });
    modules.push(fresh);
    expect(toolsets.get(h!.registry.get('w1', 'uC')!)).toBeUndefined();
  });
});

describe('ToolsetStore', () => {
  it('emits changed only for a different set, whatever the order or repeats', async () => {
    h = await startServer();
    const m = await pairModule(h, 'uA', { userName: 'alice' });
    modules.push(m);
    const conn = h.registry.list()[0]!;
    const store = new ToolsetStore();
    let n = 0;
    store.on('changed', () => n++);
    set(store, conn, ['bbb', 'aaa']);
    set(store, conn, ['aaa', 'bbb']);
    set(store, conn, ['aaa', 'aaa', 'bbb']);
    expect(n).toBe(1);
    expect(store.get(conn)?.map((t) => t.name)).toEqual(['aaa', 'bbb']);
    set(store, conn, ['aaa']);
    expect(n).toBe(2);
  });
});

describe('toolset frames over the real link', () => {
  const send = (m: FakeModule, tools: string[]) =>
    m.tc.send({ type: 'toolset', tools: tools.map(definition) });

  it('a denied category disappears from tools/list with exactly one list_changed', async () => {
    h = await startServer();
    const m = await pairModule(h, 'uA', { userName: 'alice', isGM: true });
    modules.push(m);
    const s = await openSession(h, {}, undefined, 5000, { listChangedIntervalMs: 20 });
    sessions.push(s);
    expect(await names(s)).toEqual(['fixture_tool', 'fixture_gm_tool']);
    send(m, ['fixture_tool']);
    await until(() => s.listChanged.count === 1);
    send(m, ['fixture_tool']);
    await tick(80);
    expect(s.listChanged.count).toBe(1);
    expect(await names(s)).toEqual(['fixture_tool']);
    expect(m.tc.closed).toBe(false);
  });

  it('a toolset from connection A never changes the list of a session bound to B', async () => {
    h = await startServer();
    const a = await pairModule(h, 'uA', { userName: 'alice', isGM: true });
    const b = await pairModule(h, 'uB', { userName: 'bob', isGM: true });
    modules.push(a, b);
    const sb = await openSession(h, { user: 'uB' }, undefined, 5000, { listChangedIntervalMs: 20 });
    const sa = await openSession(h, { user: 'uA' }, undefined, 5000, { listChangedIntervalMs: 20 });
    sessions.push(sa, sb);
    await names(sa);
    await names(sb);
    send(a, []);
    await until(() => sa.listChanged.count === 1);
    await tick(80);
    expect(sb.listChanged.count).toBe(0);
    expect(await names(sb)).toEqual(['fixture_tool', 'fixture_gm_tool']);
    expect(await names(sa)).toEqual([]);
  });

  it('a malformed toolset still closes the link', async () => {
    h = await startServer();
    const m = await pairModule(h, 'uA', { userName: 'alice' });
    modules.push(m);
    m.tc.send({ type: 'toolset', tools: 'x' });
    await until(() => m.tc.closed);
  });
});

describe('ToolsetStore caps', () => {
  it('ignores a count overflow and retains the previous set', async () => {
    h = await startServer();
    const m = await pairModule(h, 'uA');
    modules.push(m);
    const conn = h.registry.list()[0]!;
    const logs: string[] = [];
    const store = new ToolsetStore((line) => logs.push(line));
    set(store, conn, ['fixture_tool']);
    set(
      store,
      conn,
      Array.from({ length: 65 }, () => 'fixture_tool'),
    );
    expect(store.get(conn)?.map((t) => t.name)).toEqual(['fixture_tool']);
    expect(logs).toEqual(['ignored toolset: announcement count or byte cap exceeded']);
  });
  it.each([false, undefined, true])(
    'invalid definitions cannot preserve or grant event reads (%s)',
    async (allowed) => {
      h = await startServer();
      const m = await pairModule(h, 'uA');
      modules.push(m);
      const conn = h.registry.list()[0]!;
      const store = new ToolsetStore(() => {});
      const tools = [definition('fixture_tool')];
      store.set(conn, tools, true);
      const previous = store.get(conn);
      let changes = 0;
      store.on('changed', () => changes++);
      store.set(conn, ['invalid' as unknown as AnnouncedTool], allowed);
      expect(store.eventReadAllowed(conn)).toBe(false);
      expect(store.get(conn)).toBe(previous);
      expect(changes).toBe(1);
      store.set(conn, ['invalid' as unknown as AnnouncedTool], true);
      expect(store.eventReadAllowed(conn)).toBe(false);
      expect(changes).toBe(1);
      store.set(conn, tools, true);
      expect(store.eventReadAllowed(conn)).toBe(true);
      expect(changes).toBe(2);
    },
  );
});
