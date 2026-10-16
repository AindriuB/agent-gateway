/* eslint-disable @typescript-eslint/no-explicit-any */
import { PROTOCOL_VERSION } from '@agent-gateway/protocol';
import { describe, expect, it } from 'vitest';
import { APPROVAL_CONFIG } from '../../src/approvals/config.js';
import { LinkClient, type SocketLike } from '../../src/link/client.js';
import { pipeline, settle, world } from './rig.js';

const collect = (c: { manager: any }) => {
  const seen: any[] = [];
  c.manager.onApprovalState((m: any) => seen.push(m));
  return seen;
};

describe('approvalState transitions from the manager', () => {
  it('reports approved and denied for records created this session, and lists pending ids', async () => {
    const hub = world();
    const p1 = hub.client('p1');
    const { call } = pipeline(p1);
    const seen = collect(p1);
    void call('write_thing', { id: 'a' });
    void call('write_thing', { id: 'b' });
    await settle();
    const ids = p1.manager.listPending().map((r: any) => r.id);
    expect(ids).toHaveLength(2);
    expect(p1.manager.pendingApprovalIds().sort()).toEqual([...ids].sort());
    p1.manager.resolveApproval(ids[0]!, { decision: 'approve' });
    p1.manager.resolveApproval(ids[1]!, { decision: 'deny', reason: 'no' });
    await settle();
    expect(seen).toEqual([
      { id: ids[0], state: 'approved' },
      { id: ids[1], state: 'denied' },
    ]);
    expect(p1.manager.pendingApprovalIds()).toEqual([]);
  });

  it('reports expired when the deadline passes', async () => {
    const hub = world();
    const p1 = hub.client('p1', { waitMs: 10 });
    const { call } = pipeline(p1);
    const seen = collect(p1);
    const pending = call('write_thing', { id: 'x' });
    await hub.advance(20);
    await pending;
    const id = p1.manager.ownRecords()[0]!.id;
    await hub.advance(APPROVAL_CONFIG.APPROVAL_TTL_MS + 10);
    expect(seen).toEqual([{ id, state: 'expired' }]);
  });

  it('records loaded from storage produce no transition and are not in the list', async () => {
    const hub = world();
    const p1 = hub.client('p1');
    const first = pipeline(p1);
    void first.call('write_thing', { id: 'reload' });
    await settle();
    const p1b = hub.client('p1', { storage: p1.storage });
    const seen = collect(p1b);
    p1b.manager.load();
    expect(seen).toEqual([]);
    expect(p1b.manager.pendingApprovalIds()).toEqual([]);
  });
});

