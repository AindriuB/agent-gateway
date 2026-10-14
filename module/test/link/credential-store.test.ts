import { expect, it } from 'vitest';
import {
  CREDENTIAL_STORAGE_KEY,
  MAX_CREDENTIALS,
  createCredentialStore,
  memoryStorage,
} from '../../src/link/credential-store.js';

const owner = (userId: string, url = 'ws://gw') => ({ url, worldId: 'w', userId });

it('round-trips and keys by gateway, world and user', () => {
  const s = createCredentialStore(memoryStorage());
  s.set(owner('a'), 'ta');
  s.set(owner('b'), 'tb');
  s.set({ url: 'ws://gw', worldId: 'w2', userId: 'a' }, 'tw');
  expect(s.get(owner('a'))).toBe('ta');
  expect(s.get(owner('b'))).toBe('tb');
  expect(s.get(owner('a', 'ws://other'))).toBeNull();
  expect(s.get(owner('c'))).toBeNull();
  expect(s.get(owner('a', 'ws://gw/'))).toBe('ta');
});

it.each([['not json'], ['[]'], ['"x"'], ['{"k":1}'], ['{"k":{"token":"","at":1}}'], ['null']])(
  'treats %s as empty and never throws',
  (raw) => {
    const st = memoryStorage();
    st.setItem(CREDENTIAL_STORAGE_KEY, raw);
    const s = createCredentialStore(st);
    expect(s.get(owner('a'))).toBeNull();
    expect(s.size()).toBe(0);
    s.set(owner('a'), 't');
    expect(s.get(owner('a'))).toBe('t');
  },
);

it('survives storage that throws', () => {
  const s = createCredentialStore({
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('full');
    },
  });
  expect(s.get(owner('a'))).toBeNull();
  expect(() => s.set(owner('a'), 't')).not.toThrow();
});

it('evicts the oldest entry beyond the cap, and touch refreshes', () => {
  let t = 0;
  const s = createCredentialStore(memoryStorage(), () => ++t);
  for (let i = 0; i < MAX_CREDENTIALS; i++) s.set(owner(`u${i}`), `t${i}`);
  s.touch(owner('u0'));
  s.set(owner('new'), 'tn');
  expect(s.size()).toBe(MAX_CREDENTIALS);
  expect(s.get(owner('u1'))).toBeNull();
  expect(s.get(owner('u0'))).toBe('t0');
  expect(s.get(owner('new'))).toBe('tn');
});

it('eviction without touch drops the first-written key', () => {
  let t = 0;
  const s = createCredentialStore(memoryStorage(), () => ++t);
  for (let i = 0; i <= MAX_CREDENTIALS; i++) s.set(owner(`u${i}`), `t${i}`);
  expect(s.size()).toBe(MAX_CREDENTIALS);
  expect(s.get(owner('u0'))).toBeNull();
});

it('set reports persistence: true on localStorage-like, false on quota failure or memory fallback', () => {
  const ok = createCredentialStore({ getItem: () => null, setItem: () => {} });
  expect(ok.set(owner('a'), 't')).toBe(true);
  const full = createCredentialStore({
    getItem: () => null,
    setItem: () => {
      throw new Error('QuotaExceededError');
    },
  });
  expect(full.set(owner('a'), 't')).toBe(false);
  expect(createCredentialStore(memoryStorage()).set(owner('a'), 't')).toBe(false);
});
