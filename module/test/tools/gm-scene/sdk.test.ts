/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect, it } from 'vitest';
import { tokenManage } from '@agent-gateway/protocol';
import { startServer } from '../../../../gateway/test/link/helpers.js';
import { pairModule, openSession } from '../../../../gateway/test/routing/harness.js';
import { createDispatcher } from '../../../src/ops/dispatch.js';
import { withPreparation } from '../../../src/ops/context.js';
import { createApprovalStage } from '../../../src/approvals/stage.js';
import { createAuditStage } from '../../../src/audit/stage.js';
import { Hub, settle } from '../../stubs/approvals.js';
import { setup, g, gm } from '../player-tokens-combat/fixtures.js';
it('SDK cached schema accepts destructive pending and continuation executes/audits once', async () => {
  const f = setup();
  g.game.user = gm;
  const h = await startServer();
  let session: any, module: any;
  try {
    module = await pairModule(h, 'gm', { isGM: true });
    session = await openSession(h, {}, [tokenManage]);
    const hub = new Hub();
    hub.tools = [tokenManage];
    hub.addUser('gm', true);
    const owner = hub.client('gm');
    let mutations = 0;
    const records: any[] = [];
    const dispatch = createDispatcher({
      tools: [tokenManage],
      handlers: {
        token_manage: withPreparation(async () => {
          mutations++;
          return {
            text: 'done',
            structured: { action: 'remove', uuid: 'Scene.s.Token.t', completed: true },
          };
        }),
      },
      stages: [
        {
          name: 'ask',
          order: 20,
          run: async (ctx, next) => {
            ctx.approval = { approver: 'owner' };
            return next();
          },
        },
        createApprovalStage(() => owner.manager, [tokenManage]),
        createAuditStage({
          isGM: () => true,
          categoryOf: () => 'write',
          fromUuid: async () => null,
          submit: async (r) => {
            records.push(r);
          },
          newId: () => 'entry',
          watchChanges: () => () => {},
        }),
      ],
    });
    await session.client.listTools();
    const pending = session.client.callTool({
      name: 'token_manage',
      arguments: { action: 'remove', tokenUuid: 'Scene.s.Token.t' },
    });
    const frame = await module.tc.next('call');
    const execution = dispatch(
      {
        tool: frame.tool,
        args: frame.args,
        agent: { id: module.agentId, ownerUserId: 'gm', headless: false },
        sessionId: 'sdk',
      },
      gm,
    );
    await settle();
    await hub.advance(25001);
    const result = await execution;
    expect(result).toMatchObject({ structured: { status: 'pending_approval' } });
    expect(mutations).toBe(0);
    expect(records).toHaveLength(0);
    module.tc.send({
      type: 'result',
      id: frame.id,
      ok: true,
      text: result.text,
      structured: result.structured,
    });
    expect((await pending).structuredContent).toMatchObject({ status: 'pending_approval' });
    const [request] = owner.manager.listPending();
    owner.manager.resolveApproval(request!.id, { decision: 'approve' });
    await settle();
    expect(mutations).toBe(1);
    expect(records).toHaveLength(1);
    expect(records[0].category).toBe('destructive');
  } finally {
    await session?.close();
    module?.tc.ws.terminate();
    await h.server.close();
    h.store.close();
    f.restore();
  }
});
