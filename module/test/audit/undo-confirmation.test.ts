/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from 'vitest';
import { undoEntry, type Conflict, type UndoDeps } from '../../src/audit/undo.js';
import { reserveFixtureUndo, makeStore, target, writable } from './fake.js';

function rig(secondMissing = false) {
  const store = makeStore();
  const a = store.add(writable('Actor.A', { name: 'Later A' }, 20, store));
  const b = secondMissing ? null : store.add(writable('Actor.B', { name: 'After B' }, 10, store));
  const page = {
    id: 'confirmation-entry',
    system: {
      targets: [
        target({ uuid: a.uuid }),
        target({ uuid: 'Actor.B', existsAfter: !secondMissing }),
      ].map((t) => ({ ...t, before: JSON.stringify(t.before) })),
    },
    update: vi.fn(async () => {}),
  };
  const deps: Partial<UndoDeps> = {
    reserve: reserveFixtureUndo,
    isGM: () => true,
    userId: () => 'gm',
    fromUuid: store.fromUuid,
    canModify: () => true,
    canCreate: () => true,
    now: () => 777,
  };
  return { store, a, b, page, deps };
}

function dialog() {
  let opened!: () => void;
  let answer!: (yes: boolean) => void;
  const ready = new Promise<void>((resolve) => (opened = resolve));
  const result = new Promise<boolean>((resolve) => (answer = resolve));
  return { ready, answer, show: async () => (opened(), result) };
}

const modified = (uuid: string): Conflict => ({ uuid, reason: 'modified' });

describe('undo confirmation revalidation', () => {
  it.each(['modified', 'deleted', 'recreated', 'replaced'] as const)(
    'warns again when an initially conflict-free target is %s while the dialog is open',
    async (change) => {
      const { store, a, b, page, deps } = rig(change === 'recreated');
      const first = dialog();
      const confirm = vi
        .fn<UndoDeps['confirmConflicts']>(async () => false)
        .mockImplementationOnce(first.show);
      const pending = undoEntry(page, confirm, deps);
      await first.ready;
      let replacement: any = null;
      if (change === 'modified') b!._stats.modifiedTime = 30;
      if (change === 'deleted') store.docs.delete('Actor.B');
      if (change === 'recreated' || change === 'replaced') {
        // Even replacement with the same timestamp must use the current reference.
        replacement = store.add(writable('Actor.B', { name: 'New B' }, 10, store));
      }
      first.answer(true);
      const out = await pending;
      expect(out).toMatchObject({ status: 'cancelled', restored: 0 });
      expect(confirm).toHaveBeenCalledTimes(2);
      expect(confirm.mock.calls[1]?.[0]).toEqual([
        { uuid: 'Actor.B', reason: change === 'replaced' ? 'modified' : change },
        modified('Actor.A'),
      ]);
      expect(a.calls.update).toEqual([]);
      expect(b?.calls.update ?? []).toEqual([]);
      expect(replacement?.calls.update ?? []).toEqual([]);
      expect(page.update).not.toHaveBeenCalled();
    },
  );

  it('requests another confirmation when an already conflicting target changes again', async () => {
    const { a, b, page, deps } = rig();
    const confirm = vi.fn<UndoDeps['confirmConflicts']>(async () => {
      if (confirm.mock.calls.length < 3) {
        a._stats.modifiedTime += 1;
        return true;
      }
      return false;
    });
    expect(await undoEntry(page, confirm, deps)).toMatchObject({
      status: 'cancelled',
      restored: 0,
    });
    expect(confirm).toHaveBeenCalledTimes(3);
    for (const [conflicts] of confirm.mock.calls) expect(conflicts).toEqual([modified(a.uuid)]);
    expect(a.calls.update).toEqual([]);
    expect(b!.calls.update).toEqual([]);
    expect(page.update).not.toHaveBeenCalled();
  });

  it('uses fresh document references after renewed confirmation and restores in reverse order', async () => {
    const { store, a, b, page, deps } = rig();
    const replacement = writable('Actor.B', { name: 'Replacement' }, 30, store);
    const order: string[] = [];
    const updateB = replacement.update.bind(replacement);
    replacement.update = async (data: any, opts: any) => {
      order.push('B');
      await updateB(data, opts);
    };
    const updateA = a.update.bind(a);
    a.update = async (data: any, opts: any) => {
      order.push('A');
      await updateA(data, opts);
    };
    const confirm = vi
      .fn(async () => true)
      .mockImplementationOnce(async () => {
        store.add(replacement);
        return true;
      });
    expect(await undoEntry(page, confirm, deps)).toMatchObject({ status: 'done', restored: 2 });
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(order).toEqual(['B', 'A']);
    expect(b!.calls.update).toEqual([]);
    expect(replacement.data.name).toBe('Old');
    expect(page.update).toHaveBeenCalledOnce();
  });

  it('rechecks audit protection on the current target after confirmation', async () => {
    const { store, a, b, page, deps } = rig();
    const journal = writable('JournalEntry.J', {}, 10, store);
    store.add(journal);
    page.system.targets[1]!.uuid = journal.uuid;
    const confirm = vi.fn(async () => {
      journal.flags = { 'agent-gateway': { auditJournal: true } };
      return true;
    });
    expect(await undoEntry(page, confirm, deps)).toMatchObject({
      status: 'done',
      restored: 1,
      skipped: [journal.uuid],
    });
    expect(journal.calls.update).toEqual([]);
    expect(b!.calls.update).toEqual([]);
    expect(a.calls.update).toHaveLength(1);
  });
});
