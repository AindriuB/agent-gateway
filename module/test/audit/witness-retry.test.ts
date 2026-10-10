/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, expect, it, vi } from 'vitest';
import { installFoundry, type FoundryStub } from '../stubs/foundry.js';
import { makeStore, record, target, writable } from './fake.js';

let stub: FoundryStub;
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  stub?.uninstall();
});

it('the live relay retains witnessed undo data through a journal failure and retry', async () => {
  vi.useFakeTimers();
  vi.resetModules();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  stub = installFoundry(14);
  const g = globalThis as any;
  const store = makeStore();
  const doc = store.add(writable('Actor.a1', { name: 'Before', hp: 9 }, 1));
  g.fromUuid = store.fromUuid;
  const users = [
    { id: 'gm1', isGM: true },
    { id: 'p1', isGM: false },
  ];
  const pages: any[] = [];
  const create = vi
    .fn()
    .mockRejectedValueOnce(new Error('temporary journal failure'))
    .mockImplementation(async (_type, data) => {
      pages.push(...data);
    });
  const journal = {
    id: 'audit',
    flags: { 'agent-gateway': { auditJournal: true } },
    ownership: { default: 0 },
    _stats: { createdBy: 'gm1' },
    testUserPermission: () => false,
    pages: { contents: pages },
    createEmbeddedDocuments: create,
  };
  const emit = vi.fn();
  Object.assign(g.game, {
    user: users[0],
    users: {
      contents: users,
      get: (id: string) => users.find((u) => u.id === id),
      activeGM: users[0],
    },
    journal: { contents: [journal], get: (id: string) => (id === 'audit' ? journal : null) },
    socket: { on: vi.fn(), emit },
  });
  await g.game.settings.set('agent-gateway', 'auditJournalId', 'audit');
  const { AuditWitness } = await import('../../src/audit/witness.js');
  const complete = vi.spyOn(AuditWitness.prototype, 'complete');
  const { installAudit, getAuditRelay } = await import('../../src/audit/index.js');
  installAudit();
  stub.fire('ready');
  const relay = getAuditRelay()!;
  const callId = 'call-retry001';
  await relay.onMessage({ kind: 'audit.intent', callId, uuid: doc.uuid }, 'p1');
  doc.data.name = 'After';
  doc._stats.modifiedTime = 2;
  for (const hook of stub.hooks.get('updateActor') ?? []) {
    (hook as any)(doc, { name: 'After' }, { agentGateway: { callId } }, 'p1');
  }
  emit.mockClear();
  const msg = { kind: 'audit.entry', record: record({ entryId: callId, targets: [target()] }) };
  const failed = relay.onMessage(msg, 'p1');
  await vi.advanceTimersByTimeAsync(1500);
  await failed;
  expect(create).toHaveBeenCalledTimes(1);
  expect(emit).not.toHaveBeenCalled();
  expect(complete).not.toHaveBeenCalled();
  const retry = relay.onMessage(msg, 'p1');
  await vi.advanceTimersByTimeAsync(1500);
  await retry;
  expect(create).toHaveBeenCalledTimes(2);
  expect(pages).toHaveLength(1);
  expect(complete).toHaveBeenCalledExactlyOnceWith(callId, 'p1');
  expect((complete.mock.contexts[0] as InstanceType<typeof AuditWitness>).open).toBe(0);
  expect(pages[0].system.targets[0]).toMatchObject({
    uuid: 'Actor.a1',
    undoable: true,
    changedPaths: ['name'],
    afterModifiedTime: 2,
  });
  expect(JSON.parse(pages[0].system.targets[0].before)).toMatchObject({ name: 'Before', hp: 9 });
  expect(emit).toHaveBeenCalledWith(
    'module.agent-gateway',
    { kind: 'audit.ack', id: callId },
    { recipients: ['p1'] },
  );
});
