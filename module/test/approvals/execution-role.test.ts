// @vitest-environment happy-dom
/* eslint-disable @typescript-eslint/no-explicit-any */
import { chatRead, defineTool } from '@agent-gateway/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { APPROVAL_CONFIG } from '../../src/approvals/config.js';
import { liveEnv } from '../../src/approvals/live.js';
import { createApprovalStage } from '../../src/approvals/stage.js';
import { createDispatcher } from '../../src/ops/dispatch.js';
import { isOpError, type DispatchResult } from '../../src/ops/types.js';
import { DEFAULT_WORLD_MATRIX } from '../../src/policy/matrix.js';
import { registerPolicySettings, saveWorldPolicy } from '../../src/policy/store.js';
import { chatReadHandler } from '../../src/tools/chat-read.js';
import { setSetting } from '../policy/helpers.js';
import { installFoundry, type FoundryStub } from '../stubs/foundry.js';
import { agentOf, settle, world } from './rig.js';

const gmRead = defineTool({
  name: 'gm_read',
  minRole: 'gm',
  category: 'read',
  handledBy: 'module',
  description: 'GM-only read for role revalidation',
  input: z.strictObject({}),
  output: z.strictObject({}),
});

let stub: FoundryStub;
afterEach(() => stub?.uninstall());

async function setup() {
  stub = installFoundry(14);
  const hub = world();
  const tools = [chatRead, gmRead];
  hub.tools = tools;
  const requester = hub.client('gm');
  const approver = hub.client('gm2');
  const game = (globalThis as any).game;
  game.users = { get: (id: string) => hub.users.get(id) };
  game.messages.contents = [
    {
      id: 'blind',
      timestamp: 1,
      blind: true,
      whisper: ['gm'],
      author: { id: 'gm2' },
      content: '<p>blind roll content</p>',
      rolls: [{ formula: '1d20', total: 17 }],
    },
    {
      id: 'public',
      timestamp: 2,
      blind: false,
      whisper: [],
      author: { id: 'gm2' },
      content: '<p>public content</p><section class="secret">GM secret</section>',
    },
  ];
  registerPolicySettings();
  await setSetting('playerAgentsEnabled', true);
  const matrix = structuredClone(DEFAULT_WORLD_MATRIX);
  matrix.gmAgents.read = 'ask_gm';
  matrix.playerAgents.read = 'ask_gm';
  await saveWorldPolicy(matrix);
  hub.policyNow = liveEnv().currentDecision;
  const chat = vi.fn(chatReadHandler);
  const gm = vi.fn(() => ({ text: 'GM-only content', structured: {} }));
  const dispatch = createDispatcher({
    tools,
    handlers: { chat_read: chat, gm_read: gm },
    stages: [
      {
        name: 'ask',
        order: 20,
        run: async (ctx, next) => {
          ctx.approval = { approver: 'gm' };
          return next();
        },
      },
      createApprovalStage(() => requester.manager, tools),
    ],
  });
  // This is the role captured when the original call arrived, before any demotion.
  const capturedUser = { id: 'gm', isGM: true };
  const call = (tool = 'chat_read') =>
    dispatch(
      {
        tool,
        args: {},
        agent: agentOf('gm'),
        sessionId: 's1',
      },
      capturedUser,
    );
  const queue = async (tool: string, late: boolean) => {
    const done = call(tool);
    await settle();
    const id = requester.manager.listPending()[0]!.id;
    if (late) {
      await hub.advance(APPROVAL_CONFIG.APPROVAL_WAIT_MS);
      expect(await done).toMatchObject({ structured: { status: 'pending_approval', id } });
    }
    return { done, id };
  };
  const result = async (done: Promise<DispatchResult>, id: string, late: boolean) => {
    await settle();
    const record = requester.manager.ownRecords().find((r) => r.id === id)!;
    expect(record.result).toBeDefined();
    if (late) return record.result!;
    const value = await done;
    return {
      text: isOpError(value) ? `${value.error.code}: ${value.error.message}` : value.text,
      failed: isOpError(value),
    };
  };
  return { hub, requester, approver, chat, gm, call, capturedUser, queue, result };
}

