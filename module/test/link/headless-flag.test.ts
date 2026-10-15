/* eslint-disable @typescript-eslint/no-explicit-any */
import { PROTOCOL_VERSION } from '@agent-gateway/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  HEADLESS_FLAG_KEY,
  installBridge,
  linkAgentHeadless,
  resetHeadlessFlagForTests,
} from '../../src/link/bridge.js';
import { LinkClient, type SocketLike } from '../../src/link/client.js';
import { policyDenies } from '../../src/link/toolset.js';
import { createPolicyStage } from '../../src/policy/stage.js';
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

function setFlag(on: boolean): void {
  const store = new Map<string, string>();
  if (on) store.set(HEADLESS_FLAG_KEY, '1');
  vi.stubGlobal('sessionStorage', { getItem: (k: string) => store.get(k) ?? null });
  resetHeadlessFlagForTests();
}

afterEach(() => {
  vi.unstubAllGlobals();
  resetHeadlessFlagForTests();
});

describe('module headless flag', () => {
  let socket: FakeSocket;
  let seen: OpCall[];
  const boot = async (
    dispatch: (c: OpCall, u: OpUser) => Promise<DispatchResult>,
    identityExtra: object,
  ) => {
    socket = new FakeSocket();
    const client = new LinkClient({
      getGatewayUrl: () => 'ws://gw',
      getToken: () => JSON.stringify({ url: 'ws://gw', token: 't' }),
      setToken: () => {},
      getIdentity: () => ({
        moduleVersion: '0',
        foundryVersion: '14',
        world: { id: 'w', title: 'W', system: 's', systemVersion: '1' },
        user: { id: 'agent', name: 'A', role: 1, isGM: false },
        ...identityExtra,
      }),
      createSocket: () => socket,
      notifyError: () => {},
    });
    installBridge(client, { dispatch, getUser: () => ({ id: 'agent', isGM: false }) });
    client.start();
    socket.onopen?.();
    socket.recv({
      type: 'welcome',
      gatewayVersion: '0',
      protocolVersion: PROTOCOL_VERSION,
      connectionId: 'c',
      agentId: 'agent-77',
    });
    await flush();
  };
  beforeEach(() => {
    seen = [];
  });

  it('is headless in the bridge and the listing when the session flag is set', async () => {
    setFlag(true);
    expect(linkAgentHeadless()).toBe(true);
    await boot(async (c) => (seen.push(c), { text: 'ok', structured: {} }), { headless: true });
    socket.recv({ type: 'call', id: '1', sessionId: 's', tool: 'world_info', args: {} });
    await flush();
    expect(seen[0]?.agent.headless).toBe(true);
    expect(socket.sent.find((m) => m.type === 'hello').headless).toBe(true);
    const inputs = {
      world: { gmAgents: {}, playerAgents: {} },
      owner: { gmAgents: {}, playerAgents: {} },
      playerAgentsEnabled: true,
      headlessAgentsEnabled: false,
    } as any;
    expect(
      policyDenies(
        () => inputs,
        () => true,
      )('read'),
    ).toBe(true);
  });

  it('is not headless without the flag and hello has no headless key', async () => {
    setFlag(false);
    expect(linkAgentHeadless()).toBe(false);
    await boot(async (c) => (seen.push(c), { text: 'ok', structured: {} }), {});
    socket.recv({ type: 'call', id: '1', sessionId: 's', tool: 'world_info', args: {} });
    await flush();
    expect(seen[0]?.agent.headless).toBe(false);
    expect('headless' in socket.sent.find((m) => m.type === 'hello')).toBe(false);
  });

  it('denies a headless call while headlessAgentsEnabled is off', async () => {
    setFlag(true);
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
    await boot((c, u) => stage.run({ ...c, user: u } as any, next) as Promise<DispatchResult>, {
      headless: true,
    });
    socket.recv({ type: 'call', id: '1', sessionId: 's', tool: 'world_info', args: {} });
    await flush();
    const err = socket.sent.find((m) => m.type === 'error');
    expect(err.code).toBe('DENIED');
    expect(err.message).toContain('AGENT_GATEWAY.Policy.headlessAgentsDisabled');
    expect(next).not.toHaveBeenCalled();
  });
});
