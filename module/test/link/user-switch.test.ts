/* eslint-disable @typescript-eslint/no-explicit-any */
import { PROTOCOL_VERSION } from '@agent-gateway/protocol';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LinkClient, type SocketLike } from '../../src/link/client.js';
import {
  MAX_CREDENTIALS,
  createCredentialStore,
  memoryStorage,
  CREDENTIAL_STORAGE_KEY,
  type StorageLike,
} from '../../src/link/credential-store.js';

class FakeSocket implements SocketLike {
  onopen: SocketLike['onopen'] = null;
  onmessage: SocketLike['onmessage'] = null;
  onclose: SocketLike['onclose'] = null;
  onerror: SocketLike['onerror'] = null;
  sent: any[] = [];
  send(d: string) {
    this.sent.push(JSON.parse(d));
  }
  close() {}
  recv(m: object) {
    this.onmessage?.({ data: JSON.stringify(m) });
  }
}

const URL_ = 'ws://gw';
const welcome = (extra: object = {}) => ({
  type: 'welcome',
  gatewayVersion: '0.1.0',
  protocolVersion: PROTOCOL_VERSION,
  connectionId: 'c1',
  agentId: 'a1',
  ...extra,
});

let storage: StorageLike;
let legacy: string;
let sockets: FakeSocket[];
let logs: string[];
let errors: string[];

beforeEach(() => {
  vi.useFakeTimers();
  storage = memoryStorage();
  legacy = '';
  sockets = [];
  logs = [];
  errors = [];
  for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const)
    vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void logs.push(a.join(' ')));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const owner = (userId: string) => ({ url: URL_, worldId: 'w', userId });
const seed = (userId: string, token: string) =>
  createCredentialStore(storage).set(owner(userId), token);
const read = () => storage.getItem(CREDENTIAL_STORAGE_KEY);

/** A client for one Foundry user, sharing the browser storage with every other. */
function clientFor(userId: string): LinkClient {
  const store = createCredentialStore(storage);
  return new LinkClient({
    getGatewayUrl: () => URL_,
    getToken: () => {
      const token = store.get(owner(userId));
      return token ? { url: URL_, token } : null;
    },
    setToken: (c, o) => {
      const own = { url: URL_, worldId: o?.worldId ?? 'w', userId: o?.userId ?? userId };
      if (c) store.set(own, c.token);
      else store.remove(own);
    },
    touchToken: (o) =>
      store.touch({ url: URL_, worldId: o?.worldId ?? 'w', userId: o?.userId ?? userId }),
    hasUserToken: () => store.hasUser('w', userId),
    hasOtherTokens: () => store.size() > 0,
    getLegacyToken: () => legacy,
    clearLegacyToken: () => {
      legacy = '';
    },
    getIdentity: () => ({
      moduleVersion: '0.1.0',
      foundryVersion: '14.0',
      world: { id: 'w', title: 'W', system: 'x', systemVersion: '1' },
      user: { id: userId, name: userId, role: 1, isGM: false },
    }),
    createSocket: () => {
      const s = new FakeSocket();
      sockets.push(s);
      return s;
    },
    notifyError: (m) => errors.push(m),
    random: () => 0,
  });
}

const flush = () => vi.advanceTimersByTimeAsync(0);

it('user B with no entry sends no token hello and leaves A untouched', () => {
  seed('A', 'tokA');
  const before = read();
  const b = clientFor('B');
  b.start();
  expect(sockets).toHaveLength(0);
  expect(b.state).toEqual({ kind: 'disconnected', reason: 'PAIRING_REQUIRED' });
  expect(read()).toBe(before);
});

it('switching back to A sends A token', () => {
  seed('A', 'tokA');
  clientFor('B').start();
  const a = clientFor('A');
  a.start();
  sockets[0]!.onopen?.();
  expect(sockets[0]!.sent[0].auth).toEqual({ kind: 'pairingToken', token: 'tokA' });
});

it.each(['reject', 'close'])('B rejection (%s) removes only B', async (how) => {
  seed('A', 'tokA');
  seed('B', 'tokB');
  const b = clientFor('B');
  b.start();
  sockets[0]!.onopen?.();
  expect(sockets[0]!.sent[0].auth.token).toBe('tokB');
  if (how === 'reject')
    sockets[0]!.recv({ type: 'reject', code: 'PAIRING_INVALID', message: 'no' });
  else sockets[0]!.onclose?.({ code: 1008, reason: 'PAIRING_INVALID' });
  await flush();
  expect(b.state).toEqual({ kind: 'disconnected', reason: 'TOKEN_REJECTED' });
  const s = createCredentialStore(storage);
  expect(s.get(owner('B'))).toBeNull();
  expect(s.get(owner('A'))).toBe('tokA');
});

it('a rejected code removes no entry and falls back to the token', async () => {
  seed('B', 'tokB');
  const b = clientFor('B');
  b.pair('CODE');
  sockets[0]!.onopen?.();
  sockets[0]!.recv({ type: 'reject', code: 'PAIRING_INVALID', message: 'no' });
  await flush();
  expect(createCredentialStore(storage).get(owner('B'))).toBe('tokB');
  expect(sockets).toHaveLength(2);
});

it('a code welcome stores under the sender only', async () => {
  seed('A', 'tokA');
  const b = clientFor('B');
  b.pair('CODE');
  sockets[0]!.onopen?.();
  sockets[0]!.recv(welcome({ pairingToken: 'newB' }));
  await flush();
  const s = createCredentialStore(storage);
  expect(s.get(owner('B'))).toBe('newB');
  expect(s.get(owner('A'))).toBe('tokA');
});

const setLegacy = () => {
  legacy = JSON.stringify({ url: URL_, token: 'legTok' });
};

