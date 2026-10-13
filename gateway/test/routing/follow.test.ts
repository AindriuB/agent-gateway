import { afterEach, describe, expect, it } from 'vitest';
import { REBIND_GRACE_MS } from '../../src/routing/index.js';
import { MAX_REBIND_NOTICES, REBIND_NOTICE_WINDOW_MS } from '../../src/mcp/session.js';
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
const calls = (m: FakeModule) =>
  m.tc.messages.filter((x) => (x as { type?: string }).type === 'call');
const silent = async (...ms: FakeModule[]) => {
  await tick();
  for (const m of ms) expect(calls(m)).toEqual([]);
};
const answer = async (m: FakeModule, p: Promise<unknown>) => {
  const frame = (await m.tc.next('call')) as { id: string; sessionId: string };
  m.tc.send({ type: 'result', id: frame.id, ok: true, text: 't', structured: { b: 'B' } });
  return { res: (await p) as { isError?: boolean }, sessionId: frame.sessionId };
};
const drop = async (m: FakeModule) => {
  m.tc.ws.terminate();
  await until(() => h!.registry.get(m.worldId, m.userId) === undefined);
};
const add = async (userId: string, opts = {}) => {
  const m = await pairModule(h!, userId, { userName: userId, ...opts });
  modules.push(m);
  return m;
};

describe('follow mode', () => {
  it('routes to the one connected pairing; the offline one gets nothing', async () => {
    h = await startServer();
    const a = await add('uA');
    const b = await add('uB');
    await drop(a);
    const s = await openSession(h);
    sessions.push(s);
    expect((await answer(b, call(s))).res.isError).toBeFalsy();
    await silent(a);
  });

  it('re-binds when the bound user leaves and another connects: same sessionId, list_changed, one notice', async () => {
    h = await startServer();
    const a = await add('uA');
    const lines: string[] = [];
    const s = await openSession(h, {}, undefined, 5000, {
      log: (l) => lines.push(l),
      listChangedIntervalMs: 5,
    });
    sessions.push(s);
    const first = await answer(a, call(s));
    expect(lines.filter((l) => l.includes('Bound MCP session'))).toHaveLength(1);
    await drop(a);
    const b = await add('uB', { worldId: 'w2' });
    const second = await answer(b, call(s));
    expect(second.sessionId).toBe(first.sessionId);
    await until(() => s.listChanged.count >= 1 && s.notices.some((n) => n.logger === 'binding'));
    const rebound = lines.filter((l) => l.includes('re-bound from'));
    expect(rebound).toEqual([
      `MCP session ${first.sessionId.slice(0, 8)} re-bound from uA in w1 to uB in w2 (the only connected pairing).`,
    ]);
    expect(s.notices.filter((n) => n.logger === 'binding')).toMatchObject([
      { level: 'notice', data: rebound[0] },
    ]);
    await silent(a);
  });

  it('does not re-bind on a blip, but does once the bound pair has been away for the grace period', async () => {
    h = await startServer();
    let t = 1_000_000;
    const a = await add('uA');
    const s = await openSession(h, {}, undefined, 5000, { now: () => t });
    sessions.push(s);
    await answer(a, call(s));
    const b = await add('uB');
    await drop(a);
    t += REBIND_GRACE_MS - 1;
    const a2 = await reconnectModule(h, a);
    modules.push(a2);
    expect((await answer(a2, call(s))).res.isError).toBeFalsy();
    await silent(b);
    await drop(a2);
    t += REBIND_GRACE_MS - 1;
    // Still inside the grace period: offline, not B.
    expectErrorCode(await call(s), 'WORLD_OFFLINE');
    await silent(b);
    t += 1;
    expect((await answer(b, call(s))).res.isError).toBeFalsy();
  });

  // End to end, and timing-dependent: the real flush timer may clear the clock before the second
  // drop. The deterministic check is in binding.test.ts.
  it('every outage gets the full grace period, even with no call between drop and reconnect', async () => {
    h = await startServer();
    let t = 1_000_000;
    const a = await add('uA');
    const s = await openSession(h, {}, undefined, 5000, { now: () => t });
    sessions.push(s);
    await answer(a, call(s));
    const b = await add('uB');
    await drop(a);
    t += REBIND_GRACE_MS - 1;
    const a2 = await reconnectModule(h, a);
    modules.push(a2);
    await drop(a2);
    t += 2;
    // 2 ms into the second outage, not 30 s: still A's.
    expectErrorCode(await call(s), 'WORLD_OFFLINE');
    await silent(b);
    t += REBIND_GRACE_MS;
    expect((await answer(b, call(s))).res.isError).toBeFalsy();
  });

  it('stays bound to a connected pair while another is also connected', async () => {
    h = await startServer();
    const a = await add('uA');
    const s = await openSession(h);
    sessions.push(s);
    await answer(a, call(s));
    const b = await add('uB');
    expect((await answer(a, call(s))).res.isError).toBeFalsy();
    await silent(b);
  });

  it('answers ambiguity while the bound pair is away and two others are connected, and stays bound', async () => {
    h = await startServer();
    const a = await add('uA');
    const s = await openSession(h);
    sessions.push(s);
    await answer(a, call(s));
    // B and C connect after A's departure: B's connect re-binds immediately, so connect both first.
    const b = await add('uB');
    const c = await add('uC');
    await drop(a);
    const res = await call(s);
    expectErrorCode(res, 'INVALID_ARGS');
    expect(JSON.stringify(res.content)).toContain('uB');
    expect(JSON.stringify(res.content)).toContain('uC');
    await silent(b, c);
  });

  it('an explicit --user never re-binds', async () => {
    h = await startServer();
    let t = 0;
    const a = await add('uA');
    const s = await openSession(h, { user: 'uA' }, undefined, 5000, { now: () => t });
    sessions.push(s);
    await answer(a, call(s));
    await drop(a);
    const b = await add('uB');
    t += 10 * REBIND_GRACE_MS;
    expectErrorCode(await call(s), 'WORLD_OFFLINE');
    await silent(b);
  });

  it('a revoked bound pairing unbinds the session, which then follows the connected one', async () => {
    h = await startServer();
    const a = await add('uA');
    const s = await openSession(h);
    sessions.push(s);
    await answer(a, call(s));
    const b = await add('uB');
    h.store.revokePairing(a.agentId);
    expect((await answer(b, call(s))).res.isError).toBeFalsy();
    await silent(a);
  });

  it('a call in flight on A is never resent to B after the re-bind', async () => {
    h = await startServer();
    const a = await add('uA');
    const s = await openSession(h);
    sessions.push(s);
    const pending = call(s);
    await a.tc.next('call');
    await drop(a);
    expectErrorCode((await pending) as Record<string, unknown>, 'WORLD_OFFLINE');
    const b = await add('uB');
    await silent(b);
    expect((await answer(b, call(s))).res.isError).toBeFalsy();
    expect(calls(b)).toHaveLength(0);
  });
});

