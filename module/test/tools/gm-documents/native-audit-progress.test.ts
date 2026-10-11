/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { observeNativeAuditProgress } from './native-audit-progress.js';
const target = {
  journalUuid: 'JournalEntry.audit',
  pageId: 'exact',
  gmId: 'gm',
  roots: ['Actor.a', 'Item.b', 'JournalEntry.c'],
};
const progress = { undoCompleted: target.roots, undoneBy: 'gm', undoneAt: 123 };
const request = {
  type: 'JournalEntryPage',
  action: 'update',
  operation: {
    parentUuid: target.journalUuid,
    updates: [{ _id: 'exact', 'system.undoneAt': 123 }],
  },
};
const raw = (system: any = progress, id = 'exact', parent = target.journalUuid) => ({
  type: 'JournalEntryPage',
  operation: { parentUuid: parent },
  result: [{ _id: id, system: structuredClone(system) }],
});
let observer: ReturnType<typeof observeNativeAuditProgress> | undefined;
afterEach(() => {
  observer?.stop();
  observer = undefined;
  delete (globalThis as any).__task23AuditProgress;
});
const tick = async () => {
  await new Promise((done) => setTimeout(done, 0));
};
describe('passive native raw audit observation', () => {
  it('preserves exact receiver, arguments, promise identity and raw response before caller model construction', async () => {
    const response = raw();
    const promise = Promise.resolve(response);
    const dispatch = vi.fn(function (this: any, ...args: any[]) {
      expect(this).toBe(socket);
      return args[1].action === 'get' ? Promise.resolve(raw()) : promise;
    });
    const socket: any = { dispatch };
    observer = observeNativeAuditProgress(target, socket);
    const args = ['modifyDocument', request, { extra: true }];
    const actual = socket.dispatch(...args);
    expect(actual).toBe(promise);
    expect(dispatch.mock.calls[0]).toEqual(args);
    await actual.then((result: any) => {
      expect(observer!.snapshot().events[0].progress).toEqual(progress);
      result.result[0].system.undoCompleted = []; // Simulate subsequent model handling.
    });
    await tick();
    expect(observer.snapshot().events[0].progress.undoCompleted).toEqual(target.roots);
    expect(dispatch.mock.calls[1]).toEqual([
      'modifyDocument',
      {
        type: 'JournalEntryPage',
        action: 'get',
        operation: {
          parentUuid: target.journalUuid,
          query: { _id: target.pageId },
        },
      },
    ]);
  });
  it('passes synchronous throws and original rejected promises unchanged without unhandled sidechains', async () => {
    const failure = Error('native');
    const socket: any = {
      dispatch: vi.fn(() => {
        throw failure;
      }),
    };
    observer = observeNativeAuditProgress(target, socket);
    expect(() => socket.dispatch('modifyDocument', request)).toThrow(failure);
    observer.stop();
    const promise = Promise.reject(failure);
    socket.dispatch = vi.fn(() => promise) as any;
    observer = observeNativeAuditProgress(target, socket);
    expect(socket.dispatch('modifyDocument', request)).toBe(promise);
    await expect(promise).rejects.toBe(failure);
    await tick();
    expect(observer.snapshot().events).toEqual([{ kind: 'update-error', progress: null }]);
  });
  it.each([
    { ...request, type: 'Actor' },
    { ...request, action: 'get' },
    { ...request, operation: { ...request.operation, parentUuid: 'JournalEntry.other' } },
    { ...request, operation: { ...request.operation, updates: [{ _id: 'other' }] } },
  ])('ignores unrelated transport requests without extra reads: %j', async (input) => {
    const dispatch = vi.fn(() => Promise.resolve(raw()));
    const socket: any = { dispatch };
    observer = observeNativeAuditProgress(target, socket);
    await socket.dispatch('modifyDocument', input);
    await tick();
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(observer.snapshot().events).toEqual([]);
  });
  it('extracts only the exact parent/page from native multi-response envelopes', async () => {
    const socket: any = {
      dispatch: vi.fn((_event: any, req: any) =>
        Promise.resolve(
          req.action === 'update' || req.operation.query?._id
            ? {
                results: [
                  raw(progress, 'exact', 'JournalEntry.other'),
                  raw(progress, 'other'),
                  raw(),
                ],
              }
            : raw(),
        ),
      ),
    };
    observer = observeNativeAuditProgress(target, socket);
    await socket.dispatch('modifyDocument', request);
    await observer.drain();
    expect(await observer.read()).toEqual(progress);
    expect(observer.complete()).toBe(true);
  });
  it.each([
    { ...progress, undoCompleted: target.roots.slice(0, 2) },
    { ...progress, undoCompleted: [target.roots[0], target.roots[0], target.roots[2]] },
    { ...progress, undoneBy: 'other' },
    { ...progress, undoneAt: null },
    { ...progress, undoneAt: Number.NaN },
    { ...progress, undoneAt: 0 },
    {},
  ])('refuses partial or invalid durable completion: %j', async (system) => {
    const socket: any = { dispatch: () => Promise.resolve(raw(system)) };
    observer = observeNativeAuditProgress(target, socket);
    await observer.read();
    expect(Boolean(observer.complete())).toBe(false);
  });
  it('does not accept completion from an update alone when fresh raw get is missing', async () => {
    const socket: any = {
      dispatch: (_event: any, req: any) =>
        Promise.resolve(req.action === 'get' ? raw(progress, 'other') : raw()),
    };
    observer = observeNativeAuditProgress(target, socket);
    await socket.dispatch('modifyDocument', request);
    await tick();
    expect(observer.snapshot().events[0].progress).toEqual(progress);
    expect(Boolean(observer.complete())).toBe(false);
  });
  it('bounds passive update reads and restores original dispatch on stop', async () => {
    const original = vi.fn(() => Promise.resolve(raw()));
    const socket: any = { dispatch: original };
    observer = observeNativeAuditProgress(target, socket);
    await Promise.all(
      Array.from({ length: 100 }, () => socket.dispatch('modifyDocument', request)),
    );
    await tick();
    expect(original).toHaveBeenCalledTimes(228);
    expect(observer.snapshot().events.length).toBeLessThanOrEqual(256);
    expect(observer.snapshot().failed).toBe(true);
    expect(observer.complete()).toBe(false);
    observer.stop();
    expect(socket.dispatch).toBe(original);
  });
  it('contains observation failures while preserving a successful native result', async () => {
    const result = Promise.resolve(raw());
    const socket: any = {
      dispatch: (_event: any, req: any) =>
        req.action === 'get' ? Promise.reject(Error('read failed')) : result,
    };
    observer = observeNativeAuditProgress(target, socket);
    expect(socket.dispatch('modifyDocument', request)).toBe(result);
    await result;
    await tick();
    expect(observer.snapshot().events.some((event) => event.kind === 'get-error')).toBe(true);
  });
  it('refuses a durable live reservation and rejects a missing reservation response', async () => {
    let missing = false;
    const socket: any = {
      dispatch: (_event: any, req: any) =>
        Promise.resolve(
          req.action === 'update' || req.operation.query?._id
            ? raw()
            : missing
              ? {}
              : {
                  ...raw(),
                  result: [
                    {
                      _id: 'lock',
                      flags: {
                        'agent-gateway': {
                          undoReservation: {
                            entry: `${target.journalUuid}.JournalEntryPage.${target.pageId}`,
                          },
                        },
                      },
                    },
                  ],
                },
        ),
    };
    observer = observeNativeAuditProgress(target, socket);
    await observer.read();
    expect(observer.complete()).toBe(false);
    expect(observer.snapshot().reservationCount).toBe(1);
    missing = true;
    await expect(observer.read()).rejects.toThrow('Malformed raw reservation');
    expect(Boolean(observer.complete())).toBe(false);
  });
  it('requires an observed update and accepts native dotted partial response progress', async () => {
    const socket: any = {
      dispatch: (_event: any, req: any) =>
        Promise.resolve(
          req.action === 'get'
            ? raw()
            : { ...raw(), result: [{ _id: 'exact', 'system.undoCompleted': target.roots }] },
        ),
    };
    observer = observeNativeAuditProgress(target, socket);
    await observer.read();
    expect(Boolean(observer.complete())).toBe(false);
    await socket.dispatch('modifyDocument', request);
    await observer.drain();
    await observer.read();
    expect(observer.complete()).toBe(true);
  });
  it('latches a passive read error despite later valid raw completion', async () => {
    let rejectGet = true;
    const socket: any = {
      dispatch: (_event: any, req: any) =>
        req.action === 'get' && rejectGet
          ? Promise.reject(Error('sensor'))
          : Promise.resolve(raw()),
    };
    observer = observeNativeAuditProgress(target, socket);
    await socket.dispatch('modifyDocument', request);
    await observer.drain();
    rejectGet = false;
    await observer.read();
    expect(observer.snapshot().failed).toBe(true);
    expect(observer.complete()).toBe(false);
  });
  it('rejects duplicate exact raw rows and oversized captured strings', async () => {
    let duplicated = true;
    const socket: any = {
      dispatch: () =>
        Promise.resolve(
          duplicated
            ? { results: [raw(), raw()] }
            : raw({ ...progress, undoneBy: 'x'.repeat(101) }),
        ),
    };
    observer = observeNativeAuditProgress(target, socket);
    await expect(observer.read()).rejects.toThrow('Ambiguous');
    duplicated = false;
    await expect(observer.read()).rejects.toThrow('bound exceeded');
    expect(observer.snapshot().failed).toBe(true);
  });
  it('drains tracked auto reads without changing the original call promise', async () => {
    let release!: (value: any) => void;
    const late = new Promise((done) => {
      release = done;
    });
    const update = Promise.resolve(raw());
    const socket: any = {
      dispatch: (_event: any, req: any) => (req.action === 'get' ? late : update),
    };
    observer = observeNativeAuditProgress(target, socket);
    expect(socket.dispatch('modifyDocument', request)).toBe(update);
    await update;
    expect(observer.snapshot().pending).toBe(1);
    let drained = false;
    const drain = observer.drain().then(() => {
      drained = true;
    });
    await tick();
    expect(drained).toBe(false);
    release(raw());
    await drain;
    expect(observer.snapshot().pending).toBe(0);
  });
  it('latches a later missing exact update row even after earlier observed progress', async () => {
    let missing = false;
    const socket: any = {
      dispatch: (_event: any, req: any) =>
        Promise.resolve(req.action === 'update' && missing ? raw(progress, 'other') : raw()),
    };
    observer = observeNativeAuditProgress(target, socket);
    await socket.dispatch('modifyDocument', request);
    await observer.drain();
    await observer.read();
    expect(observer.complete()).toBe(true);
    missing = true;
    await socket.dispatch('modifyDocument', request);
    await observer.drain();
    await observer.read();
    expect(observer.snapshot().observed).toBe(true);
    expect(observer.snapshot().failed).toBe(true);
    expect(observer.complete()).toBe(false);
  });
});
