import { describe, expect, it } from 'vitest';
import { APPROVAL_CONFIG } from '../../src/approvals/config.js';
import { agentOf, pendingId, pipeline, settle, world } from './rig.js';

const WAIT = APPROVAL_CONFIG.APPROVAL_WAIT_MS;

const setup = () => {
  const hub = world();
  const p1 = hub.client('p1');
  hub.client('gm');
  hub.client('gm2');
  return { hub, p1, ...pipeline(p1, 'owner') };
};

const requestsTo = (hub: ReturnType<typeof world>, user: string) =>
  hub.sent.filter((m) => m.data.t === 'approval.request' && (m.to ?? []).includes(user));

/** The link dropped: the first call's caller is gone (its promise is never read again). */
describe('approval across a link drop', () => {
  it('a retry before the wait ends joins the pending record, and the approval runs it once', async () => {
    const { hub, p1, call, handler } = setup();
    void call('write_thing', { id: 'a' }); // the call the drop cut off
    await settle();
    expect(p1.manager.listPending()).toHaveLength(1);
    const id = p1.manager.listPending()[0]!.id;
    const before = requestsTo(hub, 'gm').length;

    p1.manager.linkDropped();
    await hub.advance(3_000);
    p1.manager.representAll(); // the link reconnected in the same tab
    expect(requestsTo(hub, 'gm').length).toBe(before + 1);

    const retry = call('write_thing', { id: 'a' });
    await settle();
    expect(p1.manager.listPending()).toHaveLength(1);
    expect(p1.manager.listPending()[0]!.id).toBe(id);

    expect(p1.manager.resolveApproval(id, { decision: 'approve' })).toBe(true);
    expect(await retry).toEqual({ text: 'ran write_thing {"id":"a"}', structured: {} });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('a retry that waits out APPROVAL_WAIT_MS gets pending_approval with the same id', async () => {
    const { hub, p1, call, handler } = setup();
    void call('write_thing', { id: 'a' });
    await settle();
    const id = p1.manager.listPending()[0]!.id;
    p1.manager.linkDropped();
    const retry = call('write_thing', { id: 'a' });
    await hub.advance(WAIT);
    expect(pendingId(await retry)).toBe(id);
    expect(p1.manager.listPending()).toHaveLength(1);
    p1.manager.resolveApproval(id, { decision: 'approve' });
    await settle();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('after the wait, approval_status says pending, then approved with the result; the call runs once', async () => {
    const { hub, p1, call, handler } = setup();
    const first = call('write_thing', { id: 'a' });
    await hub.advance(WAIT);
    const id = pendingId(await first); // the agent has the id, then the link drops
    p1.manager.linkDropped();
    p1.manager.representAll();
    expect(await call('approval_status', { id })).toMatchObject({
      structured: { id, status: 'pending' },
    });
    p1.manager.resolveApproval(id, { decision: 'approve' });
    await settle();
    expect(await call('approval_status', { id })).toMatchObject({
      structured: { id, status: 'approved', result: 'ran write_thing {"id":"a"}' },
    });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('approval before the result frame is sent: status has the result, a later retry asks again', async () => {
    const { p1, call, handler } = setup();
    void call('write_thing', { id: 'a' }); // approved while the link is down: the reply is lost
    await settle();
    p1.manager.linkDropped();
    const id = p1.manager.listPending()[0]!.id;
    p1.manager.resolveApproval(id, { decision: 'approve' });
    await settle();
    expect(await call('approval_status', { id })).toMatchObject({
      structured: { id, status: 'approved', result: 'ran write_thing {"id":"a"}' },
    });
    expect(handler).toHaveBeenCalledTimes(1);

    void call('write_thing', { id: 'a' });
    await settle();
    const open = p1.manager.listPending();
    expect(open).toHaveLength(1);
    expect(open[0]!.id).not.toBe(id);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['args', 'write_thing', { id: 'b' }, {}],
    ['tool', 'other_write', { id: 'a' }, {}],
    ['session', 'write_thing', { id: 'a' }, { sessionId: 's2' }],
    ['agent', 'write_thing', { id: 'a' }, { agent: agentOf('p1', 'other-agent') }],
  ])('a retry with a different %s creates a new record', async (_n, tool, args, o) => {
    const { p1, call } = setup();
    void call('write_thing', { id: 'a' });
    await settle();
    p1.manager.linkDropped();
    void call(tool, args, o);
    await settle();
    expect(p1.manager.listPending()).toHaveLength(2);
  });

  it('a different user creates a new record', async () => {
    const { hub, p1 } = setup();
    const p2 = hub.client('p2');
    const a = pipeline(p1, 'owner');
    const b = pipeline(p2, 'owner');
    void a.call('write_thing', { id: 'a' });
    p1.manager.linkDropped();
    void b.call('write_thing', { id: 'a' });
    await settle();
    expect(p1.manager.listPending()).toHaveLength(1);
    expect(p2.manager.listPending()).toHaveLength(1);
    expect(p1.manager.listPending()[0]!.id).not.toBe(p2.manager.listPending()[0]!.id);
  });
});

describe('two live calls', () => {
  it('without a drop, the same call twice still gets two records', async () => {
    const { p1, call } = setup();
    void call('write_thing', { id: 'a' });
    void call('write_thing', { id: 'a' });
    await settle();
    expect(p1.manager.listPending()).toHaveLength(2);
  });
});
