import { describe, expect, it, vi } from 'vitest';
import { ReplayReceipts, REPLAY_RECEIPTS } from '../../src/approvals/replay.js';
import { bindReplay } from '../../src/ops/types.js';
import { world, agentOf, tools, settle } from './rig.js';
import { createDispatcher } from '../../src/ops/dispatch.js';
import { createApprovalStage } from '../../src/approvals/stage.js';
import { createPolicyStage } from '../../src/policy/stage.js';
import { DEFAULT_WORLD_MATRIX, DEFAULT_OWNER_MATRIX } from '../../src/policy/matrix.js';

const storage = () => {
  const rows = new Map<string, string>();
  return {
    getItem: (k: string) => rows.get(k) ?? null,
    setItem: (k: string, v: string) => {
      rows.set(k, v);
    },
  };
};
describe('durable module replay guard', () => {
  it('stores before admitting work and refuses duplicate execution across restart', () => {
    const s = storage(),
      guard = new ReplayReceipts(s, 'k', () => 100);
    expect(guard.claim('id', { tool: 'write', args: { n: 1 } }).fresh).toBe(true);
    expect(guard.claim('id', { tool: 'write', args: { n: 1 } })).toMatchObject({
      fresh: false,
      receipt: { status: 'pending' },
    });
    expect(
      new ReplayReceipts(s, 'k', () => 200).claim('id', { tool: 'write', args: { n: 1 } }),
    ).toMatchObject({ fresh: false, receipt: { status: 'unknown' } });
  });
  it('returns immutable terminal text and rejects altered receipt binding', () => {
    const guard = new ReplayReceipts(storage(), 'k');
    guard.claim('id', { args: 1 });
    guard.update('id', 'approved', 'done');
    expect(guard.update('id', 'pending', 'bad')).toMatchObject({
      status: 'approved',
      text: 'done',
    });
    expect(() => guard.claim('id', { args: 2 })).toThrow('collision');
  });
  it('fails closed on unavailable, corrupt, oversized or non-persisting storage', () => {
    for (const s of [
      { getItem: () => '{bad', setItem: () => {} },
      { getItem: () => null, setItem: () => {} },
      {
        getItem: () => null,
        setItem: () => {
          throw Error('quota');
        },
      },
      { getItem: () => 'x'.repeat(REPLAY_RECEIPTS.maxChars + 1), setItem: () => {} },
    ])
      expect(() => new ReplayReceipts(s, 'k').claim('id', {})).toThrow();
  });
  it('caps receipts without silently removing young intent', () => {
    const g = new ReplayReceipts(storage(), 'k', () => 1);
    for (let i = 0; i < REPLAY_RECEIPTS.max; i++) g.claim(String(i), {});
    expect(() => g.claim('extra', {})).toThrow('capacity');
  });
});
function setup(barrier?: Promise<void>) {
  const hub = world();
  hub.now = Date.now();
  const p = hub.client('p1');
  hub.policyNow = () => ({ kind: 'allow' });
  const handler = vi.fn(async () => ({ text: 'executed', structured: {} }));
  let context: import('../../src/ops/types.js').OpContext | undefined;
  let decision: 'allow' | 'ask_owner' | 'ask_gm' | 'deny' = 'allow',
    current = true;
  const inputs = () => ({
    world: {
      ...DEFAULT_WORLD_MATRIX,
      playerAgents: {
        read: 'allow' as const,
        write: decision,
        destructive: 'deny' as const,
        code: 'deny' as const,
      },
    },
    owner: DEFAULT_OWNER_MATRIX,
    playerAgentsEnabled: true,
    headlessAgentsEnabled: false,
  });
  const dispatcher = createDispatcher({
    tools,
    handlers: { write_thing: handler },
    stages: [
      createPolicyStage({ tools, inputs }),
      createApprovalStage(() => p.manager, tools),
      ...(barrier
        ? [
            {
              name: 'deferred',
              order: 40,
              run: async (
                _ctx: import('../../src/ops/types.js').OpContext,
                next: () => Promise<import('../../src/ops/types.js').DispatchResult>,
              ) => {
                context = _ctx;
                await barrier;
                return next();
              },
            },
          ]
        : []),
    ],
  });
  const report = vi.fn();
  const call = { tool: 'write_thing', args: { id: 'x' }, agent: agentOf('p1'), sessionId: 's' };
  let approvedGM = false;
  bindReplay(call, {
    markApproved: (gm) => {
      approvedGM = gm;
    },
    gmApproved: () => approvedGM,
    id: 'r'.repeat(32),
    expiresAt: hub.now + 1000,
    current: () => current,
    report,
  });
  return {
    mutate: () => {
      if (context) context.args = { id: 'changed' };
    },
    hub,
    p,
    handler,
    call,
    report,
    run: () => dispatcher(call, { id: 'p1', isGM: false }),
    disconnect: () => {
      current = false;
    },
    deny: () => {
      decision = 'deny';
    },
    gm: () => {
      decision = 'ask_gm';
    },
    allow: () => {
      decision = 'allow';
    },
    owner: () => {
      decision = 'ask_owner';
    },
    ordinary: () => dispatcher({ ...call }, { id: 'p1', isGM: false }),
  };
}
describe('replay once approval enforcement', () => {
  it('raises allow to a fresh once-only request, retaining the receipt ID and deadline', async () => {
    const h = setup(),
      done = h.run();
    await settle();
    expect(h.handler).not.toHaveBeenCalled();
    const r = h.p.manager.listPending()[0]!;
    expect(r).toMatchObject({ id: 'r'.repeat(32), replay: true, expiresAt: h.hub.now + 1000 });
    expect(h.p.manager.resolveApproval(r.id, { decision: 'approve', scope: 'session' })).toBe(
      false,
    );
    expect(h.p.manager.resolveApproval(r.id, { decision: 'approve', scope: 'once' })).toBe(true);
    await done;
    expect(h.handler).toHaveBeenCalledTimes(1);
    expect(h.report).toHaveBeenCalledWith('approved', 'executed');
  });
  it.each(['disconnect', 'deny'] as const)(
    'rechecks %s immediately before execution',
    async (change) => {
      const h = setup(),
        done = h.run();
      await settle();
      h[change]();
      h.p.manager.resolveApproval('r'.repeat(32), { decision: 'approve' });
      expect(await done).toHaveProperty('error');
      expect(h.handler).not.toHaveBeenCalled();
    },
  );
  it('expires pending approval on the original queue deadline', async () => {
    const h = setup(),
      done = h.run();
    await settle();
    await h.hub.advance(1001);
    await done;
    expect(h.p.manager.ownRecords()[0]?.status).toBe('expired');
    expect(h.handler).not.toHaveBeenCalled();
    expect(h.report).toHaveBeenCalledWith('expired', expect.any(String));
  });
  it('does not inherit an earlier session grant', async () => {
    const h = setup();
    h.owner();
    h.hub.policyNow = () => ({ kind: 'ask', approver: 'owner' });
    const original = h.ordinary();
    await settle();
    h.p.manager.resolveApproval(h.p.manager.listPending()[0]!.id, {
      decision: 'approve',
      scope: 'session',
    });
    await original;
    h.allow();
    h.hub.policyNow = () => ({ kind: 'allow' });
    const replay = h.run();
    await settle();
    expect(h.handler).toHaveBeenCalledTimes(1);
    expect(h.p.manager.listPending()[0]?.id).toBe('r'.repeat(32));
    h.p.manager.resolveApproval('r'.repeat(32), { decision: 'approve', scope: 'once' });
    await replay;
    expect(h.handler).toHaveBeenCalledTimes(2);
  });
  it('denies owner approval when policy tightens to GM across an awaited stage', async () => {
    let release!: () => void;
    const barrier = new Promise<void>((r) => {
        release = r;
      }),
      h = setup(barrier),
      done = h.run();
    await settle();
    h.p.manager.resolveApproval('r'.repeat(32), { decision: 'approve' });
    await settle();
    h.gm();
    release();
    expect(await done).toHaveProperty('error');
    expect(h.handler).not.toHaveBeenCalled();
  });
  it('preserves stricter GM approval and attests the actual once approver', async () => {
    const h = setup(),
      gm = h.hub.client('gm');
    h.gm();
    h.hub.policyNow = () => ({ kind: 'ask', approver: 'gm' });
    const done = h.run();
    await settle();
    expect(h.p.manager.listPending()).toEqual([]);
    expect(gm.manager.listPending()[0]?.id).toBe('r'.repeat(32));
    expect(
      gm.manager.resolveApproval('r'.repeat(32), { decision: 'approve', scope: 'session' }),
    ).toBe(false);
    expect(gm.manager.resolveApproval('r'.repeat(32), { decision: 'approve', scope: 'once' })).toBe(
      true,
    );
    await done;
    expect(h.handler).toHaveBeenCalledTimes(1);
  });
  it('rejects changed prepared arguments after approval but before handler entry', async () => {
    let release!: () => void;
    const h = setup(
        new Promise<void>((r) => {
          release = r;
        }),
      ),
      done = h.run();
    await settle();
    h.p.manager.resolveApproval('r'.repeat(32), { decision: 'approve' });
    await settle();
    h.mutate();
    release();
    expect(await done).toHaveProperty('error');
    expect(h.handler).not.toHaveBeenCalled();
  });
  it('ordinary arguments cannot forge replay provenance', async () => {
    const h = setup();
    const call = {
      tool: 'write_thing',
      args: { id: 'x', replay: { id: 'r'.repeat(32) } },
      agent: agentOf('p1'),
      sessionId: 's',
    };
    // Strict tool parsing rejects the extra key; no forced receipt can be supplied as public data.
    const dispatcher = createDispatcher({
      tools,
      handlers: { write_thing: h.handler },
      stages: [],
    });
    expect(await dispatcher(call, { id: 'p1', isGM: false })).toHaveProperty('error');
    expect(h.handler).not.toHaveBeenCalled();
  });
});
