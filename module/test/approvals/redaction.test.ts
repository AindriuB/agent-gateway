/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { imageUpload, TOOLS } from '@agent-gateway/protocol';
import { createApprovalStage } from '../../src/approvals/stage.js';
import { callHash } from '../../src/approvals/canonical.js';
import { createDispatcher } from '../../src/ops/dispatch.js';
import type { Stage } from '../../src/ops/stages.js';
import { redactedArgs, sha256Bytes } from '../../src/ops/redact.js';
import { ApprovalUiController } from '../../src/apps/approval/controller.js';
import { requestView } from '../../src/apps/approval/index.js';
import { Hub, settle } from '../stubs/approvals.js';

const live = vi.hoisted(() => ({ manager: undefined as any }));
vi.mock('../../src/approvals/live.js', () => ({ getApprovalManager: () => live.manager }));
afterEach(() => vi.unstubAllGlobals());

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const payload = (size = 500 * 1024) => Buffer.concat([PNG, randomBytes(size)]);

/** True when any 16-character window of `secret` appears in `haystack` (fast: set of the small side). */
function leaks(secret: string, haystack: string): boolean {
  const grams = new Set<string>();
  for (let i = 0; i + 16 <= haystack.length; i++) grams.add(haystack.slice(i, i + 16));
  for (let i = 0; i + 16 <= secret.length; i++) if (grams.has(secret.slice(i, i + 16))) return true;
  return false;
}

function rig(who: 'p1' | 'gm', approver: 'owner' | 'gm') {
  const hub = new Hub();
  hub.tools = [imageUpload];
  hub.addUser('p1', false);
  const gmUser: any = hub.addUser('gm', true);
  const requester = hub.client(who);
  const other = hub.client(who === 'p1' ? 'gm' : 'p1');
  live.manager = requester.manager;
  const handler = vi.fn(async () => ({ text: 'uploaded', structured: {} }));
  const policy: Stage = {
    name: 'ask',
    order: 20,
    run: (ctx, next) => {
      ctx.approval = { approver };
      return next();
    },
  };
  const dispatcher = createDispatcher({
    tools: [imageUpload],
    handlers: { image_upload: handler },
    stages: [policy, createApprovalStage(() => requester.manager, [imageUpload])],
  });
  const call = (args: unknown) =>
    dispatcher(
      {
        tool: 'image_upload',
        args,
        sessionId: 's',
        agent: { id: `agent-${who}`, ownerUserId: who, headless: false },
      },
      { id: who, isGM: who === 'gm' },
    );
  vi.stubGlobal('game', {
    user: hub.users.get(who),
    users: { get: (id: string) => hub.users.get(id) },
    i18n: { localize: (s: string) => s, format: (s: string) => s },
  });
  void gmUser;
  return { hub, requester, other, handler, call };
}

describe.each([
  ['a player', 'p1', 'gm'],
  ['a GM', 'gm', 'owner'],
] as const)('image_upload approval by %s hides the payload', (_label, who, approver) => {
  it('keeps the payload out of every approval surface and can be approved', async () => {
    const s = rig(who, approver);
    const bytes = payload();
    const data = bytes.toString('base64');
    const marker = data.slice(2000, 2064);
    const args = { data, mime: 'image/png' };
    const done = s.call(args);
    await settle();

    const approverClient = who === 'p1' ? s.other : s.requester;
    const pending = approverClient.manager.listPending();
    expect(pending).toHaveLength(1);
    const surfaces = {
      record: JSON.stringify(s.requester.manager.ownRecords()),
      storage: s.requester.storage.text,
      frames: JSON.stringify(s.hub.sent),
      hooks: JSON.stringify([...s.requester.hooks, ...s.other.hooks]),
      pendingList: JSON.stringify(pending),
      view: JSON.stringify(await requestView(pending[0]!)),
    };
    expect(
      s.requester.hooks.filter((h) => h.name === 'agentGateway.approvalRequested').length,
    ).toBe(1);
    expect(s.other.hooks.filter((h) => h.name === 'agentGateway.approvalRequested').length).toBe(
      who === 'p1' ? 1 : 0,
    );
    for (const [name, text] of Object.entries(surfaces)) {
      if (name !== 'frames' || who === 'p1') expect(text.length, name).toBeGreaterThan(2);
      expect(text, name).not.toContain(marker);
      expect(leaks(data, text), name).toBe(false);
    }
    expect(surfaces.record).toContain(`"bytes":${bytes.length}`);
    expect(surfaces.record).toContain(sha256Bytes(bytes));
    if (who === 'p1')
      expect(s.hub.sent.some((m) => JSON.stringify(m.data).includes('approval.request'))).toBe(
        true,
      );

    // The dialog controller approves it: the request is reviewable.
    const controller = new ApprovalUiController({
      manager: () => approverClient.manager,
      isGM: () => true,
      now: () => s.hub.now,
      on: () => {},
      present: () => {},
    });
    expect(controller.resolve(pending[0]!.id, { decision: 'approve', scope: 'once' })).toBe(true);
    await settle();
    await done;
    // Execution used the live arguments, not the record.
    expect(s.handler).toHaveBeenCalledTimes(1);
    expect((s.handler.mock.calls[0] as any[])[0].args.data).toBe(data);
  }, 30000);
});

describe('binding to the payload', () => {
  it('an approval for one payload does not bind a call with another', async () => {
    const s = rig('p1', 'gm');
    const a = { data: payload(1000).toString('base64'), mime: 'image/png' };
    const b = { data: payload(1000).toString('base64'), mime: 'image/png' };
    const first = s.call(a);
    await settle();
    const rec = s.requester.manager.ownRecords()[0]!;
    const hash = (args: any) => callHash('image_upload', redactedArgs(imageUpload, args));
    expect(rec.argsHash).toBe(hash(a));
    expect(rec.argsHash).not.toBe(hash(b));
    s.other.manager.resolveApproval(rec.id, { decision: 'approve' });
    await first;
    // A different payload needs its own approval.
    const second = s.call(b);
    await settle();
    expect(s.handler).toHaveBeenCalledTimes(1);
    expect(s.other.manager.listPending()).toHaveLength(1);
    s.other.manager.resolveApproval(s.other.manager.listPending()[0]!.id, {
      decision: 'deny',
      reason: 'no',
    });
    await second;
  });
});

describe('other tools are unchanged', () => {
  it('redaction returns the input for every other core tool', () => {
    const args = { data: 'AAAA', uuid: 'x' };
    for (const tool of TOOLS.filter((t) => t.name !== 'image_upload')) {
      expect(tool.redactArgs, tool.name).toBeUndefined();
      expect(redactedArgs(tool, args), tool.name).toBe(args);
      expect(callHash(tool.name, redactedArgs(tool, args))).toBe(callHash(tool.name, args));
    }
    expect(redactedArgs({}, args)).toBe(args);
    expect(redactedArgs(undefined, args)).toBe(args);
  });
});
