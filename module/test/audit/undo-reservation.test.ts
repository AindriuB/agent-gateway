/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { reserveUndo, reservationId } from '../../src/audit/reservation.js';
import { AUDIT_NS, AUDIT_TYPE } from '../../src/audit/types.js';
import { makeStore, target, writable } from './fake.js';

/** Independent caches sharing Foundry's serialized, unique-id embedded creation. */
function world() {
  const server = new Map<string, any>();
  let tokenId = 0;
  const store = makeStore();
  const doc = store.add(writable('Actor.A', { name: 'After' }, 10, store));
  const initial = {
    id: 'audit-page',
    uuid: 'JournalEntry.J.JournalEntryPage.audit-page',
    type: AUDIT_TYPE,
    system: {
      entryId: 'audit-call',
      targets: [{ ...target({ uuid: doc.uuid }), before: JSON.stringify({ name: 'Before' }) }],
    },
  };
  server.set(initial.id, structuredClone(initial));
  const client = (userId: string) => {
    const pages = new Map<string, any>();
    const journal: any = {
      pages,
      createEmbeddedDocuments: vi.fn(async (_name: string, data: any[], options: any) => {
        expect(options.keepId).toBe(true);
        const d = data[0];
        // Check+insert happen before yielding, just as Foundry's database semaphore protects them.
        if (server.has(d._id)) throw new Error('the id already exists');
        server.set(d._id, structuredClone(d));
        const made = {
          ...structuredClone(d),
          id: d._id,
          delete: vi.fn(async () => {
            server.delete(d._id);
            pages.delete(d._id);
          }),
        };
        pages.set(made.id, made);
        return [made];
      }),
    };
    const page: any = {
      ...structuredClone(initial),
      parent: journal,
      update: vi.fn(async (change: any) => {
        const current = server.get(initial.id);
        for (const [k, v] of Object.entries(change)) current.system[k.slice('system.'.length)] = v;
        // Deliberately do not broadcast into the other client's stale cache.
        Object.assign(page.system, current.system);
        return page;
      }),
    };
    pages.set(page.id, page);
    const deps = {
      journal: () => journal,
      token: () => `${userId}-${++tokenId}`,
      userId: () => userId,
      readPage: vi.fn(async () => ({
        ...structuredClone(server.get(page.id)),
        parent: journal,
        update: page.update,
      })),
    };
    const undoDeps = {
      isGM: () => true,
      userId: () => userId,
      canModify: () => true,
      canCreate: () => true,
      fromUuid: store.fromUuid,
      now: () => 777,
      reserve: (p: any) => reserveUndo(p, deps),
    };
    return { page, journal, pages, deps, undoDeps };
  };
  return { server, doc, store, client, initial };
}

