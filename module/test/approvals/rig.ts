/* eslint-disable @typescript-eslint/no-explicit-any */
import { approvalStatus, defineTool, type ToolCategory } from '@agent-gateway/protocol';
import { vi } from 'vitest';
import { z } from 'zod';
import { createApprovalStage } from '../../src/approvals/stage.js';
import { createDispatcher } from '../../src/ops/dispatch.js';
import type { Stage } from '../../src/ops/stages.js';
import type { OpAgent, OpContext } from '../../src/ops/types.js';
import { Hub, settle, type Client } from '../stubs/approvals.js';

const mk = (name: string, category: ToolCategory) =>
  defineTool({
    name,
    minRole: 'player',
    category,
    handledBy: 'module',
    description: 'x',
    input: z.strictObject({ id: z.string(), n: z.number().optional() }),
    output: z.strictObject({}),
  });

export const tools = [
  mk('write_thing', 'write'),
  mk('other_write', 'write'),
  mk('code_thing', 'code'),
  approvalStatus,
];

export const agentOf = (ownerUserId: string, id = `agent-${ownerUserId}`): OpAgent => ({
  id,
  ownerUserId,
  headless: false,
});

export function world() {
  const hub = new Hub();
  hub.tools = tools;
  hub.addUser('p1', false);
  hub.addUser('p2', false);
  hub.addUser('gm', true);
  hub.addUser('gm2', true);
  return hub;
}

/** A dispatcher for one client: a stand-in policy stage that asks for approval, then the real stage. */
export function pipeline(client: Client, approver: 'owner' | 'gm' = 'owner') {
  const handler = vi.fn(async (ctx: OpContext) => ({
    text: `ran ${ctx.tool} ${JSON.stringify(ctx.args)}`,
    structured: {},
  }));
  const asking: Record<string, 'owner' | 'gm'> = {
    write_thing: approver,
    other_write: approver,
    code_thing: approver,
  };
  const policy: Stage = {
    name: 'ask',
    order: 20,
    run: (ctx, next) => {
      if (asking[ctx.tool]) ctx.approval = { approver: asking[ctx.tool]! };
      return next();
    },
  };
  const dispatcher = createDispatcher({
    tools,
    handlers: {
      write_thing: handler,
      other_write: handler,
      code_thing: handler,
      approval_status: (ctx) => client.manager.statusFor((ctx.args as any).id, ctx),
    },
    stages: [policy, createApprovalStage(() => client.manager, tools)],
  });
  const call = (
    tool: string,
    args: unknown = { id: 'x' },
    o: { agent?: OpAgent; sessionId?: string } = {},
  ) =>
    dispatcher(
      {
        tool,
        args,
        agent: o.agent ?? agentOf(client.user.id),
        sessionId: o.sessionId ?? 's1',
      },
      { id: client.user.id, isGM: client.user.isGM },
    );
  return { handler, call, dispatcher, asking };
}

export const pendingId = (r: any): string => {
  if (r?.structured?.status !== 'pending_approval')
    throw new Error(`not pending: ${JSON.stringify(r)}`);
  return r.structured.id;
};

export { settle };
