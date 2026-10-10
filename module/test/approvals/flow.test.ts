/* eslint-disable @typescript-eslint/no-explicit-any */
import { APPROVAL_WAIT_MS } from '@agent-gateway/protocol';
import { describe, expect, it, vi } from 'vitest';
import { APPROVAL_CONFIG } from '../../src/approvals/config.js';
import { agentOf, pendingId, pipeline, settle, world } from './rig.js';

const setup = (
  approver: 'owner' | 'gm' = 'owner',
  waitMs: number = APPROVAL_CONFIG.APPROVAL_WAIT_MS,
) => {
  const hub = world();
  const p1 = hub.client('p1', { waitMs });
  const gm = hub.client('gm', { waitMs });
  const gm2 = hub.client('gm2', { waitMs });
  return { hub, p1, gm, gm2, ...pipeline(p1, approver) };
};

describe('the approval stage', () => {
  it('has a 25 s wait in the shared config object, taken from the protocol constant', () => {
    expect(APPROVAL_CONFIG.APPROVAL_WAIT_MS).toBe(25_000);
    expect(APPROVAL_CONFIG.APPROVAL_WAIT_MS).toBe(APPROVAL_WAIT_MS);
  });

  it('does nothing for a call with no ctx.approval', async () => {
    const { p1, call, handler } = setup();
    const r = await call('approval_status', { id: 'nope-nope-nope-nope-nope-nope' });
    expect(r).toMatchObject({ error: { code: 'INVALID_ARGS' } });
    expect(handler).not.toHaveBeenCalled();
    expect(p1.storage.text).toBe('');
  });

  it.each([
    ['owner', 'approve'],
    ['owner', 'deny'],
    ['gm', 'approve'],
    ['gm', 'deny'],
  ] as const)(
    'a synchronous %s hook can %s and settle the caller immediately',
    async (approver, decision) => {
      const { hub, p1, gm, call, handler } = setup(approver);
      const client = approver === 'owner' ? p1 : gm;
      const push = client.hooks.push.bind(client.hooks);
      let accepted: boolean | undefined;
      let id = '';
      const hook = vi.spyOn(client.hooks, 'push').mockImplementation((...events) => {
        const count = push(...events);
        for (const event of events) {
          if (event.name !== 'agentGateway.approvalRequested') continue;
          id = event.payload.id;
          accepted = client.manager.resolveApproval(id, { decision, reason: 'synchronous answer' });
        }
        return count;
      });
      try {
        let settled = false;
        const done = call('write_thing', { id: 'sync' }).then((result) => {
          settled = true;
          return result;
        });
        await settle();
        expect(accepted).toBe(true);
        expect(settled).toBe(true); // No clock advance: the answer must beat the pending timeout.
        if (decision === 'deny') {
          expect(await done).toMatchObject({
            error: { code: 'DENIED', message: expect.stringContaining('synchronous answer') },
          });
        } else {
          expect(await done).toEqual({ text: 'ran write_thing {"id":"sync"}', structured: {} });
        }
        expect((await call('approval_status', { id })) as any).toMatchObject({
          structured: { id, status: decision === 'deny' ? 'denied' : 'approved' },
        });
        await hub.advance(APPROVAL_CONFIG.APPROVAL_WAIT_MS);
        expect(handler).toHaveBeenCalledTimes(decision === 'deny' ? 0 : 1);
        expect(p1.manager.listPending()).toEqual([]);
        expect(gm.manager.listPending()).toEqual([]);
      } finally {
        hook.mockRestore();
      }
    },
  );

  it('owner approves within the wait: the handler runs and its result comes back directly', async () => {
    const { p1, call, handler } = setup();
    const done = call('write_thing', { id: 'a' });
    await settle();
    expect(handler).not.toHaveBeenCalled();
    const [req] = p1.manager.listPending();
    expect(req).toMatchObject({ tool: 'write_thing', approver: 'owner', local: true });
    expect(p1.manager.resolveApproval(req!.id, { decision: 'approve' })).toBe(true);
    expect(await done).toEqual({ text: 'ran write_thing {"id":"a"}', structured: {} });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('a GM approves over the socket, attributed to the sender', async () => {
    const { hub, p1, gm, call, handler } = setup();
    const done = call('write_thing');
    await settle();
    const [seen] = gm.manager.listPending();
    expect(seen).toMatchObject({ tool: 'write_thing', requesterId: 'p1', local: false });
    expect(gm.hooks.map((h) => h.name)).toEqual(['agentGateway.approvalRequested']);
    expect(gm.manager.resolveApproval(seen!.id, { decision: 'approve' })).toBe(true);
    expect(await done).toMatchObject({ text: expect.stringContaining('ran write_thing') });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(p1.hooks.map((h) => h.name)).toEqual([
      'agentGateway.approvalRequested',
      'agentGateway.approvalResolved',
    ]);
    // Every message from the GM went out with the GM's own server-attested id.
    expect(hub.sent.filter((m) => m.data.t === 'approval.resolve').map((m) => m.sender)).toEqual([
      'gm',
    ]);
    // The other GM's inbox is cleared.
    expect(gm.manager.listPending()).toEqual([]);
  });

  it('a GM denies with a reason, returned to the agent and to approval_status', async () => {
    const { gm, call, handler } = setup('gm');
    const done = call('write_thing');
    await settle();
    const [seen] = gm.manager.listPending();
    gm.manager.resolveApproval(seen!.id, { decision: 'deny', reason: 'Too risky\u0007' });
    const r: any = await done;
    expect(r.error.code).toBe('DENIED');
    expect(r.error.message).toContain('Too risky');
    expect(r.error.message).not.toContain('\u0007');
    expect(handler).not.toHaveBeenCalled();
    const s: any = await call('approval_status', { id: seen!.id });
    expect(s.structured).toEqual({ id: seen!.id, status: 'denied', reason: 'Too risky' });
  });

  it('times out to pending, then approval_status reports approved with the stored result', async () => {
    const { hub, gm, call, handler } = setup();
    let settled = false;
    const done = call('write_thing', { id: 'late' }).then((r) => ((settled = true), r));
    await hub.advance(APPROVAL_CONFIG.APPROVAL_WAIT_MS - 1);
    expect(settled).toBe(false);
    await hub.advance(1);
    const r: any = await done;
    expect(r.structured).toEqual({ status: 'pending_approval', id: expect.any(String) });
    const id = pendingId(r);
    expect(((await call('approval_status', { id })) as any).structured).toEqual({
      id,
      status: 'pending',
    });
    gm.manager.resolveApproval(id, { decision: 'approve' });
    await settle();
    expect(handler).toHaveBeenCalledTimes(1);
    const s: any = await call('approval_status', { id });
    expect(s.structured).toEqual({
      id,
      status: 'approved',
      result: 'ran write_thing {"id":"late"}',
      resultFailed: false,
    });
  });

  it('an approved call that errors is reported as failed', async () => {
    const { hub, gm, call, p1 } = setup();
    const p = pipeline(p1);
    p.handler.mockRejectedValueOnce(new Error('boom'));
    const done = p.call('write_thing');
    await hub.advance(APPROVAL_CONFIG.APPROVAL_WAIT_MS);
    const id = pendingId(await done);
    gm.manager.resolveApproval(id, { decision: 'approve' });
    await settle();
    const s: any = await call('approval_status', { id });
    expect(s.structured).toMatchObject({ status: 'approved', resultFailed: true });
  });

  it('an offline approver gets the queued request when they connect, once', async () => {
    const hub = world();
    hub.users.get('gm')!.online = false;
    hub.users.get('gm2')!.online = false;
    const p1 = hub.client('p1');
    const gm = hub.client('gm');
    const { call, handler } = pipeline(p1);
    const done = call('write_thing');
    await settle();
    expect(gm.manager.listPending()).toEqual([]);
    expect(hub.sent).toEqual([]); // nobody to tell, so it only queues
    hub.connect('gm');
    expect(gm.manager.listPending()).toHaveLength(1);
    // A reconnect re-sends; the approver does not see a duplicate.
    p1.manager.representAll();
    hub.connect('gm');
    expect(gm.manager.listPending()).toHaveLength(1);
    expect(gm.hooks.filter((h) => h.name === 'agentGateway.approvalRequested')).toHaveLength(1);
    gm.manager.resolveApproval(gm.manager.listPending()[0]!.id, { decision: 'approve' });
    await done;
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('a request is not sent to a player who is not eligible', async () => {
    const { hub, call } = setup('gm');
    hub.client('p2');
    void call('write_thing');
    await settle();
    expect(hub.sent.every((m) => !m.to || !m.to.includes('p2'))).toBe(true);
    expect(hub.clients.get('p2')!.manager.listPending()).toEqual([]);
  });

  it('after a reload the unfinished request is expired, not run: the agent must ask again', async () => {
    const { hub, p1, gm, call } = setup();
    void call('write_thing', { id: 'reload' });
    await settle();
    const id = p1.manager.listPending()[0]!.id;
    expect(gm.manager.listPending()).toHaveLength(1);
    // Reload: a fresh manager over the same browser storage; the in-flight call is gone.
    const p1b = hub.client('p1', { storage: p1.storage });
    const again = pipeline(p1b);
    p1b.manager.load();
    // The GM's copy is withdrawn and cannot be approved into a call that no longer exists.
    expect(gm.manager.listPending()).toEqual([]);
    expect(gm.manager.resolveApproval(id, { decision: 'approve' })).toBe(false);
    expect(p1b.manager.resolveApproval(id, { decision: 'approve' })).toBe(false);
    await settle();
    expect(again.handler).not.toHaveBeenCalled();
    const s: any = await again.call('approval_status', { id });
    expect(s.structured).toEqual({ id, status: 'expired' });
    // A fresh call asks afresh.
    void again.call('write_thing', { id: 'reload' });
    await settle();
    expect(p1b.manager.listPending()).toHaveLength(1);
  });

  it('fires approvalRequested and approvalResolved on the requester', async () => {
    const { p1, call } = setup();
    const done = call('write_thing');
    await settle();
    expect(p1.hooks[0]).toMatchObject({
      name: 'agentGateway.approvalRequested',
      payload: { tool: 'write_thing', local: true },
    });
    p1.manager.resolveApproval(p1.manager.listPending()[0]!.id, { decision: 'deny', reason: 'no' });
    await done;
    expect(p1.hooks[1]).toMatchObject({
      name: 'agentGateway.approvalResolved',
      payload: { status: 'denied', reason: 'no' },
    });
  });

  it('limits the pending requests one agent may hold open', async () => {
    const { call } = setup();
    for (let i = 0; i < APPROVAL_CONFIG.MAX_PENDING_PER_AGENT; i++)
      void call('write_thing', { id: String(i) });
    await settle();
    expect(await call('write_thing', { id: 'one-too-many' })).toMatchObject({
      error: { code: 'RATE_LIMITED' },
    });
  });
});

describe('approve for this session', () => {
  it('skips asking for later calls of that tool in the same session only', async () => {
    const { gm, call, handler } = setup();
    const first = call('write_thing', { id: '1' });
    await settle();
    gm.manager.resolveApproval(gm.manager.listPending()[0]!.id, {
      decision: 'approve',
      scope: 'session',
    });
    await first;
    // Later calls with other arguments run without asking.
    expect(await call('write_thing', { id: '2' })).toMatchObject({ text: expect.any(String) });
    expect(handler).toHaveBeenCalledTimes(2);
    // Another session, another tool and another agent still ask.
    void call('write_thing', { id: '3' }, { sessionId: 's2' });
    void call('other_write', { id: '3' });
    void call('write_thing', { id: '3' }, { agent: agentOf('p1', 'someone-else') });
    await settle();
    expect(handler).toHaveBeenCalledTimes(2);
    expect(gm.manager.listPending()).toHaveLength(3);
  });

  it('is never granted for code: every code call asks again', async () => {
    const { gm, call, handler } = setup('gm');
    const first = call('code_thing');
    await settle();
    gm.manager.resolveApproval(gm.manager.listPending()[0]!.id, {
      decision: 'approve',
      scope: 'session',
    });
    await first;
    void call('code_thing');
    await settle();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(gm.manager.listPending()).toHaveLength(1);
  });

  it("an owner's session grant does not cover a call that needs a GM", async () => {
    const { p1, asking, call, handler } = setup();
    const first = call('write_thing');
    await settle();
    p1.manager.resolveApproval(p1.manager.listPending()[0]!.id, {
      decision: 'approve',
      scope: 'session',
    });
    await first;
    asking.write_thing = 'gm'; // the policy tightened
    void call('write_thing', { id: 'again' });
    await settle();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('a denied request grants nothing', async () => {
    const { gm, call, handler } = setup();
    const first = call('write_thing');
    await settle();
    gm.manager.resolveApproval(gm.manager.listPending()[0]!.id, {
      decision: 'deny',
      scope: 'session',
    });
    await first;
    void call('write_thing');
    await settle();
    expect(handler).not.toHaveBeenCalled();
  });
});
