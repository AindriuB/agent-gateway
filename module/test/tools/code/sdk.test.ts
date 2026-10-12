/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect, it, vi } from 'vitest';
import { scriptRun } from '@agent-gateway/protocol';
import { startServer } from '../../../../gateway/test/link/helpers.js';
import { pairModule, openSession } from '../../../../gateway/test/routing/harness.js';
import { createDispatcher } from '../../../src/ops/dispatch.js';
import { createApprovalStage } from '../../../src/approvals/stage.js';
import { createAuditStage } from '../../../src/audit/stage.js';
import { scriptRunHandler } from '../../../src/tools/script-run.js';
import { Hub, settle } from '../../stubs/approvals.js';
it('cached SDK code schema accepts25s pending, then executes and audits exact source once', async () => {
  const server = await startServer();
  let session: any, module: any;
  const user = { id: 'gm', isGM: true };
  const game = { user, users: { get: () => user }, count: 0 };
  vi.stubGlobal('game', game);
  vi.stubGlobal('canvas', {});
  vi.stubGlobal('ui', {});
  try {
    module = await pairModule(server, 'gm', { isGM: true });
    session = await openSession(server, {}, [scriptRun]);
    const hub = new Hub();
    hub.tools = [scriptRun];
    hub.addUser('gm', true);
    const owner = hub.client('gm');
    const records: any[] = [];
    const dispatch = createDispatcher({
      tools: [scriptRun],
      handlers: { script_run: scriptRunHandler },
      stages: [
        {
          name: 'ask',
          order: 20,
          async run(ctx, next) {
            ctx.approval = { approver: 'owner' };
            return next();
          },
        },
        createApprovalStage(() => owner.manager, [scriptRun]),
        createAuditStage({
          isGM: () => true,
          categoryOf: () => 'code',
          submit: async (r) => {
            records.push(r);
          },
          fromUuid: async () => null,
          newId: () => 'entry',
          watchChanges: () => () => {},
        }),
      ],
    });
    await session.client.listTools();
    const source = 'game.count++; await Promise.resolve(); return game.count;';
    const pending = session.client.callTool({ name: 'script_run', arguments: { source } });
    const frame = await module.tc.next('call');
    const execution = dispatch(
      {
        tool: frame.tool,
        args: frame.args,
        agent: { id: module.agentId, ownerUserId: 'gm', headless: false },
        sessionId: 'sdk',
      },
      user,
    );
    await settle();
    await hub.advance(25001);
    const result = await execution;
    if ('error' in result) throw Error(result.error.message);
    expect(result.structured).toMatchObject({ status: 'pending_approval' });
    expect(game.count).toBe(0);
    expect(records).toHaveLength(0);
    module.tc.send({
      type: 'result',
      id: frame.id,
      ok: true,
      text: result.text,
      structured: result.structured,
    });
    expect((await pending).structuredContent).toMatchObject({ status: 'pending_approval' });
    const request = owner.manager.listPending()[0]!;
    expect(request.args).toEqual({ source });
    await owner.manager.resolveApproval(request.id, { decision: 'approve', scope: 'session' });
    await settle();
    expect(game.count).toBe(1);
    expect(records).toHaveLength(1);
    expect(records[0].category).toBe('code');
    expect(JSON.parse(records[0].args)).toEqual({ source });
    expect(owner.manager.ownRecords()[0]!.scope).toBe('once');
    await owner.manager.resolveApproval(request.id, { decision: 'approve' });
    expect(game.count).toBe(1);
    expect(owner.manager.ownRecords()[0]!.result).toEqual({ text: '1', failed: false });
  } finally {
    await session?.close();
    module?.tc.ws.terminate();
    await server.server.close();
    server.store.close();
    vi.unstubAllGlobals();
  }
});
