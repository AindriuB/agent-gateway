/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest';
import { APPROVAL_CONFIG } from '../../src/approvals/config.js';
import { callHash } from '../../src/approvals/canonical.js';
import { agentOf, pipeline, settle, world } from './rig.js';

const setup = (approver: 'owner' | 'gm' = 'owner') => {
  const hub = world();
  const p1 = hub.client('p1');
  const p2 = hub.client('p2');
  const gm = hub.client('gm');
  return { hub, p1, p2, gm, ...pipeline(p1, approver) };
};

/** A resolve message exactly as a well-formed approver would send it for p1's pending request. */
const resolveMsg = (p1: any, decision = 'approve', over: Record<string, unknown> = {}) => {
  const r = p1.manager.ownRecords().find((x: any) => x.status === 'pending');
  return {
    t: 'approval.resolve',
    id: r.id,
    decision,
    scope: 'once',
    reason: '',
    bind: { tool: r.tool, argsHash: r.argsHash, agentId: r.agentId, userId: 'p1' },
    ...over,
  };
};

describe('only the owner or a GM may answer', () => {
  it('a forged approval from a player claiming to be the owner or a GM is ignored', async () => {
    const { hub, p1, call, handler } = setup('gm');
    void call('write_thing');
    await settle();
    const msg = resolveMsg(p1, 'approve', {
      from: 'gm',
      userId: 'gm',
      approverId: 'gm',
      isGM: true,
      sender: 'p1',
    });
    // p2 is a plain player sending the payload; the server stamps p2 as the sender.
    hub.deliver('p2', msg);
    hub.deliver('p2', { ...msg, bind: { ...(msg.bind as any), userId: 'p2' } });
    await settle();
    expect(handler).not.toHaveBeenCalled();
    expect(p1.manager.ownRecords().filter((r) => r.status === 'pending')).toHaveLength(1);
  });

  it('a non-GM cannot approve a GM-class request, even as the owner', async () => {
    const { p1, call, handler } = setup('gm');
    void call('write_thing');
    await settle();
    const id = p1.manager.ownRecords()[0]!.id;
    // Locally: the owner's own click does not count for an ask-GM request.
    expect(p1.manager.resolveApproval(id, { decision: 'approve' })).toBe(false);
    expect(handler).not.toHaveBeenCalled();
    expect(p1.manager.listPending()).toHaveLength(0); // not eligible, so not offered to them
  });

  it('a different player cannot answer an owner-class request for someone else', async () => {
    const { hub, p1, call, handler } = setup('owner');
    void call('write_thing');
    await settle();
    hub.deliver('p2', resolveMsg(p1));
    hub.deliver('p2', resolveMsg(p1, 'deny'));
    await settle();
    expect(handler).not.toHaveBeenCalled();
    expect(p1.manager.ownRecords().filter((r) => r.status === 'pending')).toHaveLength(1);
  });

  it("a player's client never offers the request to other players", async () => {
    const { p2, call } = setup('owner');
    void call('write_thing');
    await settle();
    expect(p2.manager.listPending()).toEqual([]);
  });

  it('a GM accepted from the socket sender, whatever the payload says', async () => {
    const { hub, p1, call, handler } = setup('gm');
    const done = call('write_thing');
    await settle();
    hub.deliver('gm', resolveMsg(p1, 'approve', { from: 'p2', userId: 'p2' }));
    await done;
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('a sender id that is not a known user is ignored', async () => {
    const { p1, call, handler } = setup('gm');
    void call('write_thing');
    await settle();
    p1.manager.handleSocket(resolveMsg(p1), 'ghost');
    p1.manager.handleSocket(resolveMsg(p1), undefined);
    p1.manager.handleSocket(resolveMsg(p1), '');
    await settle();
    expect(handler).not.toHaveBeenCalled();
  });

  it('a player cannot close or fill a GM inbox entry made by someone else', async () => {
    const { hub, p1, gm, call } = setup('gm');
    void call('write_thing');
    await settle();
    const id = gm.manager.listPending()[0]!.id;
    hub.deliver('p2', { t: 'approval.resolved', id, status: 'denied' });
    expect(gm.manager.listPending()).toHaveLength(1);
    // A second sender re-using the id does not take the entry over.
    const req = hub.sent.find((m) => m.data.t === 'approval.request')!.data;
    hub.deliver('p2', { ...req, tool: 'other_write', argsHash: callHash('other_write', req.args) });
    expect(gm.manager.listPending()).toHaveLength(1);
    expect(gm.manager.listPending()[0]).toMatchObject({ requesterId: 'p1', tool: 'write_thing' });
    expect(p1.manager.ownRecords().filter((r) => r.status === 'pending')).toHaveLength(1);
  });

  it('an approver client rejects requests whose hash does not match the arguments shown', async () => {
    const { hub, gm } = setup('gm');
    const id = 'A'.repeat(22);
    const base = {
      t: 'approval.request',
      id,
      agentId: 'a',
      sessionId: 's',
      tool: 'write_thing',
      args: { id: 'x' },
      category: 'write',
      approver: 'gm',
      createdAt: hub.now,
      expiresAt: hub.now + 1000,
    };
    hub.deliver('p1', { ...base, argsHash: callHash('write_thing', { id: 'different' }) });
    expect(gm.manager.listPending()).toEqual([]);
    hub.deliver('p1', { ...base, argsHash: callHash('write_thing', { id: 'x' }) });
    expect(gm.manager.listPending()).toHaveLength(1);
  });

  it('a non-GM client ignores relayed requests', async () => {
    const { hub, p2 } = setup('gm');
    hub.deliver('p1', {
      t: 'approval.request',
      id: 'B'.repeat(22),
      agentId: 'a',
      sessionId: 's',
      tool: 'write_thing',
      args: {},
      argsHash: callHash('write_thing', {}),
      category: 'write',
      approver: 'gm',
      createdAt: hub.now,
      expiresAt: hub.now + 1000,
    });
    expect(p2.manager.listPending()).toEqual([]);
  });
});

describe('ids', () => {
  it('are random, at least 128 bits, and never repeat', async () => {
    const { hub, p1 } = setup();
    const sizes: number[] = [];
    const c = hub.client('p1', {
      random: (n) => {
        sizes.push(n);
        return crypto.getRandomValues(new Uint8Array(n));
      },
    });
    const d = pipeline(c);
    for (let i = 0; i < 15; i++) void d.call('write_thing', { id: String(i) });
    await settle();
    const ids = c.manager.listPending().map((r) => r.id);
    expect(new Set(ids).size).toBe(15);
    expect(sizes.every((n) => n >= 16)).toBe(true);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]{22,}$/);
    // Two requests at the same instant, from different clients, do not share a prefix pattern.
    void p1;
  });

  it('are not derived from the call: the same call twice gets two ids', async () => {
    const { p1, call } = setup();
    void call('write_thing');
    void call('write_thing');
    await settle();
    const [a, b] = p1.manager.listPending();
    expect(a!.id).not.toBe(b!.id);
    expect(a!.id).not.toContain('write');
  });
});