describe('holding answers while the link is down (amendment 4)', () => {
  it('holds an approval until the link is back, reports it first, then runs once', async () => {
    const hub = world();
    const p1 = hub.client('p1');
    const { call, handler } = pipeline(p1);
    const order: string[] = [];
    p1.manager.onApprovalState((m: any) => order.push(`report:${m.state}`));
    handler.mockImplementation(async () => {
      order.push('run');
      return { text: 'ran', structured: {} };
    });
    let down = false;
    p1.manager.holdWhile(() => down);
    const done = call('write_thing', { id: 'a' });
    await settle();
    const id = p1.manager.listPending()[0]!.id;
    down = true;
    expect(p1.manager.resolveApproval(id, { decision: 'approve' })).toBe(true);
    await settle();
    expect(handler).not.toHaveBeenCalled();
    expect(order).toEqual([]);
    // Still pending, and still in the list the gateway is sent so it does not requeue it.
    expect(p1.manager.pendingApprovalIds()).toEqual([id]);
    down = false;
    p1.manager.releaseHeld();
    expect(await done).toMatchObject({ text: 'ran' });
    expect(order).toEqual(['report:approved', 'run']);
    p1.manager.releaseHeld();
    await settle();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('holds a denial and reports it on reconnect without running anything', async () => {
    const hub = world();
    const p1 = hub.client('p1');
    const { call, handler } = pipeline(p1);
    const seen = collect(p1);
    let down = false;
    p1.manager.holdWhile(() => down);
    const done = call('write_thing', { id: 'd' });
    await settle();
    const id = p1.manager.listPending()[0]!.id;
    down = true;
    p1.manager.resolveApproval(id, { decision: 'deny', reason: 'no' });
    await settle();
    expect(seen).toEqual([]);
    down = false;
    p1.manager.releaseHeld();
    expect(await done).toMatchObject({ error: { code: 'DENIED' } });
    expect(seen).toEqual([{ id, state: 'denied' }]);
    expect(handler).not.toHaveBeenCalled();
  });

  it('withdraws pending records when another tab takes the link, reporting nothing', async () => {
    const hub = world();
    const p1 = hub.client('p1');
    const gm = hub.client('gm');
    const { call, handler } = pipeline(p1, 'gm');
    const seen = collect(p1);
    const done = call('write_thing', { id: 'w' });
    await settle();
    const id = p1.manager.ownRecords()[0]!.id;
    expect(gm.manager.listPending()).toHaveLength(1);
    expect(p1.manager.withdrawPending()).toBe(1);
    expect(await done).toMatchObject({ structured: { status: 'pending_approval' } });
    expect(p1.manager.pendingApprovalIds()).toEqual([]);
    expect(gm.manager.listPending()).toEqual([]);
    expect(gm.manager.resolveApproval(id, { decision: 'approve' })).toBe(false);
    expect(p1.manager.resolveApproval(id, { decision: 'approve' })).toBe(false);
    await settle();
    expect(handler).not.toHaveBeenCalled();
    expect(seen).toEqual([]);
  });
});

describe('the link client gate', () => {
  class FakeSocket implements SocketLike {
    onopen: SocketLike['onopen'] = null;
    onmessage: SocketLike['onmessage'] = null;
    onclose: SocketLike['onclose'] = null;
    onerror: SocketLike['onerror'] = null;
    readyState = 1;
    raw: string[] = [];
    send(d: string) {
      this.raw.push(d);
    }
    close() {}
    recv(m: object) {
      this.onmessage?.({ data: JSON.stringify(m) });
    }
  }
  async function connected(protocolVersion: string) {
    const socket = new FakeSocket();
    const client = new LinkClient({
      getGatewayUrl: () => 'ws://gw',
      getToken: () => JSON.stringify({ url: 'ws://gw', token: 't' }),
      setToken: () => {},
      getIdentity: () => ({
        moduleVersion: '0',
        foundryVersion: '14',
        world: { id: 'w', title: 'W', system: 's', systemVersion: '1' },
        user: { id: 'p', name: 'P', role: 1, isGM: false },
      }),
      createSocket: () => socket,
      notifyError: () => {},
    });
    client.start();
    socket.onopen?.();
    socket.recv({
      type: 'welcome',
      gatewayVersion: '0',
      protocolVersion,
      connectionId: 'c',
      agentId: 'a',
    });
    await new Promise((r) => setTimeout(r, 0));
    return { socket, client };
  }
  const frames = (s: FakeSocket) =>
    s.raw.map((r) => JSON.parse(r)).filter((m) => m.type === 'approvalState');

  it('sends nothing to a gateway that reports 7.1.0', async () => {
    const { socket, client } = await connected('7.1.0');
    client.sendApprovalState({ ids: [] });
    client.sendApprovalState({ id: 'a', state: 'approved' });
    expect(frames(socket)).toEqual([]);
  });

  it('sends the list and a transition to a 7.2.0 gateway', async () => {
    const { socket, client } = await connected(PROTOCOL_VERSION);
    client.sendApprovalState({ ids: ['a'] });
    client.sendApprovalState({ id: 'a', state: 'approved' });
    expect(frames(socket)).toEqual([
      { type: 'approvalState', ids: ['a'] },
      { type: 'approvalState', id: 'a', state: 'approved' },
    ]);
  });

  it('reports whether the frame was sent, and passes the ownership reply to listeners', async () => {
    const old = await connected('7.1.0');
    expect(old.client.sendApprovalState({ ids: [] })).toBe(false);
    const { socket, client } = await connected(PROTOCOL_VERSION);
    const got: string[][][] = [];
    client.onApprovalOwnership((ids, unknown) => got.push([ids, unknown]));
    expect(client.sendApprovalState({ ids: ['a'] })).toBe(true);
    socket.recv({ type: 'approvalOwnership', ids: ['a'], unknown: ['b'] });
    socket.recv({ type: 'approvalOwnership', ids: [] });
    expect(got).toEqual([
      [['a'], ['b']],
      [[], []],
    ]);
  });
});
