import { updatePage } from './fake.js';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect, it, vi } from 'vitest';
import { undoEntry } from '../../src/audit/undo.js';
import { makeStore, writable, target, reserveFixtureUndo } from './fake.js';

const deps = (store: ReturnType<typeof makeStore>) => ({
  isGM: () => true,
  userId: () => 'gm',
  fromUuid: store.fromUuid,
  canModify: () => true,
  canCreate: () => true,
  now: () => 777,
  reserve: reserveFixtureUndo,
});
const pageFor = (...targets: any[]) => ({
  id: 'review-page',
  system: {
    targets: targets.map((t) => ({ ...t, before: JSON.stringify(t.before) })),
  },
  update: vi.fn(updatePage),
});

it('does not complete an undo when a deletion is vetoed', async () => {
  const store = makeStore();
  const doc = store.add(writable('Actor.A', { name: 'Created' }, 10, store));
  doc.delete = vi.fn(async () => undefined); // Foundry preDelete hook veto
  const page = pageFor(target({ uuid: doc.uuid, existed: false, before: null }));
  const result = await undoEntry(page, async () => true, deps(store));
  expect(result).toMatchObject({ status: 'failed', restored: 0 });
  expect(store.docs.has(doc.uuid)).toBe(true);
  expect(page.update).not.toHaveBeenCalled();
});

it('retries only failed targets and preserves subsequent edits to completed targets', async () => {
  const store = makeStore();
  const a = store.add(writable('Actor.A', { name: 'After A' }, 10, store));
  const b = store.add(writable('Actor.B', { name: 'After B' }, 10, store));
  const original = a.update;
  a.update = vi.fn().mockRejectedValueOnce(new Error('validation')).mockImplementation(original);
  const page = pageFor(target({ uuid: a.uuid }), target({ uuid: b.uuid }));
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    expect(await undoEntry(page, async () => true, deps(store))).toMatchObject({
      status: 'failed',
      restored: 1,
    });
    b.data.name = 'Later human edit';
    b._stats.modifiedTime = 30;
    expect(await undoEntry(page, async () => true, deps(store))).toMatchObject({
      status: 'done',
      restored: 1,
    });
    expect(b.data.name).toBe('Later human edit');
    expect(b.calls.update).toHaveLength(1);
  } finally {
    error.mockRestore();
  }
});

it('rejects an audit page creation veto so the relay can retry', async () => {
  const { writeAuditEntry } = await import('../../src/audit/journal.js');
  const { record } = await import('./fake.js');
  const gm = { id: 'gm', isGM: true };
  const journal = {
    id: 'J',
    flags: { 'agent-gateway': { auditJournal: true } },
    ownership: { default: 0 },
    _stats: { createdBy: gm.id },
    pages: { contents: [] },
    createEmbeddedDocuments: vi.fn(async () => []),
  };
  vi.stubGlobal('game', {
    settings: { get: () => journal.id },
    journal: { get: () => journal },
    users: { contents: [gm], get: () => gm },
  });
  try {
    await expect(writeAuditEntry(record())).rejects.toThrow('did not persist');
    expect(journal.pages.contents).toHaveLength(0);
  } finally {
    vi.unstubAllGlobals();
  }
});

it.each(['update', 'world-create', 'embedded-create'] as const)(
  'keeps the target retryable when %s is vetoed',
  async (kind) => {
    const store = makeStore();
    const doc = store.add(writable('Actor.A', { name: 'After' }, 10, store));
    let t = target({ uuid: doc.uuid });
    if (kind === 'update') doc.update = vi.fn(async () => undefined);
    else if (kind === 'world-create') {
      store.docs.delete(doc.uuid);
      t = target({ uuid: doc.uuid, existsAfter: false });
      vi.stubGlobal('getDocumentClass', () => ({ create: async () => undefined }));
    } else {
      t = target({ uuid: 'Actor.A.Item.I', existsAfter: false });
      doc.createEmbeddedDocuments = vi.fn(async () => []);
    }
    const page = pageFor(t);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(await undoEntry(page, async () => true, deps(store))).toMatchObject({
        status: 'failed',
        restored: 0,
        failed: [t.uuid],
      });
      expect(page.update).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
      vi.unstubAllGlobals();
    }
  },
);

it.each(['progress', 'completion'] as const)(
  'retains the reservation when %s persistence is vetoed',
  async (phase) => {
    const store = makeStore();
    const doc = store.add(writable('Actor.A', { name: 'After' }, 10, store));
    const page = pageFor(target({ uuid: doc.uuid }));
    const release = vi.fn(async () => {});
    if (phase === 'progress') page.update.mockImplementationOnce(async () => undefined);
    else
      page.update.mockImplementationOnce(updatePage).mockImplementationOnce(async () => undefined);
    await expect(
      undoEntry(page, async () => true, {
        ...deps(store),
        reserve: async () => ({ page, isHeld: () => true, release }),
      }),
    ).rejects.toThrow('refused');
    expect(doc.calls.update).toHaveLength(1);
    expect(release).not.toHaveBeenCalled();
  },
);
