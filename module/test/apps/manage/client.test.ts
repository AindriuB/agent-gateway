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
    gatewayVersion: opts.version ?? '0.3.0',
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

  it('sends invite messages to a 0.2.0 gateway but pairing messages only from 0.3.0', async () => {
    const v2 = connected({ version: '0.2.0' });
    const n = v2.ws.sent.length;
    await expect(v2.client.listPairings()).rejects.toMatchObject({ code: 'TOO_OLD' });
    await expect(v2.client.revokePairing('p1')).rejects.toMatchObject({ code: 'TOO_OLD' });
    expect(v2.ws.sent).toHaveLength(n);
    void v2.client.listInvites().catch(() => undefined);
    expect(v2.ws.sent).toHaveLength(n + 1);
    expect(v2.ws.sent[n]!).toMatchObject({ type: 'listInvites' });

    const v3 = connected({ version: '0.3.0' });
    const m = v3.ws.sent.length;
    void v3.client.listPairings().catch(() => undefined);
    expect(v3.ws.sent).toHaveLength(m + 1);
    expect(v3.ws.sent[m]!).toMatchObject({ type: 'listPairings' });
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
    (client as any).handle(
      other,
      JSON.stringify({ type: 'invites', requestId: rid, invites: [] }),
      'ws://gw',
    );
    const caught = expect(p).rejects.toMatchObject({ code: 'TIMEOUT' });
    await vi.advanceTimersByTimeAsync(10_001);
    await caught;
  });
});

describe('per-user grants requests on the link client', () => {
  const grant = { id: 'g1', clientName: 'App', scopes: ['read'], createdAt: 1 };

  it('send plain messages and resolve to the grants of the asked user', async () => {
    const { client, ws } = connected();
    const p = client.listUserGrants('u1');
    const sent = ws.sent.at(-1);
    expect(Object.keys(sent).sort()).toEqual(['requestId', 'type', 'userId']);
    expect(sent).toMatchObject({ type: 'listUserGrants', userId: 'u1' });
    ws.recv({ type: 'userGrants', requestId: 'foreign', userId: 'u1', grants: [] });
    ws.recv({ type: 'userGrants', requestId: sent.requestId, userId: 'u1', grants: [grant] });
    await expect(p).resolves.toEqual([grant]);

    const r = client.revokeUserGrant('u1', 'g1');
    expect(ws.sent.at(-1)).toMatchObject({ type: 'revokeUserGrant', userId: 'u1', grantId: 'g1' });
    ws.recv({
      type: 'userGrants',
      requestId: ws.sent.at(-1).requestId,
      userId: 'u1',
      grants: [],
    });
    await expect(r).resolves.toEqual([]);
  });

  it('rejects a reply that is for another user', async () => {
    const { client, ws } = connected();
    const p = client.listUserGrants('u1');
    ws.recv({
      type: 'userGrants',
      requestId: ws.sent.at(-1).requestId,
      userId: 'u2',
      grants: [grant],
    });
    await expect(p).rejects.toMatchObject({ code: 'INTERNAL' });
  });

  it('rejects with the gateway error code', async () => {
    const { client, ws } = connected();
    const p = client.revokeUserGrant('u1', 'g1');
    ws.recv({
      type: 'error',
      id: '',
      requestId: ws.sent.at(-1).requestId,
      code: 'FORBIDDEN',
      message: 'no',
    });
    await expect(p).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('sends nothing to a non-admin session or to a gateway below 0.3.0', async () => {
    const plain = connected({ admin: false });
    const n = plain.ws.sent.length;
    await expect(plain.client.listUserGrants('u1')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(plain.ws.sent).toHaveLength(n);

    const v2 = connected({ version: '0.2.0' });
    const m = v2.ws.sent.length;
    await expect(v2.client.listUserGrants('u1')).rejects.toMatchObject({ code: 'TOO_OLD' });
    await expect(v2.client.revokeUserGrant('u1', 'g1')).rejects.toMatchObject({
      code: 'TOO_OLD',
    });
    expect(v2.ws.sent).toHaveLength(m);

    const v3 = connected({ version: '0.3.0' });
    const k = v3.ws.sent.length;
    void v3.client.listUserGrants('u1').catch(() => undefined);
    expect(v3.ws.sent).toHaveLength(k + 1);
  });
});