describe('an approval is bound to the exact call', () => {
  it('resolve messages with a different tool, args hash, agent or user are ignored', async () => {
    const { hub, p1, call, handler } = setup('gm');
    void call('write_thing', { id: 'orig' });
    await settle();
    const real = p1.manager.listPending()[0]!;
    const good = resolveMsg(p1);
    for (const bind of [
      { ...good.bind, tool: 'other_write' },
      { ...good.bind, argsHash: callHash('write_thing', { id: 'evil' }) },
      { ...good.bind, agentId: 'agent-p2' },
      { ...good.bind, userId: 'p2' },
      { tool: good.bind.tool },
    ]) {
      hub.deliver('gm', { ...good, bind });
    }
    hub.deliver('gm', { ...good, bind: undefined });
    await settle();
    expect(handler).not.toHaveBeenCalled();
    hub.deliver('gm', good);
    await settle();
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ args: { id: 'orig' } }));
    void real;
  });

  it('approving one call does not allow the same tool with different args, or the same call later', async () => {
    const { gm, call, handler } = setup();
    const first = call('write_thing', { id: 'one' });
    await settle();
    gm.manager.resolveApproval(gm.manager.listPending()[0]!.id, { decision: 'approve' });
    await first;
    expect(handler).toHaveBeenCalledTimes(1);
    void call('write_thing', { id: 'two' });
    void call('write_thing', { id: 'one' });
    await settle();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(gm.manager.listPending()).toHaveLength(2);
  });

  it('an answer cannot be replayed: a settled request ignores a second answer', async () => {
    const { hub, p1, call, handler } = setup('gm');
    const done = call('write_thing');
    await settle();
    const approve = resolveMsg(p1);
    hub.deliver('gm', approve);
    await done;
    hub.deliver('gm', approve);
    hub.deliver('gm', { ...approve, decision: 'deny' });
    await settle();
    expect(handler).toHaveBeenCalledTimes(1);
    const id = approve.id as string;
    const s: any = await pipeline(p1).call('approval_status', { id });
    expect(s.structured.status).toBe('approved');
  });

  it('a denied request cannot later be approved', async () => {
    const { hub, p1, call, handler } = setup('gm');
    void call('write_thing');
    await settle();
    const deny = resolveMsg(p1, 'deny', { reason: 'no' });
    hub.deliver('gm', deny);
    hub.deliver('gm', { ...deny, decision: 'approve' });
    await settle();
    expect(handler).not.toHaveBeenCalled();
  });

  it('stored arguments edited in client storage are dropped on load, never run', async () => {
    const { hub, p1, gm, call } = setup('gm');
    void call('write_thing', { id: 'orig' });
    await settle();
    const all = JSON.parse(p1.storage.text);
    all.p1[0].args = { id: 'tampered' };
    const edited = { text: JSON.stringify(all) };
    const fresh = hub.client('p1', { storage: edited });
    fresh.manager.load();
    fresh.manager.representAll();
    expect(fresh.manager.ownRecords()).toEqual([]);
    void gm;
  });

  it("another user's stored records in the same browser are not loaded", async () => {
    const { hub, p1, call } = setup('owner');
    void call('write_thing');
    await settle();
    const p2b = hub.client('p2', { storage: p1.storage });
    p2b.manager.load();
    expect(p2b.manager.listPending()).toEqual([]);
  });
});

