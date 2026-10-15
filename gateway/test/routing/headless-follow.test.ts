import { afterEach, describe, expect, it } from 'vitest';
import { knownIdentitiesFor } from '../../src/headless/config/follow.js';
import { REBIND_GRACE_MS } from '../../src/routing/index.js';
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

const AGENT = 'agent1';

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
const add = async (userId: string) => {
  const m = await pairModule(h!, userId, { userName: userId });
  modules.push(m);
  return m;
};
const drop = async (m: FakeModule) => {
  m.tc.ws.terminate();
  await until(() => h!.registry.get(m.worldId, m.userId) === undefined);
};
const answer = async (m: FakeModule, p: Promise<unknown>) => {
  const frame = (await m.tc.next('call')) as { id: string };
  m.tc.send({ type: 'result', id: frame.id, ok: true, text: 't', structured: { b: 'B' } });
  return (await p) as { isError?: boolean };
};

/** A session built the way app.ts builds it: the pool depends on the session's user selector. */
const open = (selector: { world?: string; user?: string; exactId?: boolean }, now?: () => number) =>
  openSession(h!, selector, undefined, 5000, {
    ...(now ? { now } : {}),
    knownIdentities: () =>
      knownIdentitiesFor(
        selector.user,
        () =>
          h!.store
            .listActivePairings()
            .map((p) => ({ worldId: p.worldId, userId: p.userId, userName: p.userName })),
        (_w, u) => u === AGENT,
      ),
    pairingState: (w: string, u: string) => h!.store.pairingStateFor(w, u),
  } as never);

describe('follow mode and the headless agent', () => {
  it('is unbound when only the agent is connected', async () => {
    h = await startServer();
    const agent = await add(AGENT);
    const s = await open({});
    sessions.push(s);
    expectErrorCode((await call(s)) as Record<string, unknown>, 'WORLD_OFFLINE');
    await tick();
    expect(calls(agent)).toEqual([]);
  });

  it('binds to the GM tab and is not ambiguous with the agent connected', async () => {
    h = await startServer();
    const agent = await add(AGENT);
    const gm = await add('gm1');
    const s = await open({});
    sessions.push(s);
    expect((await answer(gm, call(s))).isError).toBeFalsy();
    await tick();
    expect(calls(agent)).toEqual([]);
  });

  it('does not re-bind to the agent after the GM has been away past the grace period', async () => {
    h = await startServer();
    let t = 1_000_000;
    const agent = await add(AGENT);
    const gm = await add('gm1');
    const s = await open({}, () => t);
    sessions.push(s);
    expect((await answer(gm, call(s))).isError).toBeFalsy();
    await drop(gm);
    t += REBIND_GRACE_MS + 1;
    expectErrorCode((await call(s)) as Record<string, unknown>, 'WORLD_OFFLINE');
    await tick();
    expect(calls(agent)).toEqual([]);
  });
});

describe('explicit binding to the agent', () => {
  it('binds with --world and --user while the agent is connected', async () => {
    h = await startServer();
    const agent = await add(AGENT);
    await add('gm1');
    const s = await open({ world: 'w1', user: AGENT });
    sessions.push(s);
    expect((await answer(agent, call(s))).isError).toBeFalsy();
  });

  it('binds to the stored pairing while the agent is offline (bound, not unbound)', async () => {
    h = await startServer();
    const agent = await add(AGENT);
    await drop(agent);
    const s = await open({ world: 'w1', user: AGENT });
    sessions.push(s);
    // Listing the tools binds an exact selector to its stored pairing even while offline.
    await s.client.listTools();
    const res = (await call(s)) as { content: { text: string }[] } & Record<string, unknown>;
    expectErrorCode(res, 'WORLD_OFFLINE');
    expect(res.content[0]!.text).toContain(`user ${AGENT} is not connected`);
    expect(res.content[0]!.text).not.toContain('Not connected to Foundry yet');
  });

  it('keeps the pool of a user-selector session unfiltered (the OAuth exactId path)', async () => {
    h = await startServer();
    const agent = await add(AGENT);
    await drop(agent);
    const s = await open({ world: 'w1', user: AGENT, exactId: true });
    sessions.push(s);
    // Listing the tools binds an exact selector to its stored pairing even while offline.
    await s.client.listTools();
    const res = (await call(s)) as { content: { text: string }[] } & Record<string, unknown>;
    expect(res.content[0]!.text).toContain(`user ${AGENT} is not connected`);
  });
});
