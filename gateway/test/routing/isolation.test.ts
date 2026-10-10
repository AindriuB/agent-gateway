import { afterEach, describe, expect, it } from 'vitest';
import { startServer, type Harness } from '../link/helpers.js';
import {
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

async function setup() {
  h = await startServer();
  const a = await pairModule(h, 'uA', { userName: 'alice' });
  const b = await pairModule(h, 'uB', { userName: 'bob' });
  modules.push(a, b);
  const sa = await openSession(h, { world: 'w1', user: 'uA' });
  const sb = await openSession(h, { world: 'w1', user: 'uB' });
  sessions.push(sa, sb);
  return { h, a, b, sa, sb };
}

const callFixture = (s: McpSession, a = 'x') =>
  s.client.callTool({ name: 'fixture_tool', arguments: { a } });

type CallFrame = { type: 'call'; id: string; sessionId: string; tool: string; args: unknown };

/** Fails the test if the socket has received anything since it paired. */
const expectSilent = async (m: FakeModule) => {
  await tick();
  expect(m.tc.messages).toEqual([]);
};

describe('session isolation', () => {
  it('a call from a session bound to A reaches A only', async () => {
    const { a, b, sa } = await setup();
    const pending = callFixture(sa, 'for-a');
    const frame = (await a.tc.next('call')) as CallFrame;
    expect(frame.tool).toBe('fixture_tool');
    expect(frame.args).toEqual({ a: 'for-a' });
    await expectSilent(b);
    a.tc.send({ type: 'result', id: frame.id, ok: true, text: 'from A', structured: { b: 'A' } });
    const res = await pending;
    expect(res.structuredContent).toEqual({ b: 'A' });
    await expectSilent(b);
  });

  it('A reconnecting leaves B listed and B in-flight call still settles with its result', async () => {
    const { h, a, b, sa, sb } = await setup();
    const pendingB = callFixture(sb, 'for-b');
    const frameB = (await b.tc.next('call')) as CallFrame;

    const a2 = await reconnectModule(h, a);
    modules.push(a2);
    await a.tc.untilClosed();
    expect(
      h.registry
        .list()
        .map((c) => c.userId)
        .sort(),
    ).toEqual(['uA', 'uB']);
    expect(h.registry.get('w1', 'uB')).toBeDefined();

    b.tc.send({ type: 'result', id: frameB.id, ok: true, text: 'from B', structured: { b: 'B' } });
    const res = await pendingB;
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent).toEqual({ b: 'B' });

    // The session bound to A now reaches the new A connection, and still not B.
    const pendingA = callFixture(sa);
    const frameA = (await a2.tc.next('call')) as CallFrame;
    await expectSilent(b);
    a2.tc.send({ type: 'result', id: frameA.id, ok: true, text: 'a2', structured: { b: 'A2' } });
    expect((await pendingA).structuredContent).toEqual({ b: 'A2' });
  });

  it("B's result and error frames carrying A's call id do not settle A's call", async () => {
    const { a, b, sa } = await setup();
    let settled = false;
    const pendingA = callFixture(sa).finally(() => (settled = true));
    const frameA = (await a.tc.next('call')) as CallFrame;

    b.tc.send({ type: 'result', id: frameA.id, ok: true, text: 'forged', structured: { b: 'B' } });
    b.tc.send({ type: 'error', id: frameA.id, code: 'DENIED', message: 'forged' });
    // Frames on one socket are handled in order, so the pong proves both were processed.
    b.tc.send({ type: 'ping' });
    await b.tc.next('pong');
    await tick();
    expect(settled).toBe(false);

    a.tc.send({ type: 'result', id: frameA.id, ok: true, text: 'real', structured: { b: 'A' } });
    const res = await pendingA;
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent).toEqual({ b: 'A' });
    expect(JSON.stringify(res.content)).toContain('real');
  });

  it('after A disconnects the session bound to A is offline, not rerouted to B', async () => {
    const { h, a, b, sa } = await setup();
    // Warm-up call so the session is bound to A before A goes away.
    const warm = callFixture(sa);
    const wf = (await a.tc.next('call')) as CallFrame;
    a.tc.send({ type: 'result', id: wf.id, ok: true, text: 'warm', structured: { b: 'A' } });
    await warm;
    a.tc.ws.close();
    await until(() => h.registry.get('w1', 'uA') === undefined);
    expect(h.registry.get('w1', 'uB')).toBeDefined();

    const res = await callFixture(sa);
    expect(res.isError).toBe(true);
    expect(res.structuredContent).toEqual({ code: 'WORLD_OFFLINE' });
    await expectSilent(b);

    const a2 = await reconnectModule(h, a);
    modules.push(a2);
    const pending = callFixture(sa);
    const frame = (await a2.tc.next('call')) as CallFrame;
    a2.tc.send({ type: 'result', id: frame.id, ok: true, text: 'back', structured: { b: 'A' } });
    expect((await pending).structuredContent).toEqual({ b: 'A' });
    await expectSilent(b);
  });

  it('an implicit single-connection binding is recorded as that pair, not "whatever is connected"', async () => {
    h = await startServer();
    const a = await pairModule(h, 'uA', { userName: 'alice' });
    modules.push(a);
    const s = await openSession(h); // no selector: binds to the only connection, A
    sessions.push(s);
    const first = callFixture(s);
    const f1 = (await a.tc.next('call')) as CallFrame;
    a.tc.send({ type: 'result', id: f1.id, ok: true, text: 'ok', structured: { b: 'A' } });
    await first;

    const b = await pairModule(h, 'uB', { userName: 'bob' });
    modules.push(b);
    a.tc.ws.close();
    await until(() => h!.registry.get('w1', 'uA') === undefined);
    // Exactly one connection exists again (B), but the session is A's.
    const res = await callFixture(s);
    expect(res.structuredContent).toEqual({ code: 'WORLD_OFFLINE' });
    await expectSilent(b);
  });

  it('with several connections and no selector, a call errors listing the available pairs', async () => {
    h = await startServer();
    const a = await pairModule(h, 'uA', { userName: 'alice' });
    const b = await pairModule(h, 'uB', { userName: 'bob' });
    modules.push(a, b);
    const s = await openSession(h);
    sessions.push(s);
    const res = await callFixture(s);
    expect(res.isError).toBe(true);
    const text = JSON.stringify(res.content);
    expect(text).toContain('alice');
    expect(text).toContain('bob');
    expect(text).toContain('w1');
    await expectSilent(a);
    await expectSilent(b);
  });
});
