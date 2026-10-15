/* eslint-disable @typescript-eslint/no-explicit-any */
import { PROTOCOL_VERSION } from '@agent-gateway/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LinkClient, ManageError, type SocketLike } from '../../../src/link/client.js';

class FakeSocket implements SocketLike {
  onopen: SocketLike['onopen'] = null;
  onmessage: SocketLike['onmessage'] = null;
  onclose: SocketLike['onclose'] = null;
  onerror: SocketLike['onerror'] = null;
  sent: any[] = [];
  send(d: string) {
    this.sent.push(JSON.parse(d));
  }
  close() {}
  recv(m: object) {
    this.onmessage?.({ data: JSON.stringify(m) });
  }
}

function connected(opts: { version?: string; admin?: boolean } = {}) {
  const sockets: FakeSocket[] = [];
  const client = new LinkClient({
    getGatewayUrl: () => 'ws://gw',
    getToken: () => ({ url: 'ws://gw', token: 'tok' }),
    setToken: () => undefined,
    getIdentity: () => ({
      moduleVersion: '0.2.0',
      foundryVersion: '14.0',
      world: { id: 'w', title: 'W', system: 'dnd5e', systemVersion: '5' },
      user: { id: 'u', name: 'Gm', role: 4, isGM: true },
    }),
    createSocket: () => {
      const s = new FakeSocket();
      sockets.push(s);
      return s;
    },
    notifyError: () => undefined,
  });
  client.start();
  const ws = sockets[0]!;
  ws.onopen?.();
  ws.recv({
    type: 'welcome',
    gatewayVersion: opts.version ?? '0.2.0',
    protocolVersion: PROTOCOL_VERSION,
    connectionId: 'c1',
    agentId: 'a1',
    admin: opts.admin ?? true,
  });
  return { client, ws };
}

const pairing = (over: object = {}) => ({
  id: 'p1',
  userId: 'u1',
  userName: 'Una',
  origin: null,
  createdAt: 1,
  admin: false,
  connected: false,
  self: false,
  ...over,
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('management requests on the link client', () => {
  it('send plain messages with no world id and correlate replies by request id', async () => {
    const { client, ws } = connected();
    const p = client.listPairings();
    const sent = ws.sent.at(-1);
    expect(Object.keys(sent).sort()).toEqual(['requestId', 'type']);
    ws.recv({ type: 'pairings', requestId: 'foreign', pairings: [] });
    ws.recv({ type: 'pairings', requestId: sent.requestId, pairings: [pairing()] });
    await expect(p).resolves.toEqual([pairing()]);

    const r = client.revokePairing('p1');
    expect(ws.sent.at(-1)).toMatchObject({ type: 'revokePairing', pairingId: 'p1' });
    ws.recv({ type: 'pairings', requestId: ws.sent.at(-1).requestId, pairings: [] });
    await expect(r).resolves.toEqual([]);

    const l = client.listInvites();
    ws.recv({ type: 'invites', requestId: ws.sent.at(-1).requestId, invites: [] });
    await expect(l).resolves.toEqual([]);

    const c = client.createInvite('u1', 600_000);
    expect(ws.sent.at(-1)).toMatchObject({ type: 'createInvite', userId: 'u1', ttlMs: 600_000 });
    ws.recv({
      type: 'inviteCreated',
      requestId: ws.sent.at(-1).requestId,
      inviteId: 'i1',
      code: 'CODE',
      expiresAt: 5,
    });
    await expect(c).resolves.toMatchObject({ inviteId: 'i1', code: 'CODE' });

    const x = client.cancelInvite('i1');
    expect(ws.sent.at(-1)).toMatchObject({ type: 'cancelInvite', inviteId: 'i1' });
    ws.recv({ type: 'invites', requestId: ws.sent.at(-1).requestId, invites: [] });
    await expect(x).resolves.toEqual([]);
  });

  it('rejects with the gateway error code', async () => {
    const { client, ws } = connected();
    const p = client.revokePairing('p1');
    ws.recv({
      type: 'error',
      id: '',
      requestId: ws.sent.at(-1).requestId,
      code: 'FORBIDDEN',
      message: 'no',
    });
    await expect(p).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('sends nothing when not an admin, when the gateway is old, or when disconnected', async () => {
    const plain = connected({ admin: false });
    const n = plain.ws.sent.length;
    await expect(plain.client.listPairings()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(plain.ws.sent).toHaveLength(n);

    const old = connected({ version: '0.1.0' });
    const m = old.ws.sent.length;
    await expect(old.client.listInvites()).rejects.toMatchObject({ code: 'TOO_OLD' });
    expect(old.ws.sent).toHaveLength(m);

    const { client } = connected();
    client.stop();
    await expect(client.listInvites()).rejects.toBeInstanceOf(ManageError);
  });

  it('times out and rejects pending requests on disconnect', async () => {
    const { client, ws } = connected();
    const slow = client.listInvites();
    const caught = expect(slow).rejects.toMatchObject({ code: 'TIMEOUT' });
    await vi.advanceTimersByTimeAsync(10_001);
    await caught;
    const pending = client.listPairings();
    const gone = expect(pending).rejects.toMatchObject({ code: 'OFFLINE' });
    client.stop();
    await gone;
    expect(ws.sent.length).toBeGreaterThan(0);
  });

  it('ignores a reply that arrives on another socket', async () => {
    const { client, ws } = connected();
    const p = client.listInvites();
    const rid = ws.sent.at(-1).requestId;
    const other = new FakeSocket();
    // A late frame from a socket that is not the live one must not settle the request.
    (client as any).handle(other, JSON.stringify({ type: 'invites', requestId: rid, invites: [] }), 'ws://gw');
    const caught = expect(p).rejects.toMatchObject({ code: 'TIMEOUT' });
    await vi.advanceTimersByTimeAsync(10_001);
    await caught;
  });
});