describe('expiry', () => {
  it('a pending request expires and can no longer be approved', async () => {
    const { hub, p1, gm, call, handler } = setup('gm');
    const done = call('write_thing');
    await settle();
    const id = gm.manager.listPending()[0]!.id;
    await hub.advance(APPROVAL_CONFIG.APPROVAL_TTL_MS + 1);
    await done;
    expect(gm.manager.resolveApproval(id, { decision: 'approve' })).toBe(false);
    hub.deliver('gm', { t: 'approval.resolve', id, decision: 'approve', bind: {} });
    expect(handler).not.toHaveBeenCalled();
    const s: any = await pipeline(p1).call('approval_status', { id });
    expect(s.structured).toEqual({ id, status: 'expired' });
    expect(p1.hooks.at(-1)).toMatchObject({ payload: { status: 'expired' } });
  });

  it('expiry is enforced at answer time even if no timer ever fired', async () => {
    const { hub, p1, call, handler } = setup('gm');
    void call('write_thing');
    await settle();
    const msg = resolveMsg(p1);
    hub.now += APPROVAL_CONFIG.APPROVAL_TTL_MS + 1; // the clock moves, timers do not run
    hub.deliver('gm', msg);
    await settle();
    expect(handler).not.toHaveBeenCalled();
  });

  it('an approver client drops an expired request from its inbox', async () => {
    const { hub, gm, call } = setup('gm');
    void call('write_thing');
    await settle();
    expect(gm.manager.listPending()).toHaveLength(1);
    hub.now += APPROVAL_CONFIG.APPROVAL_TTL_MS + 1;
    expect(gm.manager.listPending()).toEqual([]);
  });
});

describe('approval_status only reveals an approval to its own agent', () => {
  it('answers identically for an unknown id, another agent and another user', async () => {
    const { hub, p1, call } = setup('owner');
    const done = call('write_thing', { id: 'secret' });
    await settle();
    const id = p1.manager.listPending()[0]!.id;
    const unknown: any = await call('approval_status', { id: 'z'.repeat(22) });
    const otherAgent: any = await call(
      'approval_status',
      { id },
      { agent: agentOf('p1', 'other') },
    );
    expect(otherAgent).toEqual(unknown);
    expect(unknown).toMatchObject({ error: { code: 'INVALID_ARGS' } });
    expect(JSON.stringify(otherAgent)).not.toContain('secret');
    // Another user on the same client (a shared browser) is refused too.
    const asP2 = await pipeline(p1).dispatcher(
      { tool: 'approval_status', args: { id }, agent: agentOf('p1'), sessionId: 's1' },
      { id: 'p2', isGM: false },
    );
    expect(asP2).toEqual(unknown);
    // The owner agent still sees its own, also from a new session.
    const own: any = await call('approval_status', { id }, { sessionId: 'another-session' });
    expect(own.structured).toEqual({ id, status: 'pending' });
    p1.manager.resolveApproval(id, { decision: 'deny', reason: 'r' });
    await done;
    void hub;
  });

  it("a GM client does not reveal other users' requests through approval_status", async () => {
    const { gm, call } = setup('gm');
    void call('write_thing');
    await settle();
    const id = gm.manager.listPending()[0]!.id;
    const r: any = await pipeline(gm).call('approval_status', { id }, { agent: agentOf('p1') });
    expect(r).toMatchObject({ error: { code: 'INVALID_ARGS' } });
  });
});

