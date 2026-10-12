/* eslint-disable @typescript-eslint/no-explicit-any */
import { PROTOCOL_VERSION, chatPost, toJsonSchema } from '@agent-gateway/protocol';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installBridge } from '../../src/link/bridge.js';
import { LinkClient, type SocketLike } from '../../src/link/client.js';
import { replayOf, type DispatchResult, type OpCall, type OpUser } from '../../src/ops/types.js';

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

let socket: FakeSocket;
let client: LinkClient;
let gameUser: { id: string; isGM: boolean };
let dispatch: ReturnType<typeof vi.fn<(c: OpCall, u: OpUser) => Promise<DispatchResult>>>;

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(async () => {
  socket = new FakeSocket();
  gameUser = { id: 'player-1', isGM: false };
  dispatch = vi.fn(async () => ({ text: 'done', structured: { ok: 1 } }));
  client = new LinkClient({
    getGatewayUrl: () => 'ws://gw',
    getToken: () => JSON.stringify({ url: 'ws://gw', token: 't' }),
    setToken: () => {},
    getIdentity: () => ({
      moduleVersion: '0',
      foundryVersion: '14',
      world: { id: 'w', title: 'W', system: 's', systemVersion: '1' },
      user: { id: 'player-1', name: 'P', role: 1, isGM: false },
    }),
    createSocket: () => socket,
    notifyError: () => {},
  });
  installBridge(client, { dispatch, getUser: () => gameUser });
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
});

const call = (extra: object = {}) => ({
  type: 'call',
  id: 'call-1',
  sessionId: 'sess-9',
  tool: 'fixture_tool',
  args: { a: 'x' },
  ...extra,
});

describe('bridge', () => {
  it('dispatches as game.user with the agent context and the call session id', async () => {
    socket.recv(call());
    await flush();
    expect(dispatch).toHaveBeenCalledTimes(1);
    const [c, user] = dispatch.mock.calls[0]!;
    expect(user).toEqual({ id: 'player-1', isGM: false });
    expect(c).toEqual({
      tool: 'fixture_tool',
      args: { a: 'x' },
      agent: { id: 'agent-77', ownerUserId: 'player-1', headless: false },
      sessionId: 'sess-9',
    });
    expect(socket.sent.at(-1)).toEqual({
      type: 'result',
      id: 'call-1',
      ok: true,
      text: 'done',
      structured: { ok: 1 },
    });
  });

  it('ignores a forged userId / isGM / role on the call frame', async () => {
    // The real client rejects extra keys at parse time; the bridge must hold even if one got through.
    const forged = call({ userId: 'gm-1', isGM: true, role: 4, user: { id: 'gm-1', isGM: true } });
    await (client.onCall as any)(forged);
    expect(dispatch).toHaveBeenCalledTimes(1);
    const [c, user] = dispatch.mock.calls[0]!;
    expect(user).toEqual({ id: 'player-1', isGM: false });
    expect(c.agent.ownerUserId).toBe('player-1');
    expect(JSON.stringify(c)).not.toContain('gm-1');
  });

  it('reads game.user at call time, not at install time', async () => {
    gameUser = { id: 'gm-2', isGM: true };
    await (client.onCall as any)(call());
    expect(dispatch.mock.calls[0]![1]).toEqual({ id: 'gm-2', isGM: true });
  });

  it('maps a dispatch error to an error result', async () => {
    dispatch.mockResolvedValueOnce({ error: { code: 'FORBIDDEN', message: 'gm only' } });
    expect(await (client.onCall as any)(call())).toEqual({
      ok: false,
      code: 'FORBIDDEN',
      message: 'gm only',
    });
  });

  it('fails the call with INTERNAL when there is no game.user', async () => {
    installBridge(client, { dispatch, getUser: () => undefined });
    expect(await (client.onCall as any)(call())).toMatchObject({ ok: false, code: 'INTERNAL' });
    expect(dispatch).not.toHaveBeenCalled();
  });
});

describe('authenticated queued bridge', () => {
  const definition = {
    name: chatPost.name,
    description: chatPost.description,
    category: chatPost.category,
    minRole: chatPost.minRole,
    ...toJsonSchema(chatPost),
  };
  const frame = () => ({
    type: 'queuedCalls',
    calls: [
      {
        id: 'r'.repeat(32),
        tool: chatPost.name,
        args: { content: 'fixture' },
        sessionId: 's',
        expiresAt: Date.now() + 60000,
        definition: structuredClone(definition),
      },
    ],
  });
  function setupStorage() {
    const rows = new Map<string, string>();
    const storage = {
      getItem: (k: string) => rows.get(k) ?? null,
      setItem: (k: string, v: string) => {
        rows.set(k, v);
      },
    };
    installBridge(client, { dispatch, getUser: () => gameUser, storage: () => storage });
    return storage;
  }
  it('dispatches one immutable receipt with current native identity and trusted provenance', async () => {
    setupStorage();
    const f = frame();
    socket.recv(f);
    await flush();
    socket.recv(f);
    await flush();
    expect(dispatch).toHaveBeenCalledTimes(1);
    const [call, user] = dispatch.mock.calls[0]!;
    expect(user.id).toBe('player-1');
    expect(replayOf(call)?.id).toBe(f.calls[0]!.id);
    expect(socket.sent.at(-1)).toMatchObject({ type: 'queuedStatus', status: 'approved' });
  });
  it('fails closed before dispatch on storage failure or changed definition', async () => {
    setupStorage();
    const f = frame();
    f.calls[0]!.definition.description = 'changed';
    socket.recv(f);
    await flush();
    expect(dispatch).not.toHaveBeenCalled();
    expect(socket.sent.at(-1)).toMatchObject({ type: 'queuedStatus', status: 'denied' });
    installBridge(client, {
      dispatch,
      getUser: () => gameUser,
      storage: () => {
        throw Error('quota');
      },
    });
    socket.recv(frame());
    await flush();
    expect(dispatch).not.toHaveBeenCalled();
  });
  it('invalidates replay provenance on disconnect and never reexecutes after guard reload', async () => {
    const storage = setupStorage();
    let release!: () => void;
    dispatch.mockImplementation(async () => {
      await new Promise<void>((r) => {
        release = r;
      });
      return { text: 'done', structured: {} };
    });
    const f = frame();
    socket.recv(f);
    await flush();
    const call = dispatch.mock.calls[0]![0];
    expect(replayOf(call)?.current()).toBe(true);
    client.stop();
    expect(replayOf(call)?.current()).toBe(false);
    release();
    await flush();
    installBridge(client, { dispatch, getUser: () => gameUser, storage: () => storage });
  });
});
