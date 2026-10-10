/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { conflictFor, undoEntry, type UndoDeps } from '../../src/audit/undo.js';
import { reserveFixtureUndo, makeStore, target, writable } from './fake.js';
import type { AuditTarget } from '../../src/audit/types.js';

const stored = (t: AuditTarget) => ({ ...t, before: t.before ? JSON.stringify(t.before) : '' });
const makePage = (targets: AuditTarget[], extra: object = {}) => {
  const page: any = {
    updates: [] as any[],
    system: { targets: targets.map(stored), undoneAt: null, undoneBy: '', ...extra },
    update: async (d: any) => void page.updates.push(d),
  };
  return page;
};

function rig(over: Partial<UndoDeps> = {}) {
  const store = makeStore();
  const confirm = vi.fn(async () => true);
  const deps: Partial<UndoDeps> = {
    reserve: reserveFixtureUndo,
    isGM: () => true,
    canModify: () => true,
    canCreate: () => true,
    userId: () => 'gm1',
    fromUuid: store.fromUuid,
    now: () => 777,
    ...over,
  };
  return { store, confirm, deps };
}

afterEach(() => vi.restoreAllMocks());

describe('conflictFor', () => {
  it('flags a document modified after the recorded time, or missing/recreated against the record', () => {
    const t = target({ afterModifiedTime: 10 });
    expect(conflictFor(t, { _stats: { modifiedTime: 10 } })).toBeNull();
    expect(conflictFor(t, { _stats: { modifiedTime: 11 } })).toEqual({
      uuid: t.uuid,
      reason: 'modified',
    });
    expect(conflictFor(t, null)).toEqual({ uuid: t.uuid, reason: 'deleted' });
    const gone = target({ existsAfter: false, afterModifiedTime: null });
    expect(conflictFor(gone, null)).toBeNull();
    expect(conflictFor(gone, { _stats: { modifiedTime: 1 } })).toEqual({
      uuid: gone.uuid,
      reason: 'recreated',
    });
  });
});

