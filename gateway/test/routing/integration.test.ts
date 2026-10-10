import { afterEach, describe, expect, it } from 'vitest';
import { startServer, type Harness } from '../link/helpers.js';
import {
  openSession,
  pairModule,
  reconnectModule,
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

type CallFrame = { id: string; sessionId: string; tool: string; args: unknown };

async function start(isGM = false) {
  h = await startServer();
  const m = await pairModule(h, 'uA', { userName: 'alice', isGM });
  modules.push(m);
  const s = await openSession(h);
  sessions.push(s);
  return { h, m, s };
}

describe('gateway end to end with a fake module', () => {
  it('lists and calls a fixture tool, then reports WORLD_OFFLINE after disconnect', async () => {
    const { h, m, s } = await start();
    expect((await s.client.listTools()).tools.map((t) => t.name)).toEqual(['fixture_tool']);

    const pending = s.client.callTool({ name: 'fixture_tool', arguments: { a: 'hi' } });
    const frame = (await m.tc.next('call')) as CallFrame;
    expect(frame.tool).toBe('fixture_tool');
    expect(frame.args).toEqual({ a: 'hi' });
    expect(frame.sessionId).not.toBe('');
    m.tc.send({ type: 'result', id: frame.id, ok: true, text: 'hello', structured: { b: 'yo' } });
    const res = await pending;
    expect(res.isError).toBeFalsy();
    expect(res.content).toEqual([{ type: 'text', text: 'hello' }]);
    expect(res.structuredContent).toEqual({ b: 'yo' });

    m.tc.ws.close();
    await until(() => h.registry.list().length === 0);
    // A fresh client: the SDK client validates `structuredContent` of an error result against a
    // tool's outputSchema once it has listed tools, which `{ code }` never satisfies.
    const s2 = await openSession(h);
    sessions.push(s2);
    const off = await s2.client.callTool({ name: 'fixture_tool', arguments: { a: 'hi' } });
    expect(off.isError).toBe(true);
    expect(off.structuredContent).toEqual({ code: 'WORLD_OFFLINE' });
  });

  it('is WORLD_OFFLINE with no connection at all', async () => {
    h = await startServer();
    const s = await openSession(h);
    sessions.push(s);
    const res = await s.client.callTool({ name: 'fixture_tool', arguments: { a: 'x' } });
    expect(res.structuredContent).toEqual({ code: 'WORLD_OFFLINE' });
  });

  it('maps a module error frame to isError with its code', async () => {
    const { m, s } = await start();
    const pending = s.client.callTool({ name: 'fixture_tool', arguments: { a: 'x' } });
    const frame = (await m.tc.next('call')) as CallFrame;
    m.tc.send({ type: 'error', id: frame.id, code: 'DENIED', message: 'no thanks' });
    const res = await pending;
    expect(res.isError).toBe(true);
    expect(res.structuredContent).toEqual({ code: 'DENIED' });
    expect(JSON.stringify(res.content)).toContain('no thanks');
  });

  it('validates args at the gateway and never forwards invalid ones', async () => {
    const { m, s } = await start();
    const res = await s.client.callTool({ name: 'fixture_tool', arguments: { a: 5 } });
    expect(res.isError).toBe(true);
    expect(res.structuredContent).toEqual({ code: 'INVALID_ARGS' });
    expect(m.tc.messages).toEqual([]);
  });

  it('returns UNKNOWN_TOOL for names outside the registry', async () => {
    const { s } = await start();
    const res = await s.client.callTool({ name: 'nope_tool', arguments: {} });
    expect(res.structuredContent).toEqual({ code: 'UNKNOWN_TOOL' });
  });

  it('filters the tool list by the bound user role and hides GM tools from players', async () => {
    const player = await start(false);
    expect((await player.s.client.listTools()).tools.map((t) => t.name)).toEqual(['fixture_tool']);
    const res = await player.s.client.callTool({ name: 'fixture_gm_tool', arguments: {} });
    expect(res.structuredContent).toEqual({ code: 'UNKNOWN_TOOL' });
    expect(player.m.tc.messages).toEqual([]);
  });

  it('lists GM tools for a GM connection', async () => {
    const { s } = await start(true);
    expect((await s.client.listTools()).tools.map((t) => t.name)).toEqual([
      'fixture_tool',
      'fixture_gm_tool',
    ]);
  });

  it('sends tools/list_changed when the bound connection appears and disappears', async () => {
    h = await startServer();
    const s = await openSession(h, { world: 'w1', user: 'alice' });
    sessions.push(s);
    expect((await s.client.listTools()).tools.map((t) => t.name)).toEqual(['fixture_tool']);
    const m = await pairModule(h, 'uA', { userName: 'alice', isGM: true });
    modules.push(m);
    await until(() => s.listChanged.count >= 1);
    expect((await s.client.listTools()).tools).toHaveLength(2);
    const before = s.listChanged.count;
    m.tc.ws.close();
    await until(() => s.listChanged.count > before);
    expect((await s.client.listTools()).tools).toHaveLength(1);
  });

  it('does not notify for other users connections', async () => {
    h = await startServer();
    const s = await openSession(h, { world: 'w1', user: 'alice' });
    sessions.push(s);
    const other = await pairModule(h, 'uB', { userName: 'bob' });
    modules.push(other);
    await until(() => h!.registry.list().length === 1);
    expect(s.listChanged.count).toBe(0);
    const again = await reconnectModule(h, other);
    modules.push(again);
    await until(() => other.tc.closed);
    expect(s.listChanged.count).toBe(0);
  });

  it('selects by user name or id and ignores a non-matching world', async () => {
    h = await startServer();
    const a = await pairModule(h, 'uA', { userName: 'alice', worldId: 'w1' });
    const b = await pairModule(h, 'uB', { userName: 'bob', worldId: 'w2' });
    modules.push(a, b);
    const byName = await openSession(h, { user: 'bob' });
    const wrongWorld = await openSession(h, { world: 'w1', user: 'bob' });
    sessions.push(byName, wrongWorld);
    const p = byName.client.callTool({ name: 'fixture_tool', arguments: { a: 'x' } });
    const frame = (await b.tc.next('call')) as CallFrame;
    b.tc.send({ type: 'result', id: frame.id, ok: true, text: 't', structured: { b: 'B' } });
    await p;
    const off = await wrongWorld.client.callTool({ name: 'fixture_tool', arguments: { a: 'x' } });
    expect(off.structuredContent).toEqual({ code: 'WORLD_OFFLINE' });
    expect(a.tc.messages).toEqual([]);
  });
});