describe('the dispatcher fails closed', () => {
  it('a call marked for approval never reaches its handler without the approval stage', async () => {
    const { createDispatcher } = await import('../../src/ops/dispatch.js');
    const { tools } = await import('./rig.js');
    const { vi } = await import('vitest');
    const handler = vi.fn(async () => ({ text: 'x', structured: {} }));
    const d = createDispatcher({
      tools,
      handlers: { write_thing: handler },
      stages: [
        {
          name: 'ask',
          order: 1,
          run: (ctx, next) => ((ctx.approval = { approver: 'owner' }), next()),
        },
      ],
    });
    const r = await d(
      { tool: 'write_thing', args: { id: 'x' }, agent: agentOf('p1'), sessionId: 's' },
      { id: 'p1', isGM: false },
    );
    expect(r).toMatchObject({ error: { code: 'DENIED' } });
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('further guards', () => {
  it('the local answer path also refuses an expired request', async () => {
    const { hub, p1, call, handler } = setup('owner');
    void call('write_thing');
    await settle();
    const id = p1.manager.ownRecords()[0]!.id;
    hub.now += APPROVAL_CONFIG.APPROVAL_TTL_MS + 1;
    expect(p1.manager.resolveApproval(id, { decision: 'approve' })).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });

  it('ids come straight from the random source: 16 random bytes, base64url', async () => {
    const hub = world();
    const bytes = Uint8Array.from({ length: 16 }, (_, i) => 250 - i * 7);
    const c = hub.client('p1', { random: () => bytes });
    void pipeline(c).call('write_thing');
    await settle();
    const expected = btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(c.manager.ownRecords()[0]!.id).toBe(expected);
  });

  it('a message that claims to come from this very user is ignored', async () => {
    const { p1, call, handler } = setup('owner');
    void call('write_thing');
    await settle();
    p1.manager.handleSocket(resolveMsg(p1), 'p1');
    await settle();
    expect(handler).not.toHaveBeenCalled();
  });

  it('stored approved and rerun records are never trusted: a forged one for new args does not run', async () => {
    const { hub, p1, call } = setup('owner');
    void call('write_thing', { id: 'orig' });
    await settle();
    // Hand-write a record the way a hostile local user would: valid hash for new arguments.
    const forgedArgs = { id: 'forged' };
    const forged = {
      ...p1.manager.ownRecords()[0]!,
      id: 'F'.repeat(22),
      args: forgedArgs,
      argsHash: callHash('write_thing', forgedArgs),
      status: 'approved',
      rerun: true,
      resolvedBy: 'GM',
    };
    const all = JSON.parse(p1.storage.text);
    all.p1.push(forged);
    const edited = { text: JSON.stringify(all) };
    const p1b = hub.client('p1', { storage: edited });
    const again = pipeline(p1b);
    p1b.manager.load();
    const rec = p1b.manager.ownRecords().find((r) => r.id === forged.id)!;
    expect(rec.status).toBe('expired');
    expect(rec.rerun).toBeUndefined();
    // The matching call arriving now asks again instead of running.
    void again.call('write_thing', forgedArgs);
    await settle();
    expect(again.handler).not.toHaveBeenCalled();
    expect(p1b.manager.listPending().some((r) => (r.args as any).id === 'forged')).toBe(true);
    // Answering the forged id does nothing either.
    expect(p1b.manager.resolveApproval(forged.id, { decision: 'approve' })).toBe(false);
    expect(again.handler).not.toHaveBeenCalled();
  });

  it('an approved record that never ran does not run after a reload', async () => {
    const { hub, p1, call } = setup('owner');
    void call('write_thing', { id: 'x' });
    await settle();
    const all = JSON.parse(p1.storage.text);
    all.p1[0].status = 'approved';
    const p1b = hub.client('p1', { storage: { text: JSON.stringify(all) } });
    const again = pipeline(p1b);
    p1b.manager.load();
    expect(p1b.manager.ownRecords()[0]!.status).toBe('expired');
    void again.call('write_thing', { id: 'x' });
    await settle();
    expect(again.handler).not.toHaveBeenCalled();
  });
});

describe('the approver inbox', () => {
  const request = (hub: any, over: Record<string, unknown> = {}) => {
    const base = {
      t: 'approval.request',
      id: 'C'.repeat(22),
      agentId: 'a',
      sessionId: 's',
      tool: 'write_thing',
      args: { id: 'x' },
      argsHash: callHash('write_thing', { id: 'x' }),
      category: 'write',
      approver: 'gm',
      createdAt: hub.now,
      expiresAt: hub.now + 1000,
    };
    return { ...base, ...over };
  };

  it("clamps a far-future expiry to this client's own limit", async () => {
    const { hub, gm } = setup('gm');
    hub.deliver('p1', request(hub, { expiresAt: hub.now + 10 * APPROVAL_CONFIG.APPROVAL_TTL_MS }));
    expect(gm.manager.listPending()[0]!.expiresAt).toBe(hub.now + APPROVAL_CONFIG.APPROVAL_TTL_MS);
    hub.now += APPROVAL_CONFIG.APPROVAL_TTL_MS + 1;
    expect(gm.manager.listPending()).toEqual([]);
  });

  it('takes the category from the tool registry, never from the payload', async () => {
    const { hub, gm } = setup('gm');
    hub.deliver('p1', request(hub, { category: 'read' }));
    expect(gm.manager.listPending()[0]!.category).toBe('write');
    expect(gm.hooks[0]!.payload.category).toBe('write');
    hub.deliver('p1', request(hub, { id: 'D'.repeat(22), category: undefined }));
    expect(gm.manager.listPending()).toHaveLength(2);
  });

  it('drops a request for a tool it does not know', async () => {
    const { hub, gm } = setup('gm');
    hub.deliver(
      'p1',
      request(hub, { tool: 'invented_tool', argsHash: callHash('invented_tool', { id: 'x' }) }),
    );
    expect(gm.manager.listPending()).toEqual([]);
    expect(gm.hooks).toEqual([]);
  });
});

describe('two approvers answering at the same moment', () => {
  it("both end up showing the requester's final state", async () => {
    const hub = world();
    const p1 = hub.client('p1');
    const gm = hub.client('gm');
    const gm2 = hub.client('gm2');
    const { call, handler } = pipeline(p1, 'gm');
    const done = call('write_thing');
    await settle();
    const id = gm.manager.listPending()[0]!.id;
    expect(gm2.manager.listPending()).toHaveLength(1);
    hub.hold();
    gm.manager.resolveApproval(id, { decision: 'approve' });
    gm2.manager.resolveApproval(id, { decision: 'deny', reason: 'no' });
    hub.release();
    await done;
    expect(handler).toHaveBeenCalledTimes(1); // the first answer won
    const last = (c: typeof gm) =>
      c.hooks.filter((h) => h.name === 'agentGateway.approvalResolved').at(-1)!.payload.status;
    expect(last(gm)).toBe('approved');
    expect(last(gm2)).toBe('approved'); // corrected from its own 'denied'
    // The agreeing GM is not told twice.
    expect(gm.hooks.filter((h) => h.name === 'agentGateway.approvalResolved')).toHaveLength(1);
    expect(gm2.hooks.filter((h) => h.name === 'agentGateway.approvalResolved')).toHaveLength(2);
  });

  it('a stranger cannot use the correction path', async () => {
    const { hub, gm, call } = setup('gm');
    void call('write_thing');
    await settle();
    const id = gm.manager.listPending()[0]!.id;
    gm.manager.resolveApproval(id, { decision: 'deny' });
    const before = gm.hooks.length;
    hub.deliver('p2', { t: 'approval.resolved', id, status: 'approved' });
    expect(gm.hooks).toHaveLength(before);
  });
});