it('legacy credential is presented, then moved to the keyed entry when accepted', async () => {
  seed('A', 'tokA');
  setLegacy();
  const b = clientFor('B');
  b.start();
  sockets[0]!.onopen?.();
  expect(sockets[0]!.sent[0].auth).toEqual({ kind: 'pairingToken', token: 'legTok' });
  sockets[0]!.recv(welcome());
  await flush();
  const s = createCredentialStore(storage);
  expect(s.get(owner('B'))).toBe('legTok');
  expect(s.get(owner('A'))).toBe('tokA');
  expect(legacy).toBe('');
  expect(b.state.kind).toBe('connected');
});

it('a rejected legacy credential is cleared and creates or removes no keyed entry', async () => {
  seed('A', 'tokA');
  setLegacy();
  const before = read();
  const b = clientFor('B');
  b.start();
  sockets[0]!.onopen?.();
  sockets[0]!.recv({ type: 'reject', code: 'PAIRING_INVALID', message: 'no' });
  await flush();
  expect(legacy).toBe('');
  expect(read()).toBe(before);
  expect(b.state).toEqual({ kind: 'disconnected', reason: 'TOKEN_REJECTED' });
});

it('legacy for another gateway is ignored', () => {
  legacy = JSON.stringify({ url: 'ws://elsewhere', token: 'legTok' });
  const b = clientFor('B');
  b.start();
  expect(sockets).toHaveLength(0);
  expect(legacy).not.toBe('');
});

it('an accepted token welcome refreshes the timestamp so it survives eviction', async () => {
  let t = 0;
  const store = createCredentialStore(storage, () => ++t);
  store.set(owner('keep'), 'k');
  for (let i = 0; i < MAX_CREDENTIALS - 1; i++) store.set(owner(`u${i}`), 'x');
  const c = new LinkClient({
    getGatewayUrl: () => URL_,
    getToken: () => ({ url: URL_, token: store.get(owner('keep')) }),
    setToken: () => {},
    touchToken: () => store.touch(owner('keep')),
    getIdentity: () => ({
      moduleVersion: '0.1.0',
      foundryVersion: '14.0',
      world: { id: 'w', title: 'W', system: 'x', systemVersion: '1' },
      user: { id: 'keep', name: 'k', role: 1, isGM: false },
    }),
    createSocket: () => {
      const s = new FakeSocket();
      sockets.push(s);
      return s;
    },
    notifyError: () => {},
  });
  c.start();
  sockets[0]!.onopen?.();
  sockets[0]!.recv(welcome());
  await flush();
  store.set(owner('new'), 'n');
  expect(store.get(owner('keep'))).toBe('k');
  expect(store.get(owner('u0'))).toBeNull();
});

it('unpair removes only the current entry', async () => {
  seed('A', 'tokA');
  seed('B', 'tokB');
  const b = clientFor('B');
  await b.unpair();
  const s = createCredentialStore(storage);
  expect(s.get(owner('B'))).toBeNull();
  expect(s.get(owner('A'))).toBe('tokA');
  expect(b.state).toEqual({ kind: 'disconnected', reason: 'PAIRING_REQUIRED' });
});

it('no token reaches the console or notifications through switch, rejection and migration', async () => {
  seed('A', 'SECRET-A');
  seed('B', 'SECRET-B');
  setLegacy();
  clientFor('C').start();
  sockets[0]!.onopen?.();
  sockets[0]!.recv({ type: 'reject', code: 'PAIRING_INVALID', message: 'no' });
  clientFor('B').start();
  sockets.at(-1)!.onopen?.();
  sockets.at(-1)!.recv({ type: 'reject', code: 'PAIRING_INVALID', message: 'no' });
  await flush();
  const all = [...logs, ...errors].join('\n');
  for (const t of ['SECRET-A', 'SECRET-B', 'legTok']) expect(all).not.toContain(t);
});

it('a revocation after a legacy migration removes the migrated keyed entry', async () => {
  setLegacy();
  const b = clientFor('B');
  b.start();
  sockets[0]!.onopen?.();
  sockets[0]!.recv(welcome());
  await flush();
  expect(createCredentialStore(storage).get(owner('B'))).toBe('legTok');
  sockets[0]!.recv({ type: 'reject', code: 'PAIRING_INVALID', message: 'no' });
  await flush();
  expect(createCredentialStore(storage).get(owner('B'))).toBeNull();
  expect(b.state).toEqual({ kind: 'disconnected', reason: 'TOKEN_REJECTED' });
});

it('stop during the legacy migration writes does not report connected', async () => {
  setLegacy();
  const b = clientFor('B');
  b.start();
  sockets[0]!.onopen?.();
  sockets[0]!.recv(welcome());
  b.stop();
  await flush();
  expect(b.state.kind).not.toBe('connected');
});

it('hasStoredToken is true for the user entry under any gateway, and false for another user', () => {
  createCredentialStore(storage).set({ url: 'ws://other', worldId: 'w', userId: 'A' }, 'tokA');
  expect(clientFor('A').hasStoredToken()).toBe(true);
  expect(clientFor('B').hasStoredToken()).toBe(false);
});

it('an entry only under an old gateway is not a current-gateway token, and unpair never leaves the current entry', async () => {
  createCredentialStore(storage).set({ url: 'ws://old', worldId: 'w', userId: 'A' }, 'tokOld');
  const a = clientFor('A');
  expect(a.hasStoredToken()).toBe(true);
  expect(a.hasCurrentGatewayToken()).toBe(false);
  seed('A', 'tokNow');
  expect(a.hasCurrentGatewayToken()).toBe(true);
  await a.unpair();
  expect(a.hasCurrentGatewayToken()).toBe(false);
});