describe.each([false, true])('execution role recheck (after timeout: %s)', (late) => {
  it('a demoted GM cannot read blind rolls or secrets after approval', async () => {
    const { hub, approver, chat, capturedUser, queue, result } = await setup();
    const { done, id } = await queue('chat_read', late);
    hub.users.get('gm')!.isGM = false;
    expect(approver.manager.resolveApproval(id, { decision: 'approve' })).toBe(true);
    const outcome = await result(done, id, late);
    expect(outcome.failed).toBe(false);
    expect(outcome.text).toContain('public content');
    expect(outcome.text).not.toContain('blind roll content');
    expect(outcome.text).not.toContain('GM secret');
    expect(chat).toHaveBeenCalledTimes(1);
    expect(chat.mock.calls[0]![0].user).toEqual({ id: 'gm', isGM: false });
    expect(capturedUser.isGM).toBe(true); // Refresh the context without mutating the caller's object.
  });

  it('a demoted requester cannot execute a GM-only tool even with GM approval', async () => {
    const { hub, approver, gm, queue, result } = await setup();
    const { done, id } = await queue('gm_read', late);
    hub.users.get('gm')!.isGM = false;
    expect(approver.manager.resolveApproval(id, { decision: 'approve' })).toBe(true);
    expect(await result(done, id, late)).toMatchObject({
      failed: true,
      text: expect.stringContaining('FORBIDDEN'),
    });
    expect(gm).not.toHaveBeenCalled();
  });

  it('fails closed if the requester disappears even when policy allows execution', async () => {
    const { hub, requester, chat, queue, result } = await setup();
    const { done, id } = await queue('chat_read', late);
    const record = requester.manager.ownRecords().find((r) => r.id === id)!;
    hub.users.delete('gm');
    hub.policyNow = () => ({ kind: 'allow' });
    // Deliver the attested answer directly: the Hub cannot route to a deleted user.
    requester.manager.handleSocket(
      {
        t: 'approval.resolve',
        id,
        decision: 'approve',
        bind: {
          tool: record.tool,
          argsHash: record.argsHash,
          agentId: record.agentId,
          userId: record.requesterId,
        },
      },
      'gm2',
    );
    expect(await result(done, id, late)).toMatchObject({
      failed: true,
      text: expect.stringContaining('FORBIDDEN'),
    });
    expect(chat).not.toHaveBeenCalled();
  });

  it('an unchanged GM still executes a GM-only tool', async () => {
    const { approver, gm, queue, result } = await setup();
    const { done, id } = await queue('gm_read', late);
    expect(approver.manager.resolveApproval(id, { decision: 'approve' })).toBe(true);
    expect(await result(done, id, late)).toEqual({ text: 'GM-only content', failed: false });
    expect(gm).toHaveBeenCalledTimes(1);
  });
});

it.each(['chat_read', 'gm_read'])(
  'a session grant rechecks the execution role for %s',
  async (tool) => {
    const { hub, requester, approver, chat, gm, call, queue } = await setup();
    const { done, id } = await queue(tool, false);
    expect(approver.manager.resolveApproval(id, { decision: 'approve', scope: 'session' })).toBe(
      true,
    );
    await done;
    hub.users.get('gm')!.isGM = false;
    const value = await call(tool);
    expect(requester.manager.listPending()).toEqual([]);
    if (tool === 'gm_read') {
      expect(value).toMatchObject({ error: { code: 'FORBIDDEN' } });
      expect(gm).toHaveBeenCalledTimes(1);
    } else {
      expect(value).toMatchObject({ text: expect.stringContaining('public content') });
      expect(JSON.stringify(value)).not.toContain('blind roll content');
      expect(JSON.stringify(value)).not.toContain('GM secret');
      expect(chat).toHaveBeenCalledTimes(2);
    }
  },
);
