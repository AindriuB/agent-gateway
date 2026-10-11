// @vitest-environment happy-dom
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  documentCreate,
  documentUpdate,
  documentDelete,
  compendiumImport,
} from '@agent-gateway/protocol';
import { createDispatcher } from '../../../src/ops/dispatch.js';
import { createPolicyStage } from '../../../src/policy/stage.js';
import { createApprovalStage } from '../../../src/approvals/stage.js';
import { createAuditStage } from '../../../src/audit/stage.js';
import { HANDLERS } from '../../../src/tools/index.js';
import { undoEntry } from '../../../src/audit/undo.js';
import { reserveFixtureUndo, updatePage } from '../../audit/fake.js';
import { Hub, settle } from '../../stubs/approvals.js';
import { setup } from './fixtures.js';
const defs = [documentCreate, documentUpdate, documentDelete, compendiumImport];
let f: ReturnType<typeof setup>;
beforeEach(() => {
  f = setup();
});
afterEach(() => {
  f.restore();
});
function integrated() {
  const hub = new Hub();
  hub.tools = defs;
  hub.addUser('gm', true);
  hub.addUser('player', false);
  const client = hub.client('gm');
  const records: any[] = [];
  let n = 0;
  const dispatch = createDispatcher({
    tools: defs,
    handlers: HANDLERS,
    stages: [
      createPolicyStage({ tools: defs }),
      createApprovalStage(() => client.manager, defs),
      createAuditStage({
        categoryOf: (tool) => defs.find((d) => d.name === tool)?.category,
        isGM: () => true,
        fromUuid: async (uuid) => f.docs.get(uuid),
        submit: async (record) => {
          records.push(record);
        },
        newId: () => `entry${++n}`,
        watchChanges: () => () => {},
      }),
    ],
  });
  const call = (tool: string, args: any, who = f.gm) =>
    dispatch(
      {
        tool,
        args,
        agent: { id: 'agent', ownerUserId: who.id, headless: false },
        sessionId: 'session',
      },
      who,
    );
  async function approve(promise: Promise<any>, tool: string) {
    await settle();
    const pending = client.manager.listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ tool, approver: 'owner' });
    expect(client.manager.resolveApproval(pending[0]!.id, { decision: 'approve' })).toBe(true);
    return promise;
  }
  return { call, approve, client, records };
}
async function undo(record: any) {
  const page = {
    id: 'audit',
    system: {
      targets: record.targets.map((t: any) => ({ ...t, before: JSON.stringify(t.before) })),
    },
    update: vi.fn(updatePage),
  };
  return undoEntry(page, async () => true, {
    isGM: () => true,
    userId: () => f.gm.id,
    fromUuid: async (uuid) => f.docs.get(uuid),
    canModify: () => true,
    canCreate: () => true,
    now: () => 123,
    reserve: reserveFixtureUndo,
  });
}
describe('real default policy, grouped approval and existing audit/undo integration', () => {
  it('asks once per tool, forwards audit call IDs and captures undoable targets', async () => {
    const r = integrated();
    const doc = f.doc('Actor', { name: 'Old' });
    const b = f.doc('Item');
    const { entry } = f.pack();
    const actions = [
      ['document_create', { type: 'Actor', data: '{"name":"Created"}' }],
      ['document_update', { uuid: doc.uuid, update: '{"name":"Changed"}' }],
      ['document_delete', { uuids: [doc.uuid, b.uuid, doc.uuid] }],
      ['compendium_import', { uuid: entry.uuid }],
    ] as const;
    for (const [tool, args] of actions) {
      const before = f.mutations.length;
      const promise = r.call(tool, args);
      await settle();
      expect(f.mutations).toHaveLength(before);
      expect(await r.approve(promise, tool)).not.toHaveProperty('error');
    }
    expect(r.records).toHaveLength(4);
    expect(r.records.map((r) => r.category)).toEqual(['write', 'write', 'destructive', 'write']);
    expect(r.records.every((r) => r.status === 'ok')).toBe(true);
    expect(r.records[0].targets).toEqual([
      expect.objectContaining({ existed: false, undoable: true }),
    ]);
    expect(r.records[1].targets).toEqual([
      expect.objectContaining({
        existed: true,
        before: expect.objectContaining({ name: 'Old' }),
        undoable: true,
      }),
    ]);
    expect(r.records[2].targets).toHaveLength(2);
    expect(r.records[2].targets.every((t: any) => t.existed && !t.existsAfter && t.undoable)).toBe(
      true,
    );
    expect(r.records[3].targets).toEqual([
      expect.objectContaining({ existed: false, undoable: true }),
    ]);
    for (const mutation of f.mutations)
      expect(mutation.options.agentGateway.callId).toMatch(/^entry/);
    // Existing Undo removes creations and recreates deleted native supported documents.
    expect(await undo(r.records[0])).toMatchObject({ status: 'done', restored: 1 });
    expect(await undo(r.records[2])).toMatchObject({ status: 'done', restored: 2 });
    expect(f.docs.get(doc.uuid)?.name).toBe('Changed');
    expect(await undo(r.records[1])).toMatchObject({ status: 'done', restored: 1 });
    expect(f.docs.get(doc.uuid)?.name).toBe('Old');
    expect(await undo(r.records[3])).toMatchObject({ status: 'done', restored: 1 });
  });
  it.each(defs)('non-GM cannot dispatch $name or request its approval', async (d) => {
    const r = integrated();
    expect(await r.call(d.name, {}, f.player)).toMatchObject({ error: { code: 'FORBIDDEN' } });
    expect(r.client.manager.listPending()).toHaveLength(0);
    expect(f.mutations).toHaveLength(0);
  });
  it('rechecks actual GM demotion while real approval is pending', async () => {
    const r = integrated();
    const d = f.doc('Actor');
    const pending = r.call('document_update', { uuid: d.uuid, update: '{"name":"No"}' });
    await settle();
    f.gm.isGM = false;
    expect(await r.approve(pending, 'document_update')).toMatchObject({
      error: { code: 'FORBIDDEN' },
    });
    expect(d.update).not.toHaveBeenCalled();
  });
  it('denied approval does not reach a native operation', async () => {
    const r = integrated();
    const result = r.call('document_create', { type: 'Actor', data: '{}' });
    await settle();
    const [request] = r.client.manager.listPending();
    r.client.manager.resolveApproval(request!.id, { decision: 'deny' });
    expect(await result).toHaveProperty('error');
    expect(f.mutations).toHaveLength(0);
  });
  it('honestly audits earlier deletes when a later native operation fails', async () => {
    const r = integrated();
    const a = f.doc('Actor'),
      b = f.doc('Item');
    b.delete.mockRejectedValue(new Error('native failure'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(
        await r.approve(r.call('document_delete', { uuids: [a.uuid, b.uuid] }), 'document_delete'),
      ).toMatchObject({ error: { code: 'INTERNAL' } });
    } finally {
      error.mockRestore();
    }
    expect(f.docs.has(a.uuid)).toBe(false);
    expect(f.docs.has(b.uuid)).toBe(true);
    expect(r.records[0]).toMatchObject({ status: 'error' });
    expect(r.records[0].targets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ uuid: a.uuid, existsAfter: false, before: expect.any(Object) }),
        expect.objectContaining({ uuid: b.uuid, existsAfter: true }),
      ]),
    );
  });
});
