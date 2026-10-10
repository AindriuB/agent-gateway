import { afterEach, describe, expect, it } from 'vitest';
import { startServer, type Harness } from '../link/helpers.js';
import {
  expectErrorCode,
  openSession,
  pairModule,
  reconnectModule,
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

const call = (s: McpSession) => s.client.callTool({ name: 'fixture_tool', arguments: { a: 'x' } });
const silent = async (...ms: FakeModule[]) => {
  await tick();
  for (const m of ms) expect(m.tc.messages).toEqual([]);
};

describe('binding by user name', () => {
  it('ignores the name a reconnect claims in hello (Bob claiming to be alice)', async () => {
    h = await startServer();
    const alice = await pairModule(h, 'uA', { userName: 'alice' });
    const bob = await pairModule(h, 'uB', { userName: 'bob' });
    modules.push(alice, bob);
    alice.tc.ws.close();
    await until(() => h!.registry.get('w1', 'uA') === undefined);
    const bob2 = await reconnectModule(h, bob, { claimName: 'alice' });
    modules.push(bob2);

    const s = await openSession(h, { user: 'alice' });
    sessions.push(s);
    expectErrorCode(await call(s), 'WORLD_OFFLINE');
    await silent(bob2);
  });

  it('keeps the recorded name for display and binding after a reconnect with another name', async () => {
    h = await startServer();
    const bob = await pairModule(h, 'uB', { userName: 'bob' });
    modules.push(bob);
    const bob2 = await reconnectModule(h, bob, { claimName: 'mallory' });
    modules.push(bob2);
    expect(h.registry.get('w1', 'uB')?.info.userName).toBe('bob');
    const byRecorded = await openSession(h, { user: 'bob' });
    sessions.push(byRecorded);
    const p = call(byRecorded);
    const frame = (await bob2.tc.next('call')) as { id: string };
    bob2.tc.send({ type: 'result', id: frame.id, ok: true, text: 't', structured: { b: 'B' } });
    expect((await p).isError).toBeFalsy();
    const byClaim = await openSession(h, { user: 'mallory' });
    sessions.push(byClaim);
    expectErrorCode(await call(byClaim), 'WORLD_OFFLINE');
    await silent(bob2);
  });

  it('treats a name shared by two paired users as ambiguous, even if one is offline', async () => {
    h = await startServer();
    const s1 = await pairModule(h, 'uA', { userName: 'sam' });
    const s2 = await pairModule(h, 'uB', { userName: 'sam' });
    modules.push(s1, s2);
    const both = await openSession(h, { user: 'sam' });
    sessions.push(both);
    expectErrorCode(await call(both), 'INVALID_ARGS');
    await silent(s1, s2);

    s2.tc.ws.close();
    await until(() => h!.registry.get('w1', 'uB') === undefined);
    const oneOffline = await openSession(h, { user: 'sam' });
    sessions.push(oneOffline);
    expectErrorCode(await call(oneOffline), 'INVALID_ARGS');
    await silent(s1);
  });

  it('prefers an exact id match over another user whose name equals that id', async () => {
    h = await startServer();
    const named = await pairModule(h, 'uA', { userName: 'uB' }); // name equals the other's id
    const target = await pairModule(h, 'uB', { userName: 'carol' });
    modules.push(named, target);
    const s = await openSession(h, { user: 'uB' });
    sessions.push(s);
    const p = call(s);
    const frame = (await target.tc.next('call')) as { id: string };
    target.tc.send({ type: 'result', id: frame.id, ok: true, text: 't', structured: { b: 'B' } });
    await p;
    await silent(named);
  });
});

describe('implicit binding', () => {
  it('does not bind on a disconnect and never falls back to the survivor', async () => {
    h = await startServer();
    const a = await pairModule(h, 'uA', { userName: 'alice' });
    const b = await pairModule(h, 'uB', { userName: 'bob' });
    modules.push(a, b);
    const s = await openSession(h);
    sessions.push(s);
    expectErrorCode(await call(s), 'INVALID_ARGS');
    a.tc.ws.close();
    await until(() => h!.registry.get('w1', 'uA') === undefined);
    const res = await call(s);
    expect(res.isError).toBe(true);
    await silent(b);
  });

  it('prints one line when it binds implicitly, and none when --user chose', async () => {
    h = await startServer();
    const a = await pairModule(h, 'uA', { userName: 'alice' });
    modules.push(a);
    const lines: string[] = [];
    const implicit = await openSession(h, {}, undefined, 5000, { log: (l) => lines.push(l) });
    sessions.push(implicit);
    await implicit.client.listTools();
    const p = call(implicit);
    const frame = (await a.tc.next('call')) as { id: string };
    a.tc.send({ type: 'result', id: frame.id, ok: true, text: 't', structured: { b: 'A' } });
    await p;
    expect(lines).toEqual(['Bound MCP session to alice in w1; start with --user to choose.']);

    const explicit = await openSession(h, { user: 'alice' }, undefined, 5000, {
      log: (l) => lines.push(l),
    });
    sessions.push(explicit);
    await explicit.client.listTools();
    expect(lines).toHaveLength(1);
  });
});

describe('list_changed coalescing', () => {
  it('sends nothing for 20 token reconnects that leave the tool list unchanged', async () => {
    h = await startServer();
    let m = await pairModule(h, 'uA', { userName: 'alice', isGM: true });
    modules.push(m);
    const s = await openSession(h, { user: 'alice' });
    sessions.push(s);
    await s.client.listTools();
    const base = s.listChanged.count;
    for (let i = 0; i < 20; i++) {
      m = await reconnectModule(h, m, { isGM: true });
      modules.push(m);
    }
    await tick(400);
    expect(s.listChanged.count - base).toBeLessThanOrEqual(2);
  });

  it('rate-limits notifications when the list really flips on each reconnect', async () => {
    h = await startServer();
    let m = await pairModule(h, 'uA', { userName: 'alice', isGM: true });
    modules.push(m);
    const s = await openSession(h, { user: 'alice' });
    sessions.push(s);
    await s.client.listTools();
    const base = s.listChanged.count;
    const t0 = Date.now();
    for (let i = 0; i < 20; i++) {
      m = await reconnectModule(h, m, { isGM: i % 2 === 1 });
      modules.push(m);
    }
    const elapsed = Date.now() - t0;
    await tick(400);
    expect(s.listChanged.count - base).toBeLessThanOrEqual(Math.floor(elapsed / 250) + 2);
  });
});