describe('undoEntry', () => {
  it('restores the before snapshot by update, without _id, _stats or embedded collections', async () => {
    const { store, confirm, deps } = rig();
    const doc = store.add(writable('Actor.a1', { name: 'New', system: { hp: 1 } }, 10, store));
    const before = {
      _id: 'a1',
      name: 'Old',
      system: { hp: 9 },
      items: [{ _id: 'i1' }],
      _stats: { modifiedTime: 3 },
    };
    const page = makePage([target({ before })]);
    const out = await undoEntry(page, confirm, deps);
    expect(out).toMatchObject({ status: 'done', restored: 1, conflicts: [] });
    expect(confirm).not.toHaveBeenCalled();
    expect(doc.calls.update).toEqual([
      { data: { name: 'Old', system: { hp: 9 } }, opts: { diff: false, recursive: false } },
    ]);
    expect(page.updates).toEqual([{ 'system.undoneAt': 777, 'system.undoneBy': 'gm1' }]);
  });

  it('deletes a document the call created', async () => {
    const { store, confirm, deps } = rig();
    const doc = store.add(writable('Item.n1', { name: 'Made' }, 7, store));
    const page = makePage([
      target({ uuid: 'Item.n1', existed: false, before: null, afterModifiedTime: 7 }),
    ]);
    expect(await undoEntry(page, confirm, deps)).toMatchObject({ status: 'done', restored: 1 });
    expect(doc.calls.deleted).toBe(1);
  });

  it('recreates a deleted world document and a deleted embedded one with their ids', async () => {
    const { store, confirm, deps } = rig();
    const created: any[] = [];
    (globalThis as any).getDocumentClass = (name: string) => ({
      create: async (d: any, o: any) => void created.push({ name, d, o }),
    });
    const parent = store.add(writable('Actor.a1', {}, 5, store));
    parent.createEmbeddedDocuments = async (n: string, d: any[], o: any) =>
      void created.push({ n, d, o });
    const page = makePage([
      target({
        uuid: 'Actor.gone',
        before: { _id: 'gone', name: 'G' },
        existsAfter: false,
        afterModifiedTime: null,
      }),
      target({
        uuid: 'Actor.a1.Item.i9',
        before: { _id: 'i9', name: 'Sword' },
        existsAfter: false,
        afterModifiedTime: null,
      }),
    ]);
    const out = await undoEntry(page, confirm, deps);
    expect(out.status).toBe('done');
    expect(created).toEqual([
      { n: 'Item', d: [{ _id: 'i9', name: 'Sword' }], o: { keepId: true } },
      { name: 'Actor', d: { _id: 'gone', name: 'G' }, o: { keepId: true } },
    ]);
    delete (globalThis as any).getDocumentClass;
  });

  it('warns first when the document changed since, and changes nothing if declined', async () => {
    const { store, deps } = rig();
    const doc = store.add(writable('Actor.a1', { name: 'LaterEdit' }, 50, store));
    const page = makePage([target({ afterModifiedTime: 10 })]);
    const no = vi.fn(async () => false);
    const out = await undoEntry(page, no, deps);
    expect(out).toMatchObject({ status: 'cancelled', restored: 0 });
    expect(no).toHaveBeenCalledWith([{ uuid: 'Actor.a1', reason: 'modified' }]);
    expect(doc.calls.update).toEqual([]);
    expect(page.updates).toEqual([]);
    const yes = vi.fn(async () => true);
    expect(await undoEntry(page, yes, deps)).toMatchObject({ status: 'done', restored: 1 });
    expect(yes).toHaveBeenCalledTimes(1);
    expect(doc.calls.update).toHaveLength(1);
  });

  it('is for humans: a non-GM is refused and an undone entry is not undone twice', async () => {
    const { store, confirm, deps } = rig({ isGM: () => false });
    const doc = store.add(writable('Actor.a1', {}, 10, store));
    const page = makePage([target()]);
    expect((await undoEntry(page, confirm, deps)).status).toBe('refused');
    expect(doc.calls.update).toEqual([]);
    const done = makePage([target()], { undoneAt: 5 });
    expect((await undoEntry(done, confirm, { ...deps, isGM: () => true })).status).toBe('refused');
  });

  it('skips targets that are not undoable and says so', async () => {
    const { store, confirm, deps } = rig();
    const doc = store.add(writable('Actor.a1', {}, 10, store));
    const page = makePage([target({ undoable: false, note: 'snapshot too large to keep' })]);
    const out = await undoEntry(page, confirm, deps);
    expect(out).toMatchObject({ status: 'done', restored: 0, skipped: ['Actor.a1'] });
    expect(doc.calls.update).toEqual([]);
  });

  it('does not mark the entry undone when a restore fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { store, confirm, deps } = rig();
    const doc = store.add(writable('Actor.a1', {}, 10, store));
    doc.update = async () => {
      throw new Error('validation');
    };
    const page = makePage([target()]);
    const out = await undoEntry(page, confirm, deps);
    expect(out).toMatchObject({ status: 'failed', failed: ['Actor.a1'] });
    expect(page.updates).toEqual([]);
  });

  it('restores last target first', async () => {
    const { store, confirm, deps } = rig();
    const order: string[] = [];
    for (const id of ['A', 'B']) {
      const d = store.add(writable(`Actor.${id}`, {}, 10, store));
      d.update = async () => void order.push(id);
    }
    await undoEntry(
      makePage([target({ uuid: 'Actor.A' }), target({ uuid: 'Actor.B' })]),
      confirm,
      deps,
    );
    expect(order).toEqual(['B', 'A']);
  });

  it('never creates, updates or deletes a class outside the allowlist (User, Setting, Macro)', async () => {
    const { store, confirm, deps } = rig();
    const created: unknown[] = [];
    (globalThis as any).getDocumentClass = () => ({
      create: async (d: unknown) => void created.push(d),
    });
    const user = store.add(writable('User.u1', {}, 10, store));
    const macro = store.add(writable('Macro.m1', {}, 10, store));
    const page = makePage([
      target({
        uuid: 'User.gone',
        before: { _id: 'gone', role: 4 },
        existsAfter: false,
        afterModifiedTime: null,
      }),
      target({
        uuid: 'Setting.s1',
        before: { key: 'core.x' },
        existsAfter: false,
        afterModifiedTime: null,
      }),
      target({ uuid: 'Macro.m1', existed: false, before: null, afterModifiedTime: 10 }),
      target({ uuid: 'User.u1', afterModifiedTime: 10 }),
      target({
        uuid: 'Actor.a1.Macro.m2',
        before: { _id: 'm2' },
        existsAfter: false,
        afterModifiedTime: null,
      }),
    ]);
    const out = await undoEntry(page, confirm, deps);
    expect(created).toEqual([]);
    expect(user.calls.update).toEqual([]);
    expect(macro.calls.deleted).toBe(0);
    expect(out.skipped).toHaveLength(5);
    delete (globalThis as any).getDocumentClass;
  });

  it('checks the acting GM may update, delete and create, and reports a failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { store, confirm, deps } = rig({ canModify: () => false, canCreate: () => false });
    const a = store.add(writable('Actor.a1', {}, 10, store));
    const b = store.add(writable('Actor.b1', {}, 10, store));
    (globalThis as any).getDocumentClass = () => ({
      create: async () => void a.calls.update.push({ data: 'created', opts: {} }),
    });
    const page = makePage([
      target({ uuid: 'Actor.a1' }),
      target({ uuid: 'Actor.b1', existed: false, before: null }),
      target({
        uuid: 'Actor.gone',
        before: { _id: 'gone' },
        existsAfter: false,
        afterModifiedTime: null,
      }),
    ]);
    const out = await undoEntry(page, confirm, deps);
    expect(out.status).toBe('failed');
    expect(out.failed).toHaveLength(3);
    expect(a.calls.update).toEqual([]);
    expect(b.calls.deleted).toBe(0);
    delete (globalThis as any).getDocumentClass;
  });

  it('a second undo of the same entry while one is running does nothing', async () => {
    const { store, confirm, deps } = rig();
    const doc = store.add(writable('Actor.a1', {}, 10, store));
    let release!: () => void;
    doc.update = async () => {
      doc.calls.update.push({ data: 1, opts: 1 });
      await new Promise<void>((r) => (release = r));
    };
    const page = makePage([target()]);
    page.id = 'pg1';
    const first = undoEntry(page, confirm, deps);
    await new Promise((r) => setTimeout(r, 5));
    expect((await undoEntry(page, confirm, deps)).status).toBe('busy');
    release();
    expect((await first).status).toBe('done');
    expect(doc.calls.update).toHaveLength(1);
    expect((await undoEntry(makePage([target()], { undoneAt: 1 }), confirm, deps)).status).toBe(
      'refused',
    );
  });

  it('never touches an audit document', async () => {
    const { store, confirm, deps } = rig();
    const j = store.add(writable('JournalEntry.aj', { flags: {} }, 10, store));
    j.flags = { 'agent-gateway': { auditJournal: true } };
    const page = makePage([
      target({ uuid: 'JournalEntry.aj', existed: false, before: null, afterModifiedTime: 10 }),
    ]);
    expect((await undoEntry(page, confirm, deps)).skipped).toEqual(['JournalEntry.aj']);
    expect(j.calls.deleted).toBe(0);
  });
});