async function separateClients() {
  vi.resetModules();
  const a = await import('../../src/audit/undo.js');
  vi.resetModules();
  const b = await import('../../src/audit/undo.js');
  return [a.undoEntry, b.undoEntry] as const;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('server undo reservations', () => {
  it.each([
    { action: 'update', otherUser: 'gm2' },
    { action: 'create', otherUser: 'gm2' },
    { action: 'update', otherUser: 'gm1' },
    { action: 'create', otherUser: 'gm1' },
  ])(
    'serializes $action from gm1 and $otherUser with independent browser guards',
    async ({ action, otherUser }) => {
      const w = world();
      const [undoA, undoB] = await separateClients();
      const a = w.client('gm1');
      const b = w.client(otherUser);
      let opened!: () => void;
      let release!: () => void;
      const ready = new Promise<void>((r) => (opened = r));
      const wait = new Promise<void>((r) => (release = r));
      const mutate = vi.fn(async () => {
        opened();
        await wait;
        if (action === 'create') {
          w.doc.data.name = 'Before';
          w.store.add(w.doc);
        }
        return w.doc;
      });
      if (action === 'update') w.doc.update = mutate;
      else {
        w.doc.documentName = 'Actor';
        w.doc.collection = { get: (id: string) => w.store.docs.get(`Actor.${id}`) };
        w.doc.constructor = { metadata: { embedded: {} } };
        w.store.docs.delete(w.doc.uuid);
        for (const page of [a.page, b.page, w.server.get(w.initial.id)]) {
          page.system.targets[0].before = JSON.stringify({ _id: 'A', name: 'Before' });
          page.system.targets[0].existsAfter = false;
          page.system.targets[0].afterModifiedTime = null;
        }
        vi.stubGlobal('getDocumentClass', () => ({ create: mutate }));
      }
      const first = undoA(a.page, async () => true, a.undoDeps);
      await ready;
      const second = await undoB(b.page, async () => true, b.undoDeps);
      expect(second).toMatchObject({ status: 'busy', restored: 0 });
      expect(mutate).toHaveBeenCalledTimes(1);
      expect(w.server.has(reservationId(a.page.uuid))).toBe(true);
      release();
      expect(await first).toMatchObject({ status: 'done', restored: 1 });
      expect(w.server.has(reservationId(a.page.uuid))).toBe(false);
      expect(b.page.update).not.toHaveBeenCalled();
    },
  );

  it('holds the reservation through the conflict dialog and releases it on cancellation', async () => {
    const w = world();
    w.doc._stats.modifiedTime = 20;
    const [undoA, undoB] = await separateClients();
    const a = w.client('gm1');
    const b = w.client('gm2');
    const out = await undoA(
      a.page,
      async () => {
        expect(await undoB(b.page, async () => true, b.undoDeps)).toMatchObject({ status: 'busy' });
        return false;
      },
      a.undoDeps,
    );
    expect(out.status).toBe('cancelled');
    expect(w.server.has(reservationId(a.page.uuid))).toBe(false);
    expect(await undoB(b.page, async () => true, b.undoDeps)).toMatchObject({ status: 'done' });
  });

  it('checks server completion after acquiring from a stale client cache', async () => {
    const w = world();
    const [undoA, undoB] = await separateClients();
    const a = w.client('gm1');
    const b = w.client('gm2');
    expect(await undoA(a.page, async () => true, a.undoDeps)).toMatchObject({ status: 'done' });
    expect(b.page.system.undoneAt).toBeUndefined();
    expect(await undoB(b.page, async () => true, b.undoDeps)).toMatchObject({
      status: 'refused',
      restored: 0,
    });
    expect(w.doc.calls.update).toHaveLength(1);
    expect(b.deps.readPage).toHaveBeenCalledTimes(1);
    expect(w.server.has(reservationId(a.page.uuid))).toBe(false);
  });

  it('refuses if the reservation disappears during confirmation', async () => {
    const w = world();
    const a = w.client('gm1');
    w.doc._stats.modifiedTime = 20;
    const [undo] = await separateClients();
    const out = await undo(
      a.page,
      async () => {
        a.pages.delete(reservationId(a.page.uuid));
        return true;
      },
      a.undoDeps,
    );
    expect(out).toMatchObject({ status: 'refused', restored: 0 });
    expect(w.doc.calls.update).toEqual([]);
  });

  it('refuses changed server ids and never restores without the expected reservation', async () => {
    const w = world();
    const a = w.client('gm1');
    a.journal.createEmbeddedDocuments.mockImplementationOnce(async (_n: string, data: any[]) => {
      const made = { ...data[0], id: 'different-id', delete: vi.fn(async () => {}) };
      return [made];
    });
    await expect(reserveUndo(a.page, a.deps)).rejects.toThrow('did not retain');
    expect(a.deps.readPage).not.toHaveBeenCalled();
  });

  it('cleans up its reservation if the fresh entry lookup fails', async () => {
    const w = world();
    const a = w.client('gm1');
    a.deps.readPage.mockRejectedValueOnce(new Error('lookup failed'));
    await expect(reserveUndo(a.page, a.deps)).rejects.toThrow('lookup failed');
    expect(w.server.has(reservationId(a.page.uuid))).toBe(false);
  });

  it('never releases a reservation with another owner token', async () => {
    const w = world();
    const a = w.client('gm1');
    const lease = await reserveUndo(a.page, a.deps);
    const lock = a.pages.get(reservationId(a.page.uuid));
    lock.flags[AUDIT_NS].undoReservation.token = 'another-owner';
    expect(lease?.isHeld()).toBe(false);
    await lease?.release();
    expect(lock.delete).not.toHaveBeenCalled();
    expect(w.server.has(lock.id)).toBe(true);
  });

  it('refuses pages outside the trusted audit journal', async () => {
    const w = world();
    const a = w.client('gm1');
    await expect(reserveUndo({ ...a.page, parent: {} }, a.deps)).rejects.toThrow(
      'trusted audit journal',
    );
    expect(a.journal.createEmbeddedDocuments).not.toHaveBeenCalled();
  });
});

describe('reservation finalization and authoritative reads', () => {
  it('holds the reservation until completion persistence finishes', async () => {
    const w = world();
    const a = w.client('gm1');
    const b = w.client('gm2');
    const [undoA, undoB] = await separateClients();
    let opened!: () => void;
    let finish!: () => void;
    const ready = new Promise<void>((r) => (opened = r));
    const wait = new Promise<void>((r) => (finish = r));
    const update = a.page.update;
    a.page.update = vi.fn(async (change) => {
      opened();
      await wait;
      return update(change);
    });
    const first = undoA(a.page, async () => true, a.undoDeps);
    await ready;
    expect(await undoB(b.page, async () => true, b.undoDeps)).toMatchObject({ status: 'busy' });
    finish();
    expect(await first).toMatchObject({ status: 'done' });
    expect(w.doc.calls.update).toHaveLength(1);
    expect(w.server.has(reservationId(a.page.uuid))).toBe(false);
  });

  it('releases a settled failed undo so it can be retried', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const w = world();
    const a = w.client('gm1');
    const b = w.client('gm2');
    const [undoA, undoB] = await separateClients();
    const update = w.doc.update;
    w.doc.update = vi
      .fn()
      .mockRejectedValueOnce(new Error('validation'))
      .mockImplementation(update);
    expect(await undoA(a.page, async () => true, a.undoDeps)).toMatchObject({ status: 'failed' });
    expect(w.server.has(reservationId(a.page.uuid))).toBe(false);
    expect(await undoB(b.page, async () => true, b.undoDeps)).toMatchObject({ status: 'done' });
  });

  it('keeps an unexpected finalization failure reserved for human recovery', async () => {
    const w = world();
    const a = w.client('gm1');
    const b = w.client('gm2');
    const [undoA, undoB] = await separateClients();
    a.page.update = vi.fn().mockRejectedValueOnce(new Error('completion write failed'));
    await expect(undoA(a.page, async () => true, a.undoDeps)).rejects.toThrow(
      'completion write failed',
    );
    expect(w.server.has(reservationId(a.page.uuid))).toBe(true);
    expect(await undoB(b.page, async () => true, b.undoDeps)).toMatchObject({ status: 'busy' });
    expect(w.doc.calls.update).toHaveLength(1);
  });

  it('reads the reserved entry through the server database API by parent and id', async () => {
    const w = world();
    const a = w.client('gm1');
    // The installed backend returns every embedded page and constructs parentless results.
    const fresh = structuredClone(w.server.get(a.page.id));
    const get = vi.fn(async () => [{ id: 'other-page' }, fresh]);
    const cls = { database: { get } };
    vi.stubGlobal('getDocumentClass', () => cls);
    const lease = await reserveUndo(a.page, {
      journal: a.deps.journal,
      token: a.deps.token,
      userId: a.deps.userId,
    });
    expect(get).toHaveBeenCalledExactlyOnceWith(cls, {
      parent: a.journal,
      query: { _id: a.page.id },
    });
    expect(lease?.page).toBe(fresh);
    await lease?.release();
  });
});

