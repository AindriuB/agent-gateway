/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, describe, expect, it } from 'vitest';
import { liveEnv } from '../../src/approvals/live.js';
import { DEFAULT_WORLD_MATRIX } from '../../src/policy/matrix.js';
import {
  saveOwnerPolicy,
  saveWorldPolicy,
  registerPolicySettings,
} from '../../src/policy/store.js';
import { englishI18n, setSetting } from '../policy/helpers.js';
import { installFoundry, type FoundryStub } from '../stubs/foundry.js';
import { pipeline, settle, world } from './rig.js';

const setup = (approver: 'owner' | 'gm' = 'owner') => {
  const hub = world();
  const p1 = hub.client('p1');
  const gm = hub.client('gm');
  return { hub, p1, gm, ...pipeline(p1, approver) };
};
const requests = (hub: any) => hub.sent.filter((m: any) => m.data.t === 'approval.request');

describe('a delayed approval is judged by the policy of today', () => {
  it('ask_owner became deny: not executed, denied with the reason', async () => {
    const { hub, p1, call, handler } = setup();
    const done = call('write_thing');
    await settle();
    const id = p1.manager.listPending()[0]!.id;
    hub.policyNow = () => ({ kind: 'deny' });
    p1.manager.resolveApproval(id, { decision: 'approve' });
    const r: any = await done;
    expect(r.error.code).toBe('DENIED');
    expect(r.error.message).toContain('AGENT_GATEWAY.Approvals.policyChanged');
    expect(handler).not.toHaveBeenCalled();
    const s: any = await call('approval_status', { id });
    expect(s.structured.status).toBe('denied');
    expect(s.structured.reason).toContain('policyChanged');
  });

  it('ask_owner became ask_gm and the owner approved: not executed, re-presented to GMs', async () => {
    const { hub, p1, gm, call, handler } = setup();
    const done = call('write_thing');
    await settle();
    const id = p1.manager.listPending()[0]!.id;
    const before = requests(hub).length;
    hub.policyNow = () => ({ kind: 'ask', approver: 'gm' });
    expect(p1.manager.resolveApproval(id, { decision: 'approve' })).toBe(false);
    await settle();
    expect(handler).not.toHaveBeenCalled();
    expect(p1.manager.ownRecords()[0]).toMatchObject({ status: 'pending', approver: 'gm' });
    expect(requests(hub).length).toBe(before + 1);
    expect(requests(hub).at(-1).to).toEqual(['gm', 'gm2'].filter((u) => hub.users.get(u)!.online));
    // A GM can still answer it, and then it runs.
    gm.manager.resolveApproval(id, { decision: 'approve' });
    expect(await done).toMatchObject({ text: expect.stringContaining('ran') });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('an unchanged policy still executes', async () => {
    const { p1, call, handler } = setup();
    const done = call('write_thing');
    await settle();
    p1.manager.resolveApproval(p1.manager.listPending()[0]!.id, { decision: 'approve' });
    await done;
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('a policy that now allows the call lets the approval run it', async () => {
    const { hub, p1, call, handler } = setup();
    const done = call('write_thing');
    await settle();
    hub.policyNow = () => ({ kind: 'allow' });
    p1.manager.resolveApproval(p1.manager.listPending()[0]!.id, { decision: 'approve' });
    await done;
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('a stale session grant under a tightened policy is refused', async () => {
    const { hub, p1, call, handler } = setup();
    const first = call('write_thing', { id: '1' });
    await settle();
    p1.manager.resolveApproval(p1.manager.listPending()[0]!.id, {
      decision: 'approve',
      scope: 'session',
    });
    await first;
    expect(await call('write_thing', { id: '2' })).toMatchObject({ text: expect.any(String) });
    hub.policyNow = () => ({ kind: 'deny' });
    const r: any = await call('write_thing', { id: '3' });
    expect(r.error.code).toBe('DENIED');
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('a stale owner grant does not cover a call the policy now sends to a GM', async () => {
    const { hub, p1, call, handler } = setup();
    const first = call('write_thing', { id: '1' });
    await settle();
    p1.manager.resolveApproval(p1.manager.listPending()[0]!.id, {
      decision: 'approve',
      scope: 'session',
    });
    await first;
    hub.policyNow = () => ({ kind: 'ask', approver: 'gm' });
    void call('write_thing', { id: '2' });
    await settle();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(p1.manager.ownRecords().filter((r) => r.status === 'pending')).toHaveLength(1);
  });
});

describe('the live policy lookup (real evaluate, settings and users)', () => {
  let stub: FoundryStub;
  afterEach(() => stub?.uninstall());
  const live = async (isGM = false) => {
    stub = installFoundry(14, { persistedWorldSettings: true });
    (globalThis as any).game.user = { id: 'settings-gm', isGM: true };
    (globalThis as any).game.i18n = englishI18n;
    (globalThis as any).game.users = {
      get: (id: string) => (id === 'u' ? { id, name: 'U', isGM } : undefined),
      contents: [],
    };
    registerPolicySettings();
    await setSetting('playerAgentsEnabled', true);
    return liveEnv();
  };
  const f = { requesterId: 'u', headless: false, category: 'write', approver: 'owner' as const };

  it('follows the matrix and the owner policy', async () => {
    const env = await live();
    expect(env.currentDecision(f)).toEqual({ kind: 'ask', approver: 'owner' });
    const m: any = structuredClone(DEFAULT_WORLD_MATRIX);
    m.playerAgents.write = 'ask_gm';
    await saveWorldPolicy(m);
    expect(env.currentDecision(f)).toEqual({ kind: 'ask', approver: 'gm' });
    m.playerAgents.write = 'deny';
    await saveWorldPolicy(m);
    expect(env.currentDecision(f)).toEqual({ kind: 'deny' });
    m.playerAgents.write = 'allow';
    await saveWorldPolicy(m);
    expect(env.currentDecision(f)).toEqual({ kind: 'allow' });
    const o: any = structuredClone(DEFAULT_WORLD_MATRIX);
    o.playerAgents.write = 'deny';
    await saveOwnerPolicy(o);
    expect(env.currentDecision(f)).toEqual({ kind: 'deny' });
  });

  it('turning player agents off denies; headless likewise', async () => {
    const env = await live();
    await setSetting('playerAgentsEnabled', false);
    expect(env.currentDecision(f)).toEqual({ kind: 'deny' });
    await setSetting('playerAgentsEnabled', true);
    expect(env.currentDecision({ ...f, headless: true })).toEqual({ kind: 'deny' });
    await setSetting('headlessAgentsEnabled', true);
    expect(env.currentDecision({ ...f, headless: true })).toEqual({
      kind: 'ask',
      approver: 'owner',
    });
  });

  it("uses the requester's current role, and denies when the user is gone", async () => {
    const env = await live(true);
    // A GM's agent: destructive asks the owner. As a player it would ask the GM.
    expect(env.currentDecision({ ...f, category: 'destructive' })).toEqual({
      kind: 'ask',
      approver: 'owner',
    });
    (globalThis as any).game.users.get = () => ({ id: 'u', name: 'U', isGM: false });
    expect(env.currentDecision({ ...f, category: 'destructive' })).toEqual({
      kind: 'ask',
      approver: 'gm',
    });
    (globalThis as any).game.users.get = () => undefined;
    expect(env.currentDecision(f)).toEqual({ kind: 'deny' });
  });
});
