/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, expect, it, vi } from 'vitest';
import { macroRun, scriptRun } from '@agent-gateway/protocol';
import { createDispatcher } from '../../src/ops/dispatch.js';
import { createPolicyStage } from '../../src/policy/stage.js';
import { createApprovalStage } from '../../src/approvals/stage.js';
import { createAuditStage } from '../../src/audit/stage.js';
import { macroRunHandler } from '../../src/tools/macro-run.js';
import { scriptRunHandler } from '../../src/tools/script-run.js';
import { requestView } from '../../src/apps/approval/index.js';
import { bindReplay } from '../../src/ops/types.js';
import { Hub, settle } from '../stubs/approvals.js';
const live = vi.hoisted(() => ({ manager: undefined as any }));
vi.mock('../../src/approvals/live.js', () => ({ getApprovalManager: () => live.manager }));
afterEach(() => vi.unstubAllGlobals());
function setup() {
  const hub = new Hub();
  hub.now = Date.now();
  hub.tools = [macroRun, scriptRun];
  const native: any = hub.addUser('gm', true);
  const client = hub.client('gm');
  live.manager = client.manager;
  const macro: any = {
    id: 'm',
    uuid: 'Macro.m',
    documentName: 'Macro',
    type: 'script',
    command: 'return "full reviewed source";',
    _stats: { modifiedTime: 1 },
    canUserExecute: () => true,
    canExecute: true,
    execute: vi.fn(async () => 3),
  };
  const macros = { get: () => macro };
  vi.stubGlobal('game', {
    user: native,
    users: { get: () => native },
    macros,
    i18n: { localize: (s: string) => s, format: (s: string) => s },
  });
  vi.stubGlobal('canvas', {});
  vi.stubGlobal('ui', {});
  vi.stubGlobal('fromUuid', async () => macro);
  vi.stubGlobal('foundry', {
    utils: {
      parseUuid: () => ({ uuid: 'Macro.m', type: 'Macro', embedded: [], collection: macros }),
    },
  });
  const allow: any = {
    playerAgents: { read: 'allow', write: 'allow', destructive: 'allow', code: 'allow' },
    gmAgents: { read: 'allow', write: 'allow', destructive: 'allow', code: 'allow' },
  };
  const records: any[] = [];
  const stages = [
    createPolicyStage({
      tools: hub.tools,
      inputs: () => ({
        world: allow,
        owner: allow,
        playerAgentsEnabled: true,
        headlessAgentsEnabled: true,
      }),
    }),
    createApprovalStage(() => client.manager, hub.tools),
    createAuditStage({
      categoryOf: () => 'code',
      fromUuid: async () => macro,
      submit: async (r) => {
        records.push(r);
      },
      isGM: () => true,
      watchChanges: () => () => {},
      now: () => hub.now,
      newId: () => `audit${records.length}`,
    }),
  ];
  const dispatch = createDispatcher({
    tools: hub.tools,
    handlers: { macro_run: macroRunHandler, script_run: scriptRunHandler },
    stages,
  });
  const report = vi.fn();
  const call = (tool: string, args: any) => {
    const call = {
      tool,
      args,
      sessionId: 's',
      agent: { id: 'a', ownerUserId: 'gm', headless: false },
    };
    let gm = false;
    bindReplay(call, {
      id: 'q'.repeat(32),
      expiresAt: hub.now + 60000,
      current: () => true,
      markApproved: (v) => {
        gm = v;
      },
      gmApproved: () => gm,
      report,
    });
    return dispatch(call, { id: 'gm', isGM: true });
  };
  return { hub, client, native, macro, call, records, allow, report };
}

it.each(['macro_run', 'script_run'])(
  'replayed actual %s binds complete source and executes/audits only once after once approval',
  async (tool) => {
    const h = setup(),
      args =
        tool === 'macro_run' ? { macroUuid: 'Macro.m', args: '{"n":2}' } : { source: 'return 4;' },
      done = h.call(tool, args);
    await settle();
    expect(h.records).toHaveLength(0);
    expect(h.macro.execute).not.toHaveBeenCalled();
    const request = h.client.manager.listPending()[0]!;
    expect(request.id).toBe('q'.repeat(32));
    const view: any = await requestView(request);
    expect(view.code).toBe(tool === 'macro_run' ? h.macro.command : 'return 4;');
    expect(view.sessionAllowed).toBe(false);
    expect(
      h.client.manager.resolveApproval(request.id, { decision: 'approve', scope: 'session' }),
    ).toBe(false);
    expect(
      h.client.manager.resolveApproval(request.id, { decision: 'approve', scope: 'once' }),
    ).toBe(true);
    expect(await done).not.toHaveProperty('error');
    expect(h.records).toHaveLength(1);
    expect(
      h.client.manager.resolveApproval(request.id, { decision: 'approve', scope: 'once' }),
    ).toBe(false);
    expect(h.records).toHaveLength(1);
    if (tool === 'macro_run') expect(h.macro.execute).toHaveBeenCalledTimes(1);
    expect(h.report).toHaveBeenCalledWith('approved', expect.any(String), false);
  },
);
it('replayed macro refuses changed native source despite an unchanged queued UUID', async () => {
  const h = setup(),
    done = h.call('macro_run', { macroUuid: 'Macro.m' });
  await settle();
  const r = h.client.manager.listPending()[0]!;
  const source = (r.args as any).source;
  h.macro.command = 'return "unreviewed";';
  expect(((await requestView(r)) as any).code).toBe(source);
  h.client.manager.resolveApproval(r.id, { decision: 'approve', scope: 'once' });
  expect(await done).toMatchObject({ error: { code: 'FORBIDDEN' } });
  expect(h.macro.execute).not.toHaveBeenCalled();
  expect(h.records).toHaveLength(1);
  expect(h.records[0].status).toBe('error');
  expect(h.report).toHaveBeenCalledWith('approved', expect.any(String), true);
  expect(h.client.manager.ownRecords()[0]?.result?.failed).toBe(true);
});
it('denied replay policy performs no code execution or audit', async () => {
  const h = setup();
  h.allow.gmAgents.code = 'deny';
  expect(await h.call('script_run', { source: 'return 4;' })).toHaveProperty('error');
  expect(h.client.manager.listPending()).toEqual([]);
  expect(h.records).toHaveLength(0);
  expect(h.macro.execute).not.toHaveBeenCalled();
});
