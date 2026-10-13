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
  for (const m of ms)
    expect(m.tc.messages.filter((x) => (x as { type?: string }).type === 'call')).toEqual([]);
};
const answer = async (m: FakeModule, p: Promise<unknown>) => {
  const frame = (await m.tc.next('call')) as { id: string };
  m.tc.send({ type: 'result', id: frame.id, ok: true, text: 't', structured: { b: 'B' } });
  return (await p) as { isError?: boolean };
};

describe('implicit binding does not depend on connection timing', () => {
  it('two paired, only A connected: follows A and nothing is sent to B', async () => {
    h = await startServer();
    const a = await pairModule(h, 'uA', { userName: 'alice' });
    const b = await pairModule(h, 'uB', { userName: 'bob' });
    modules.push(a, b);
    b.tc.ws.close();
    await until(() => h!.registry.get('w1', 'uB') === undefined);
    const s = await openSession(h);
    sessions.push(s);
    expect((await answer(a, call(s))).isError).toBeFalsy();
    await silent(b);
  });

  for (const order of [
    ['uA', 'uB'],
    ['uB', 'uA'],
  ] as const) {
    it(`two paired, both reconnect (${order.join(' then ')}) before the session starts: ambiguity`, async () => {
      h = await startServer();
      const a = await pairModule(h, 'uA', { userName: 'alice' });
      const b = await pairModule(h, 'uB', { userName: 'bob' });
      a.tc.ws.close();
      b.tc.ws.close();
      await until(() => h!.registry.list().length === 0);
      const mods: FakeModule[] = [];
      for (const id of order) {
        const m = await reconnectModule(h, id === 'uA' ? a : b);
        mods.push(m);
        modules.push(m);
      }
      const s = await openSession(h);
      sessions.push(s);
      const res = await call(s);
      expectErrorCode(res, 'INVALID_ARGS');
      expect(JSON.stringify(res.content)).toContain('alice');
      expect(JSON.stringify(res.content)).toContain('bob');
      await silent(...mods);
    });
  }

  it('one paired identity that is not connected: WORLD_OFFLINE, then works once connected', async () => {
    h = await startServer();
    const a = await pairModule(h, 'uA', { userName: 'alice' });
    a.tc.ws.close();
    await until(() => h!.registry.list().length === 0);
    const s = await openSession(h);
    sessions.push(s);
    expectErrorCode(await call(s), 'WORLD_OFFLINE');
    const a2 = await reconnectModule(h, a);
    modules.push(a2);
    expect((await answer(a2, call(s))).isError).toBeFalsy();
  });

  it('a fresh store: pair once, then call binds and works', async () => {
    h = await startServer();
    const s = await openSession(h);
    sessions.push(s);
    expectErrorCode(await call(s), 'WORLD_OFFLINE');
    const a = await pairModule(h, 'uA', { userName: 'alice' });
    modules.push(a);
    expect((await answer(a, call(s))).isError).toBeFalsy();
  });

  it('--world w1 with one identity in w1 and one in w2 binds to the w1 identity', async () => {
    h = await startServer();
    const a = await pairModule(h, 'uA', { userName: 'alice', worldId: 'w1' });
    const b = await pairModule(h, 'uB', { userName: 'bob', worldId: 'w2' });
    modules.push(a, b);
    const s = await openSession(h, { world: 'w1' });
    sessions.push(s);
    expect((await answer(a, call(s))).isError).toBeFalsy();
    await silent(b);
  });

  it('a session bound to an offline single pairing moves to another user who pairs and connects', async () => {
    h = await startServer();
    const a = await pairModule(h, 'uA', { userName: 'alice' });
    a.tc.ws.close();
    await until(() => h!.registry.list().length === 0);
    const s = await openSession(h);
    sessions.push(s);
    expectErrorCode(await call(s), 'WORLD_OFFLINE');
    const b = await pairModule(h, 'uB', { userName: 'bob' });
    modules.push(b);
    expect((await answer(b, call(s))).isError).toBeFalsy();
    // A coming back does not pull the session away from the connected B.
    const a2 = await reconnectModule(h, a);
    modules.push(a2);
    expect((await answer(b, call(s))).isError).toBeFalsy();
    await silent(a2);
  });

  it('does not bind implicitly to a pairing revoked while still connected', async () => {
    h = await startServer();
    const b = await pairModule(h, 'uB', { userName: 'bob' });
    modules.push(b);
    for (const row of h.store.listActivePairings()) h.store.revokePairing(row.id);
    const s = await openSession(h);
    sessions.push(s);
    expectErrorCode(await call(s), 'WORLD_OFFLINE');
    await silent(b);
  });
});