it('persists completion through the trusted original page, not a parentless server result', async () => {
  const w = world();
  const a = w.client('gm1');
  const [undo] = await separateClients();
  a.deps.readPage.mockImplementationOnce(async () => structuredClone(w.server.get(a.page.id)));
  expect(await undo(a.page, async () => true, a.undoDeps)).toMatchObject({
    status: 'done',
    restored: 1,
  });
  expect(a.page.update).toHaveBeenCalledWith({
    'system.undoneAt': 777,
    'system.undoneBy': 'gm1',
  });
  expect(w.server.get(a.page.id).system.undoneAt).toBe(777);
  expect(w.server.has(reservationId(a.page.uuid))).toBe(false);
});

it('reads completed targets from the server before a different GM retries a partial undo', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const w = world();
  const bDoc = w.store.add(writable('Actor.B', { name: 'After B' }, 10, w.store));
  w.server.get(w.initial.id).system.targets.push({
    ...target({ uuid: bDoc.uuid }),
    before: JSON.stringify({ name: 'Before B' }),
  });
  const a = w.client('gm1');
  const b = w.client('gm2');
  const original = w.doc.update;
  w.doc.update = vi
    .fn()
    .mockRejectedValueOnce(new Error('validation'))
    .mockImplementation(original);
  const [undoA, undoB] = await separateClients();
  try {
    expect(await undoA(a.page, async () => true, a.undoDeps)).toMatchObject({
      status: 'failed',
      restored: 1,
    });
    expect(w.server.get(w.initial.id).system.undoCompleted).toEqual([bDoc.uuid]);
    expect(b.page.system.undoCompleted).toBeUndefined();
    bDoc.data.name = 'Human edit';
    bDoc._stats.modifiedTime = 20;
    expect(await undoB(b.page, async () => true, b.undoDeps)).toMatchObject({
      status: 'done',
      restored: 1,
    });
    expect(bDoc.calls.update).toHaveLength(1);
    expect(bDoc.data.name).toBe('Human edit');
  } finally {
    error.mockRestore();
  }
});
