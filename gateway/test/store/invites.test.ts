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
