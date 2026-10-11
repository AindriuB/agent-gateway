import { createRateLimitStage } from '../../../src/ratelimit/stage.js';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, expect, it, vi } from 'vitest';
import { tokenManage } from '@agent-gateway/protocol';
import { createDispatcher } from '../../../src/ops/dispatch.js';
import { withPreparation } from '../../../src/ops/context.js';
import { createPolicyStage } from '../../../src/policy/stage.js';
import { createApprovalStage } from '../../../src/approvals/stage.js';
import { createAuditStage } from '../../../src/audit/stage.js';
import { DEFAULT_OWNER_MATRIX, DEFAULT_WORLD_MATRIX } from '../../../src/policy/matrix.js';
import { Hub, settle } from '../../stubs/approvals.js';
import { setup, g, gm } from '../player-tokens-combat/fixtures.js';
let restore = () => {};
afterEach(() => {
  restore();
  vi.unstubAllGlobals();
});
function harness(write = 'ask_owner', destructive = 'allow') {
  const f = setup();
  restore = f.restore;
  g.game.user = gm;
  const hub = new Hub();
  hub.tools = [tokenManage];
  hub.addUser('gm', true);
  const client = hub.client('gm');
  const handler = vi.fn(
    withPreparation(async () => ({
      text: 'removed',
      structured: { action: 'remove', uuid: 'Scene.s.Token.t', completed: true },
    })),
  );
  // vi.fn doesn't retain callable properties.
  const prepared = withPreparation(handler);
  const records: any[] = [];
  const charges: string[] = [];
  const world = structuredClone(DEFAULT_WORLD_MATRIX);
  world.gmAgents.write = write as any;
  world.gmAgents.destructive = destructive as any;
  const dispatch = createDispatcher({
    tools: [tokenManage],
    handlers: { token_manage: prepared },
    stages: [
      createPolicyStage({
        tools: [tokenManage],
        inputs: () => ({
          world,
          owner: DEFAULT_OWNER_MATRIX,
          playerAgentsEnabled: true,
          headlessAgentsEnabled: true,
        }),
      }),
      createRateLimitStage({
        tools: [tokenManage],
        limits: () => ({
          classes: { playerAgents: { read: 10, write: 10 }, gmAgents: { read: 10, write: 10 } },
          agents: new Map(),
          agentsCorrupt: false,
        }),
        limiter: {
          take: (key: string) => {
            charges.push(key);
            return { ok: true };
          },
        } as any,
      }),
      createApprovalStage(() => client.manager, [tokenManage]),
      createAuditStage({
        isGM: () => true,
        categoryOf: () => 'write',
        fromUuid: async () => null,
        submit: async (r) => {
          records.push(r);
        },
        newId: () => 'audit',
        watchChanges: () => () => {},
      }),
    ],
  });
  const call = (action = 'remove') =>
    dispatch(
      {
        tool: 'token_manage',
        args: { action, tokenUuid: 'Scene.s.Token.t' },
        agent: { id: 'agent', ownerUserId: 'gm', headless: false },
        sessionId: 'session',
      },
      gm,
    );
  return { hub, client, handler, records, call, world, charges };
}
it.each([
  ['deny', 'allow'],
  ['allow', 'deny'],
])('preserves strict base/effective deny %s/%s', async (w, d) => {
  const r = harness(w, d);
  expect(await r.call()).toMatchObject({ error: { code: 'DENIED' } });
  expect(r.handler).not.toHaveBeenCalled();
  expect(r.records).toHaveLength(0);
});
it.each([
  ['ask_owner', 'allow'],
  ['allow', 'ask_owner'],
])('asks under strict meet %s/%s and audits destructive once', async (w, d) => {
  const r = harness(w, d);
  const pending = r.call();
  await settle();
  const [record] = r.client.manager.listPending();
  expect(record).toMatchObject({ category: 'destructive' });
  expect(r.handler).not.toHaveBeenCalled();
  expect(r.records).toHaveLength(0);
  r.client.manager.resolveApproval(record!.id, { decision: 'approve' });
  expect(await pending).not.toHaveProperty('error');
  expect(r.handler).toHaveBeenCalledOnce();
  expect(r.records).toHaveLength(1);
  expect(r.records[0].category).toBe('destructive');
});
it('returns delayed pending beyond production threshold without entering audit, then resumes exactly once', async () => {
  const r = harness();
  const result = r.call();
  await settle();
  await r.hub.advance(25001);
  expect(await result).toMatchObject({ structured: { status: 'pending_approval' } });
  expect(r.handler).not.toHaveBeenCalled();
  expect(r.records).toHaveLength(0);
  const [record] = r.client.manager.listPending();
  r.client.manager.resolveApproval(record!.id, { decision: 'approve' });
  await settle();
  expect(r.handler).toHaveBeenCalledOnce();
  expect(r.records).toHaveLength(1);
  expect(r.records[0].category).toBe('destructive');
});
it('refuses policy tightened during approval', async () => {
  const r = harness();
  const pending = r.call();
  await settle();
  r.hub.policyNow = ({ category }) => (category === 'write' ? { kind: 'deny' } : { kind: 'allow' });
  const [record] = r.client.manager.listPending();
  r.client.manager.resolveApproval(record!.id, { decision: 'approve' });
  expect(await pending).toHaveProperty('error');
  expect(r.handler).not.toHaveBeenCalled();
});
it('denial performs no mutation or audit', async () => {
  const r = harness();
  const pending = r.call();
  await settle();
  const [record] = r.client.manager.listPending();
  r.client.manager.resolveApproval(record!.id, { decision: 'deny' });
  expect(await pending).toHaveProperty('error');
  expect(r.handler).not.toHaveBeenCalled();
  expect(r.records).toHaveLength(0);
});
it('isolates write session grants from destructive actions', async () => {
  const r = harness();
  const pending = r.call('hide');
  await settle();
  const [first] = r.client.manager.listPending();
  expect(first!.category).toBe('write');
  r.client.manager.resolveApproval(first!.id, { decision: 'approve', scope: 'session' });
  await pending;
  r.handler.mockClear();
  const remove = r.call();
  await settle();
  const requests = r.client.manager.listPending();
  expect(requests.some((x) => x.category === 'destructive')).toBe(true);
  expect(r.handler).not.toHaveBeenCalled();
  r.client.manager.resolveApproval(requests.find((x) => x.category === 'destructive')!.id, {
    decision: 'deny',
  });
  await remove;
});

it('charges exactly one write bucket for destructive admission', async () => {
  const r = harness();
  const pending = r.call();
  await settle();
  expect(r.charges).toEqual(['agent\u0000write']);
  const [request] = r.client.manager.listPending();
  r.client.manager.resolveApproval(request!.id, { decision: 'deny' });
  await pending;
  expect(r.charges).toHaveLength(1);
});
it('selects GM over owner when effective policy is stricter', async () => {
  const r = harness('ask_owner', 'ask_gm');
  const pending = r.call();
  await settle();
  const [request] = r.client.manager.listPending();
  expect(request).toMatchObject({ category: 'destructive', approver: 'gm' });
  r.client.manager.resolveApproval(request!.id, { decision: 'deny' });
  await pending;
});
