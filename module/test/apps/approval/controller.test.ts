import { describe, expect, it, vi } from 'vitest';
import {
  ApprovalUiController,
  type ApprovalGroup,
  type PendingApproval,
} from '../../../src/apps/approval/controller.js';
import { pipeline, settle, world } from '../../approvals/rig.js';

const request = (id: string, overrides: Partial<PendingApproval> = {}): PendingApproval => ({
  id,
  agentId: 'agent',
  sessionId: 'session',
  tool: 'fixture_write',
  args: {},
  argsHash: 'hash',
  category: 'write',
  approver: 'owner',
  createdAt: 0,
  expiresAt: 10000,
  requesterId: 'owner',
  local: true,
  ...overrides,
});
function rig() {
  let pending: PendingApproval[] = [];
  let gm = true;
  let now = 0;
  let groups: ApprovalGroup[] = [];
  const hooks = new Map<string, () => void>();
  const resolveApproval = vi.fn((id: string) => {
    pending = pending.filter((r) => r.id !== id);
    return true;
  });
  const manager = { listPending: () => pending, resolveApproval, ownRecords: () => [] };
  const lookup = vi.fn(() => manager);
  const controller = new ApprovalUiController({
    manager: lookup,
    isGM: () => gm,
    now: () => now,
    on: (h, callback) => {
      expect(hooks.has(h)).toBe(false);
      hooks.set(h, callback);
    },
    present: (g) => {
      groups = g;
    },
  });
  return {
    controller,
    hooks,
    resolveApproval,
    lookup,
    groups: () => groups,
    setPending: (p: PendingApproval[]) => {
      pending = p;
    },
    setGM: (v: boolean) => {
      gm = v;
    },
    time: (v: number) => {
      now = v;
    },
  };
}

describe('approval UI lifecycle and batching', () => {
  it('looks up the manager lazily, installs once, and replays already pending requests', () => {
    const r = rig();
    expect(r.lookup).not.toHaveBeenCalled();
    r.setPending([request('early')]);
    r.controller.install();
    expect(r.groups()[0]?.requests.map((p) => p.id)).toEqual(['early']);
    r.controller.install();
    expect(r.hooks.size).toBe(3);
    expect(r.groups()).toHaveLength(1);
    r.setPending([]);
    r.hooks.get('agentGateway.approvalResolved')!();
    expect(r.groups()).toEqual([]);
  });
  it('groups within 2 seconds, isolates agents/sessions, and closes the original batch window', () => {
    const r = rig();
    const first = request('first');
    r.setPending([first]);
    r.controller.install();
    r.time(1999);
    r.setPending([
      first,
      request('second'),
      request('other-agent', { agentId: 'other' }),
      request('other-session', { sessionId: 'other' }),
    ]);
    r.controller.refresh();
    expect(r.groups().map((g) => g.requests.map((p) => p.id))).toEqual([
      ['first', 'second'],
      ['other-agent'],
      ['other-session'],
    ]);
    r.time(2001);
    r.setPending([first, request('second'), request('late')]);
    r.controller.refresh();
    expect(r.groups().map((g) => g.requests.map((p) => p.id))).toEqual([
      ['first', 'second'],
      ['late'],
    ]);
    r.controller.approveGroup(r.groups()[0]!.id);
    expect(r.resolveApproval.mock.calls.map((c) => c[0])).toEqual(['first', 'second']);
    expect(r.groups()[0]?.requests.map((p) => p.id)).toEqual(['late']);
  });
  it('rechecks GM status before displaying or answering a remote request', () => {
    const r = rig();
    r.setPending([request('remote', { local: false })]);
    r.controller.install();
    r.setGM(false);
    expect(r.controller.resolve('remote', { decision: 'approve' })).toBe(false);
    expect(r.resolveApproval).not.toHaveBeenCalled();
    expect(r.groups()).toEqual([]);
  });
  it('an oversized request can be denied but cannot be approved individually or in a batch', () => {
    const r = rig();
    r.setPending([request('huge', { args: { text: 'x'.repeat(1000001) } })]);
    r.controller.install();
    expect(r.controller.resolve('huge', { decision: 'approve' })).toBe(false);
    r.controller.approveGroup(r.groups()[0]!.id);
    expect(r.resolveApproval).not.toHaveBeenCalled();
    expect(r.controller.resolve('huge', { decision: 'deny', reason: 'Split this request' })).toBe(
      true,
    );
  });
  it('ignores forged hook payloads and stale pending rows', () => {
    const r = rig();
    r.controller.install();
    r.hooks.get('agentGateway.approvalRequested')!();
    expect(r.groups()).toEqual([]);
    r.setPending([request('old')]);
    r.controller.refresh();
    r.setPending([]);
    expect(r.controller.resolve('old', { decision: 'approve' })).toBe(false);
    expect(r.resolveApproval).not.toHaveBeenCalled();
  });
  it('requires denial reason and forwards per-row session approval', () => {
    const r = rig();
    r.setPending([request('deny'), request('approve')]);
    r.controller.install();
    expect(r.controller.resolve('deny', { decision: 'deny', reason: '\u0000\t ' })).toBe(false);
    expect(r.controller.resolve('deny', { decision: 'deny', reason: 'Explain why' })).toBe(true);
    expect(r.resolveApproval).toHaveBeenCalledWith('deny', {
      decision: 'deny',
      reason: 'Explain why',
    });
    expect(r.controller.resolve('approve', { decision: 'approve', scope: 'session' })).toBe(true);
    expect(r.resolveApproval).toHaveBeenCalledWith('approve', {
      decision: 'approve',
      scope: 'session',
    });
  });
});

describe('UI actions through the real approval manager and dispatcher', () => {
  it('returns the typed denial reason to the agent without executing the handler', async () => {
    const hub = world();
    const player = hub.client('p1');
    const p = pipeline(player);
    const done = p.call('write_thing');
    await settle();
    const controller = new ApprovalUiController({
      manager: () => player.manager,
      isGM: () => false,
      now: () => 0,
      on: () => {},
      present: () => {},
    });
    controller.install();
    const id = player.manager.listPending()[0]!.id;
    expect(controller.resolve(id, { decision: 'deny', reason: 'Keep this actor unchanged' })).toBe(
      true,
    );
    expect(await done).toMatchObject({
      error: { code: 'DENIED', message: expect.stringContaining('Keep this actor unchanged') },
    });
    expect(p.handler).not.toHaveBeenCalled();
  });
  it('approve-all executes both real pending handlers once and per-row approval works', async () => {
    const hub = world();
    const player = hub.client('p1');
    const p = pipeline(player);
    const first = p.call('write_thing');
    const second = p.call('other_write');
    await settle();
    let groups: ApprovalGroup[] = [];
    const controller = new ApprovalUiController({
      manager: () => player.manager,
      isGM: () => false,
      now: () => 0,
      on: () => {},
      present: (g) => {
        groups = g;
      },
    });
    controller.install();
    expect(groups[0]?.requests).toHaveLength(2);
    controller.approveGroup(groups[0]!.id);
    await Promise.all([first, second]);
    expect(p.handler).toHaveBeenCalledTimes(2);
    const third = p.call('write_thing');
    await settle();
    controller.refresh();
    controller.resolve(player.manager.listPending()[0]!.id, { decision: 'approve', scope: 'once' });
    await third;
    expect(p.handler).toHaveBeenCalledTimes(3);
  });
});
