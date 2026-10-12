/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, expect, it, vi } from 'vitest';
import { macroRun, scriptRun } from '@agent-gateway/protocol';
import { createDispatcher, createRegistryDispatcher } from '../../../src/ops/dispatch.js';
import { createPolicyStage } from '../../../src/policy/stage.js';
import { createApprovalStage } from '../../../src/approvals/stage.js';
import { createAuditStage } from '../../../src/audit/stage.js';
import { macroRunHandler } from '../../../src/tools/macro-run.js';
import { scriptRunHandler } from '../../../src/tools/script-run.js';
import { requestView } from '../../../src/apps/approval/index.js';
import { ToolRegistry } from '../../../src/ops/registry-class.js';
import { createPackApi } from '../../../src/packs/api.js';
import { Hub, settle } from '../../stubs/approvals.js';
const live = vi.hoisted(() => ({ manager: undefined as any }));
vi.mock('../../../src/approvals/live.js', () => ({ getApprovalManager: () => live.manager }));
afterEach(() => vi.unstubAllGlobals());
function setup() {
  const hub = new Hub();
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
  const call = (tool: string, args: any) =>
    dispatch(
      { tool, args, sessionId: 's', agent: { id: 'a', ownerUserId: 'gm', headless: false } },
      { id: 'gm', isGM: true },
    );
  return { hub, client, native, macro, call, records, allow };
}
it.each(['macro_run', 'script_run'])(
  'actual %s still asks under tampered allow and refuses session grants',
  async (tool) => {
    const s = setup();
    const args = tool === 'macro_run' ? { macroUuid: 'Macro.m' } : { source: 'return 4;' };
    const first = s.call(tool, args);
    await settle();
    expect(s.client.manager.listPending()).toHaveLength(1);
    expect(s.records).toHaveLength(0);
    expect(s.macro.execute).not.toHaveBeenCalled();
    const request = s.client.manager.listPending()[0]!;
    const view: any = await requestView(request);
    expect(view.code).toBe(tool === 'macro_run' ? s.macro.command : 'return 4;');
    expect(view.sessionAllowed).toBe(false);
    await s.client.manager.resolveApproval(request.id, { decision: 'approve', scope: 'session' });
    expect(await first).not.toHaveProperty('error');
    expect(s.client.manager.ownRecords()[0]!.scope).toBe('once');
    expect(s.records).toHaveLength(1);
    const second = s.call(tool, args);
    await settle();
    expect(s.client.manager.listPending()).toHaveLength(1);
    expect(s.records).toHaveLength(1);
    await s.client.manager.resolveApproval(s.client.manager.listPending()[0]!.id, {
      decision: 'deny',
    });
    expect(await second).toHaveProperty('error');
  },
);
it('cached pending at production25s binds full source and continues only once after approval', async () => {
  const s = setup();
  const promise = s.call('macro_run', { macroUuid: 'Macro.m' });
  await settle();
  await s.hub.advance(25001);
  await settle();
  const pending: any = await promise;
  expect(pending.structured.status).toBe('pending_approval');
  expect(s.records).toHaveLength(0);
  const request = s.client.manager.listPending()[0]!;
  expect(request.args).toMatchObject({ source: s.macro.command });
  await s.client.manager.resolveApproval(request.id, { decision: 'approve', scope: 'once' });
  await settle();
  expect(s.macro.execute).toHaveBeenCalledTimes(1);
  expect(s.records).toHaveLength(1);
  await s.client.manager.resolveApproval(request.id, { decision: 'approve', scope: 'once' });
  expect(s.macro.execute).toHaveBeenCalledTimes(1);
  const status: any = s.client.manager.statusFor(request.id, {
    user: { id: 'gm', isGM: true },
    agent: { id: 'a', ownerUserId: 'gm', headless: false },
    sessionId: 's',
    tool: 'approval_status',
    args: { id: request.id },
  });
  expect(status.structured.result).not.toHaveProperty('structured');
});
it('approval of unchanged arguments cannot execute a source changed while pending', async () => {
  const s = setup();
  const promise = s.call('macro_run', { macroUuid: 'Macro.m' });
  await settle();
  const request = s.client.manager.listPending()[0]!;
  const original = ((await requestView(request)) as any).code;
  s.macro.command = 'return "unreviewed";';
  expect(((await requestView(request)) as any).code).toBe(original);
  await s.client.manager.resolveApproval(request.id, { decision: 'approve' });
  expect(await promise).toMatchObject({ error: { code: 'FORBIDDEN' } });
  expect(s.macro.execute).not.toHaveBeenCalled();
});
it('a genuinely registered pack code tool asks under the same tampered allow policy', async () => {
  const s = setup();
  let lookup: any;
  const registry = new ToolRegistry((value) => {
    lookup = value;
  });
  const invoked = vi.fn(async () => ({ text: 'pack ran', structured: {} }));
  const { api } = createPackApi(registry, { active: () => true, translate: (k) => k });
  api.registerPack({
    id: 'fixture-code',
    version: '1.0.0',
    apiVersion: '1.0',
    prefix: 'fixture',
    tools: [
      {
        name: 'run',
        description: 'Fixture code',
        category: 'code',
        minRole: 'gm',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        outputSchema: { type: 'object', properties: {}, additionalProperties: false },
        handler: invoked,
      },
    ],
  });
  const metadata: any = registry.info('fixture-run');
  s.hub.tools = [metadata];
  const packClient = s.hub.client('gm');
  // Inject the registered metadata into the real policy and approval stages; registry lookup remains the actual pack wrapper.
  const dispatch = createRegistryDispatcher(registry, lookup, [
    createPolicyStage({
      tools: [metadata],
      inputs: () => ({
        world: s.allow,
        owner: s.allow,
        playerAgentsEnabled: true,
        headlessAgentsEnabled: true,
      }),
    }),
    createApprovalStage(() => packClient.manager, [metadata]),
  ]);
  const promise = dispatch(
    {
      tool: 'fixture-run',
      args: {},
      agent: { id: 'a', ownerUserId: 'gm', headless: false },
      sessionId: 's',
    },
    { id: 'gm', isGM: true },
  );
  await settle();
  expect(packClient.manager.listPending()).toHaveLength(1);
  expect(invoked).not.toHaveBeenCalled();
  await packClient.manager.resolveApproval(packClient.manager.listPending()[0]!.id, {
    decision: 'deny',
  });
  await promise;
  expect(invoked).not.toHaveBeenCalled();
});
