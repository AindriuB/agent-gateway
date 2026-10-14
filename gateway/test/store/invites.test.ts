import { afterEach, describe, expect, it } from 'vitest';
import { openStore, type Store } from '../../src/store/index.js';

let store: Store | undefined;
afterEach(() => {
  store?.close();
  store = undefined;
});

const mk = (s: Store, id: string, user = 'u1', hash = `h-${id}`) =>
  s.invites.create({
    id,
    codeHash: hash,
    worldId: 'w1',
    userId: user,
    origin: null,
    expiresAt: 5_000,
  });

describe('invite repository', () => {
  it('stores, finds by hash and lists in creation order', () => {
    store = openStore(':memory:', () => 1000);
    const row = mk(store, 'i1');
    expect(row).toMatchObject({
      id: 'i1',
      codeHash: 'h-i1',
      worldId: 'w1',
      userId: 'u1',
      origin: null,
      createdAt: 1000,
      expiresAt: 5000,
      usedAt: null,
      cancelledAt: null,
      result: null,
      pairingId: null,
    });
    mk(store, 'i2');
    expect(store.invites.findByHash('h-i1')?.id).toBe('i1');
    expect(store.invites.findByHash('nope')).toBeUndefined();
    expect(store.invites.list().map((i) => i.id)).toEqual(['i1', 'i2']);
  });

  it('refuses a duplicate code hash', () => {
    store = openStore(':memory:');
    mk(store, 'i1', 'u1', 'same');
    expect(() => mk(store!, 'i2', 'u1', 'same')).toThrow();
  });

  it('settle spends the invite with its result', () => {
    store = openStore(':memory:', () => 2000);
    mk(store, 'i1');
    store.invites.settle('i1', 'paired', 'p1');
    expect(store.invites.findByHash('h-i1')).toMatchObject({
      usedAt: 2000,
      result: 'paired',
      pairingId: 'p1',
    });
  });

  it('cancelFor cancels only unused invites for the target', () => {
    store = openStore(':memory:', () => 3000);
    mk(store, 'i1');
    mk(store, 'i2');
    mk(store, 'i3');
    mk(store, 'i4', 'u2');
    store.invites.settle('i2', 'mismatch', null);
    expect(store.invites.cancelFor('w1', 'u1')).toBe(2);
    expect(store.invites.cancelFor('w1', 'u1')).toBe(0);
    const byId = Object.fromEntries(store.invites.list().map((i) => [i.id, i]));
    expect(byId.i1).toMatchObject({ cancelledAt: 3000, result: 'cancelled' });
    expect(byId.i2).toMatchObject({ cancelledAt: null, result: 'mismatch' });
    expect(byId.i4).toMatchObject({ cancelledAt: null, result: null });
  });
});

describe('world-scoped invite queries', () => {
  const mkIn = (s: Store, id: string, worldId: string, expiresAt = 5_000) =>
    s.invites.create({ id, codeHash: `h-${id}`, worldId, userId: 'u1', origin: null, expiresAt });

  it('listForWorld returns only that world, newest first, up to the limit', () => {
    let t = 1000;
    store = openStore(':memory:', () => t++);
    mkIn(store, 'a1', 'wA');
    mkIn(store, 'b1', 'wB');
    mkIn(store, 'a2', 'wA');
    mkIn(store, 'a3', 'wA');
    expect(store.invites.listForWorld('wA', 10, 0).map((i) => i.id)).toEqual(['a3', 'a2', 'a1']);
    expect(store.invites.listForWorld('wA', 2, 10_000)).toHaveLength(2);
    expect(store.invites.listForWorld('wB', 10, 0).map((i) => i.id)).toEqual(['b1']);
  });

  it('countUnusedForWorld skips used, cancelled, expired and other-world rows', () => {
    store = openStore(':memory:', () => 1000);
    mkIn(store, 'u', 'wA');
    mkIn(store, 'used', 'wA');
    mkIn(store, 'canc', 'wA');
    mkIn(store, 'old', 'wA', 1500);
    mkIn(store, 'other', 'wB');
    store.invites.settle('used', 'paired', null);
    expect(store.invites.cancelInWorld('wA', 'canc')).toBe(true);
    expect(store.invites.countUnusedForWorld('wA', 2000)).toBe(1);
    expect(store.invites.countUnusedForWorld('wB', 2000)).toBe(1);
  });

  it('cancelInWorld cancels one unused invite and refuses another world, used or unknown ids', () => {
    store = openStore(':memory:', () => 1000);
    mkIn(store, 'a1', 'wA');
    mkIn(store, 'a2', 'wA');
    expect(store.invites.cancelInWorld('wB', 'a1')).toBe(false);
    expect(store.invites.getById('a1')?.cancelledAt).toBeNull();
    expect(store.invites.cancelInWorld('wA', 'nope')).toBe(false);
    expect(store.invites.cancelInWorld('wA', 'a1')).toBe(true);
    expect(store.invites.getById('a1')).toMatchObject({ result: 'cancelled' });
    expect(store.invites.cancelInWorld('wA', 'a1')).toBe(false);
    expect(store.invites.getById('a2')?.cancelledAt).toBeNull();
  });
});

describe('invite pruning', () => {
  const DAY = 86_400_000;
  it('deletes old settled, cancelled and expired rows and never unused unexpired ones', () => {
    let t = 1000;
    store = openStore(':memory:', () => t);
    const mkAt = (id: string, expiresAt: number) =>
      store!.invites.create({
        id,
        codeHash: `h-${id}`,
        worldId: 'w1',
        userId: id,
        origin: null,
        expiresAt,
      });
    mkAt('paired', 50 * DAY);
    mkAt('cancelled', 50 * DAY);
    mkAt('expired', 2000);
    mkAt('open', 100 * DAY);
    t = 5 * DAY;
    mkAt('young-paired', 50 * DAY);
    store.invites.settle('paired', 'paired', null);
    store.invites.cancelInWorld('w1', 'cancelled');
    store.invites.settle('young-paired', 'paired', null);
    const now = 34 * DAY;
    expect(store.invites.pruneBefore(now - 30 * DAY, now)).toBe(3);
    expect(
      store.invites
        .list()
        .map((i) => i.id)
        .sort(),
    ).toEqual(['open', 'young-paired']);
  });
});
