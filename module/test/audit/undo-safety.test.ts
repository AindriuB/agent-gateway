/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { undoEntry, type UndoDeps } from '../../src/audit/undo.js';
import { reserveFixtureUndo, makeStore, target, writable } from './fake.js';

function rig() {
  const store = makeStore();
  const a = store.add(writable('Actor.A', { name: 'After A' }, 10, store));
  const b = store.add(writable('Actor.B', { name: 'After B' }, 10, store));
  const page: any = {
    id: 'undo-safety',
    system: {
      targets: [a, b].map((d) => ({
        ...target({ uuid: d.uuid }),
        before: JSON.stringify({ name: 'Before' }),
      })),
    },
    update: vi.fn(async () => {}),
  };
  const deps: Partial<UndoDeps> = {
    reserve: reserveFixtureUndo,
    isGM: () => true,
    userId: () => 'gm1',
    fromUuid: store.fromUuid,
    canModify: () => true,
    canCreate: () => true,
    now: () => 777,
  };
  return { store, a, b, page, deps };
}

function pauseUpdate(doc: any) {
  let opened!: () => void;
  let release!: () => void;
  const ready = new Promise<void>((resolve) => (opened = resolve));
  const wait = new Promise<void>((resolve) => (release = resolve));
  const update = doc.update.bind(doc);
  doc.update = async (data: any, options: any) => {
    opened();
    await wait;
    return update(data, options);
  };
  return { ready, release };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('undo mutations separated by awaits', () => {
  it.each(['modified', 'replaced', 'deleted'] as const)(
    'warns before touching a later target %s during an earlier restore',
    async (change) => {
      const { store, a, b, page, deps } = rig();
      const pause = pauseUpdate(b);
      const confirm = vi.fn<UndoDeps['confirmConflicts']>(async () => false);
      const pending = undoEntry(page, confirm, deps);
      await pause.ready;
      if (change === 'modified') a._stats.modifiedTime = 20;
      if (change === 'replaced')
        store.add(writable(a.uuid, { name: 'Human replacement' }, 20, store));
      if (change === 'deleted') store.docs.delete(a.uuid);
      pause.release();
      const out = await pending;
      expect(out).toMatchObject({ status: 'cancelled', restored: 1 });
      expect(confirm).toHaveBeenCalledExactlyOnceWith([
        { uuid: a.uuid, reason: change === 'deleted' ? 'deleted' : 'modified' },
      ]);
      expect(a.calls.update).toEqual([]);
      expect(store.docs.get(a.uuid)?.calls.update ?? []).toEqual([]);
      expect(b.calls.update).toHaveLength(1);
      expect(page.update).not.toHaveBeenCalled();
    },
  );

  it('uses the latest document after accepting the conflict discovered between restores', async () => {
    const { store, a, b, page, deps } = rig();
    const pause = pauseUpdate(b);
    const confirm = vi.fn(async () => true);
    const pending = undoEntry(page, confirm, deps);
    await pause.ready;
    const replacement = store.add(writable(a.uuid, { name: 'Human edit' }, 20, store));
    pause.release();
    expect(await pending).toMatchObject({ status: 'done', restored: 2 });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(a.calls.update).toEqual([]);
    expect(replacement.data.name).toBe('Before');
  });

  it('stops if the acting GM is demoted while a mutation awaits a response', async () => {
    const { a, b, page, deps } = rig();
    let gm = true;
    const pause = pauseUpdate(b);
    const pending = undoEntry(page, async () => true, { ...deps, isGM: () => gm });
    await pause.ready;
    gm = false;
    pause.release();
    expect(await pending).toMatchObject({ status: 'refused', restored: 1 });
    expect(a.calls.update).toEqual([]);
    expect(page.update).not.toHaveBeenCalled();
  });

  it('stops if the acting GM is demoted while confirming conflicts', async () => {
    const { a, b, page, deps } = rig();
    let gm = true;
    a._stats.modifiedTime = 20;
    const out = await undoEntry(
      page,
      async () => {
        gm = false;
        return true;
      },
      { ...deps, isGM: () => gm },
    );
    expect(out).toMatchObject({ status: 'refused', restored: 0 });
    expect(a.calls.update).toEqual([]);
    expect(b.calls.update).toEqual([]);
    expect(page.update).not.toHaveBeenCalled();
  });
});

describe('undo resolution and embedded creation', () => {
  it('keeps an undo retryable when target lookup fails, instead of treating the target as absent', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { a, page, deps } = rig();
    page.system.targets = [
      { ...target({ uuid: a.uuid, existed: false, before: null }), before: '' },
    ];
    const lookup = vi.fn().mockRejectedValueOnce(new Error('temporary lookup failure'));
    expect(await undoEntry(page, async () => true, { ...deps, fromUuid: lookup })).toMatchObject({
      status: 'failed',
      restored: 0,
      failed: [a.uuid],
    });
    expect(page.update).not.toHaveBeenCalled();
    expect(a.calls.deleted).toBe(0);
    expect(await undoEntry(page, async () => true, deps)).toMatchObject({
      status: 'done',
      restored: 1,
    });
    expect(a.calls.deleted).toBe(1);
  });

  it.each(['protected parent', 'creation forbidden'])(
    'refuses to recreate an embedded document when %s',
    async (why) => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const { store, page, deps } = rig();
      const parent = store.add(writable('JournalEntry.J', {}, 10, store));
      parent.constructor = { metadata: { embedded: { JournalEntryPage: 'pages' } } };
      parent.createEmbeddedDocuments = vi.fn(async () => {});
      if (why === 'protected parent') parent.flags = { 'agent-gateway': { auditJournal: true } };
      page.system.targets = [
        {
          ...target({
            uuid: 'JournalEntry.J.JournalEntryPage.P',
            existsAfter: false,
            afterModifiedTime: null,
          }),
          before: JSON.stringify({ _id: 'P', name: 'Deleted page' }),
        },
      ];
      const out = await undoEntry(page, async () => true, {
        ...deps,
        canCreate: (name) => why !== 'creation forbidden' || name !== 'JournalEntryPage',
      });
      expect(out).toMatchObject({ status: 'failed', restored: 0 });
      expect(parent.createEmbeddedDocuments).not.toHaveBeenCalled();
      expect(page.update).not.toHaveBeenCalled();
    },
  );
});