describe('re-bind notices are bounded', () => {
  it('caps stderr lines and MCP notices per window, and resumes in the next window', async () => {
    h = await startServer();
    let t = 5_000_000;
    const a = await add('uA');
    const b = await add('uB');
    await drop(b);
    const lines: string[] = [];
    const s = await openSession(h, {}, undefined, 5000, {
      log: (l) => lines.push(l),
      now: () => t,
      listChangedIntervalMs: 5,
    });
    sessions.push(s);
    await answer(a, call(s));
    const st = { cur: a, other: b };
    const flap = async (rounds: number) => {
      for (let i = 0; i < rounds; i++) {
        await drop(st.cur);
        const back = await reconnectModule(h!, st.other);
        modules.push(back);
        [st.cur, st.other] = [back, st.cur];
      }
      await tick(30);
    };
    const rebinds = () => lines.filter((l) => l.includes('re-bound from')).length;
    await flap(20);
    expect(rebinds()).toBe(20); // stderr is never capped
    expect(s.notices.filter((n) => n.logger === 'binding')).toHaveLength(MAX_REBIND_NOTICES);
    t += REBIND_NOTICE_WINDOW_MS;
    await flap(1);
    expect(rebinds()).toBe(21);
    expect(s.notices.filter((n) => n.logger === 'binding')).toHaveLength(MAX_REBIND_NOTICES + 1);
    // The session still follows the connected pairing even when the notice was suppressed.
    expect((await answer(st.cur, call(s))).res.isError).toBeFalsy();
  });
});
