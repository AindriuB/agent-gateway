/* eslint-disable @typescript-eslint/no-explicit-any */
import { PROTOCOL_VERSION, chatPost, toJsonSchema } from '@agent-gateway/protocol';
import { describe, expect, it, vi } from 'vitest';
import { createPolicyStage } from '../../src/policy/stage.js';
import { installBridge } from '../../src/link/bridge.js';
import { LinkClient, type SocketLike } from '../../src/link/client.js';
import type { DispatchResult, OpCall, OpUser } from '../../src/ops/types.js';

class FakeSocket implements SocketLike {
  onopen: SocketLike['onopen'] = null;
  onmessage: SocketLike['onmessage'] = null;
  onclose: SocketLike['onclose'] = null;
  onerror: SocketLike['onerror'] = null;
  readyState = 1;
  sent: any[] = [];
  send(d: string) {
    this.sent.push(JSON.parse(d));
  }
  close() {}
  recv(m: object) {
    this.onmessage?.({ data: JSON.stringify(m) });
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0));

const definition = {
  name: chatPost.name,
  description: chatPost.description,
  category: chatPost.category,
  minRole: chatPost.minRole,
  ...toJsonSchema(chatPost),
};

async function boot(
  welcome: object,
  existing: string[] = ['owner1'],
  impl?: (c: OpCall, u: OpUser) => Promise<DispatchResult>,
) {
  const socket = new FakeSocket();
  const dispatch = vi.fn<(c: OpCall, u: OpUser) => Promise<DispatchResult>>(async () => ({
    text: 'done',
    structured: {},
  }));
  if (impl) dispatch.mockImplementation(impl);
  const client = new LinkClient({
    getGatewayUrl: () => 'ws://gw',
    getToken: () => JSON.stringify({ url: 'ws://gw', token: 't' }),
    setToken: () => {},
    getIdentity: () => ({
      moduleVersion: '0',
      foundryVersion: '14',
      world: { id: 'w', title: 'W', system: 's', systemVersion: '1' },
      user: { id: 'agent', name: 'A', role: 1, isGM: false },
    }),
    createSocket: () => socket,
    notifyError: () => {},
  });
  const rows = new Map<string, string>();
  installBridge(client, {
    dispatch,
    getUser: () => ({ id: 'agent', isGM: false }),
    userExists: (id) => existing.includes(id),
    storage: () => ({
      getItem: (k: string) => rows.get(k) ?? null,
      setItem: (k: string, v: string) => void rows.set(k, v),
    }),
  });
  client.start();
  socket.onopen?.();
  socket.recv({
    type: 'welcome',
    gatewayVersion: '0',
    protocolVersion: PROTOCOL_VERSION,
    connectionId: 'c',
    agentId: 'agent-77',
    ...welcome,
  });
  await flush();
  let last: any;
  const direct = async () => {
    last = await (client.onCall as any)({
      type: 'call',
      id: 'call-1',
      sessionId: 's',
      tool: 'fixture_tool',
      args: {},
    });
    return dispatch.mock.calls.at(-1)![0].agent;
  };
  const queued = async () => {
    socket.recv({
      type: 'queuedCalls',
      calls: [
        {
          id: 'q'.repeat(32),
          tool: chatPost.name,
          args: { content: 'x' },
          sessionId: 's',
          expiresAt: Date.now() + 60000,
          definition: structuredClone(definition),
        },
      ],
    });
    await flush();
    return dispatch.mock.calls.at(-1)![0].agent;
  };
  return { direct, queued, lastResult: () => last };
}

describe('headless owner from welcome', () => {
  it('uses the named owner and headless on both bridge paths', async () => {
    const a = await boot({ headless: true, ownerUserId: 'owner1' });
    expect(await a.direct()).toEqual({ id: 'agent-77', ownerUserId: 'owner1', headless: true });
    const b = await boot({ headless: true, ownerUserId: 'owner1' });
    expect(await b.queued()).toEqual({ id: 'agent-77', ownerUserId: 'owner1', headless: true });
  });

  it('ignores ownerUserId without headless: true', async () => {
    const a = await boot({ ownerUserId: 'owner1' });
    expect(await a.direct()).toEqual({ id: 'agent-77', ownerUserId: 'agent', headless: false });
    const b = await boot({ ownerUserId: 'owner1' });
    expect(await b.queued()).toMatchObject({ ownerUserId: 'agent', headless: false });
  });

  it('falls back to the connected user when the owner is unknown, still headless', async () => {
    const a = await boot({ headless: true, ownerUserId: 'ghost' });
    expect(await a.direct()).toEqual({ id: 'agent-77', ownerUserId: 'agent', headless: true });
    const b = await boot({ headless: true, ownerUserId: 'ghost' });
    expect(await b.queued()).toMatchObject({ ownerUserId: 'agent', headless: true });
  });

  it('headless without an owner is headless with the connected user as owner', async () => {
    const a = await boot({ headless: true });
    expect(await a.direct()).toEqual({ id: 'agent-77', ownerUserId: 'agent', headless: true });
  });
});

describe('headlessAgentsEnabled off', () => {
  it('denies a call whose welcome said headless, with no session flag', async () => {
    vi.stubGlobal('game', { i18n: { format: (key: string) => key } });
    const stage = createPolicyStage({
      tools: [{ name: 'world_info', category: 'read' } as any],
      inputs: () =>
        ({
          world: { gmAgents: {}, playerAgents: {} },
          owner: { gmAgents: {}, playerAgents: {} },
          playerAgentsEnabled: true,
          headlessAgentsEnabled: false,
        }) as any,
    });
    const next = vi.fn(async () => ({ text: 'ok', structured: {} }) as DispatchResult);
    const b = await boot(
      { headless: true },
      [],
      (c, u) => stage.run({ ...c, user: u } as any, next) as Promise<DispatchResult>,
    );
    await b.direct();
    expect(b.lastResult()).toMatchObject({ ok: false, code: 'DENIED' });
    expect(b.lastResult().message).toContain('AGENT_GATEWAY.Policy.headlessAgentsDisabled');
    expect(next).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
