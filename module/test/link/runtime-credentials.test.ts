/* eslint-disable @typescript-eslint/no-explicit-any */
import { PROTOCOL_VERSION } from '@agent-gateway/protocol';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CREDENTIAL_STORAGE_KEY, credentialKey } from '../../src/link/credential-store.js';
import { installFoundry, type FoundryStub } from '../stubs/foundry.js';

class FakeWs {
  static all: FakeWs[] = [];
  onopen: any = null;
  onmessage: any = null;
  onclose: any = null;
  onerror: any = null;
  sent: any[] = [];
  constructor(public url: string) {
    FakeWs.all.push(this);
  }
  send(d: string) {
    this.sent.push(JSON.parse(d));
  }
  close() {}
  recv(m: object) {
    this.onmessage?.({ data: JSON.stringify(m) });
  }
}

const X = 'ws://gw-x.example/';
const Y = 'ws://gw-y.example/';
let stub: FoundryStub;
let settings: Record<string, string>;
let ls: Map<string, string>;
let failWrites: boolean;

beforeEach(() => {
  vi.useFakeTimers();
  FakeWs.all = [];
  failWrites = false;
  ls = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => ls.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (failWrites) throw new Error('QuotaExceededError');
      ls.set(k, v);
    },
  });
  vi.stubGlobal('WebSocket', FakeWs);
});
afterEach(() => {
  stub?.uninstall();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function boot() {
  vi.resetModules();
  stub = installFoundry(14);
  const g = globalThis as any;
  g.game.user = { id: 'u1', name: 'U', role: 1, isGM: false };
  g.game.world = { id: 'w1', title: 'W' };
  g.game.settings.get = (_ns: string, k: string) => settings[k] ?? '';
  g.game.settings.set = async (_ns: string, k: string, v: string) => void (settings[k] = v);
  g.ui = { notifications: { error: vi.fn(), warn: vi.fn() } };
  g.game.i18n = { localize: (k: string) => `L:${k}` };
  vi.doMock('../../src/link/toolset.js', () => ({
    installToolsetAnnouncer: () => ({}),
    policyDenies: () => () => false,
    policyAllowsEventReads: () => () => false,
  }));
  vi.doMock('../../src/events/offline-setting.js', () => ({
    installOfflineEventPolicy: () => () => undefined,
    onOfflineEventSettingChange: () => undefined,
  }));
  const { getLinkClient } = await import('../../src/link/runtime.js');
  return getLinkClient();
}

const key = (url: string) => credentialKey({ url, worldId: 'w1', userId: 'u1' });
const stored = () => JSON.parse(ls.get(CREDENTIAL_STORAGE_KEY) ?? '{}');
const seedMap = (urls: string[]) =>
  ls.set(
    CREDENTIAL_STORAGE_KEY,
    JSON.stringify(Object.fromEntries(urls.map((u) => [key(u), { token: `tok-${u}`, at: 1 }]))),
  );
const welcome = () => ({
  type: 'welcome',
  gatewayVersion: '0.1.0',
  protocolVersion: PROTOCOL_VERSION,
  connectionId: 'c1',
  agentId: 'a1',
});

it('PAIRING_INVALID from X after the setting changes to Y clears X, not Y', async () => {
  settings = { gatewayUrl: X };
  seedMap([X, Y]);
  const c = await boot();
  c.start();
  const ws = FakeWs.all[0]!;
  ws.onopen();
  expect(ws.sent[0].auth.token).toBe(`tok-${X}`);
  settings.gatewayUrl = Y;
  ws.recv({ type: 'reject', code: 'PAIRING_INVALID', message: 'no' });
  await vi.advanceTimersByTimeAsync(0);
  expect(Object.keys(stored()).sort()).toEqual([key(Y)]);
});

it('an accepted welcome after the setting changes touches X, not Y', async () => {
  settings = { gatewayUrl: X };
  seedMap([X, Y]);
  const c = await boot();
  c.start();
  const ws = FakeWs.all[0]!;
  ws.onopen();
  settings.gatewayUrl = Y;
  ws.recv(welcome());
  await vi.advanceTimersByTimeAsync(0);
  expect(stored()[key(Y)].at).toBe(1);
  expect(stored()[key(X)].at).toBeGreaterThan(1);
});

it('keeps the legacy credential and stays connected when localStorage rejects the write', async () => {
  settings = { gatewayUrl: X, pairingCredential: JSON.stringify({ url: X, token: 'legTok' }) };
  failWrites = true;
  const c = await boot();
  c.start();
  const ws = FakeWs.all[0]!;
  ws.onopen();
  expect(ws.sent[0].auth.token).toBe('legTok');
  ws.recv(welcome());
  await vi.advanceTimersByTimeAsync(0);
  expect(JSON.parse(settings.pairingCredential!).token).toBe('legTok');
  expect(c.state.kind).toBe('connected');
});

it('clears the legacy credential once the keyed write persisted', async () => {
  settings = { gatewayUrl: X, pairingCredential: JSON.stringify({ url: X, token: 'legTok' }) };
  const c = await boot();
  c.start();
  const ws = FakeWs.all[0]!;
  ws.onopen();
  ws.recv(welcome());
  await vi.advanceTimersByTimeAsync(0);
  expect(settings.pairingCredential).toBe('');
  expect(stored()[key(X)].token).toBe('legTok');
});

it('revoking a legacy credential whose migration write failed clears the legacy setting', async () => {
  settings = { gatewayUrl: X, pairingCredential: JSON.stringify({ url: X, token: 'legTok' }) };
  failWrites = true;
  const c = await boot();
  c.start();
  const ws = FakeWs.all[0]!;
  ws.onopen();
  ws.recv(welcome());
  await vi.advanceTimersByTimeAsync(0);
  ws.recv({ type: 'reject', code: 'PAIRING_INVALID', message: 'no' });
  await vi.advanceTimersByTimeAsync(0);
  expect(settings.pairingCredential).toBe('');
});

it('keeps a code-issued token in memory when storage is full, and warns once without it', async () => {
  settings = { gatewayUrl: X };
  failWrites = true;
  const c = await boot();
  c.pair('CODE-1');
  const ws = FakeWs.all[0]!;
  ws.onopen();
  ws.recv({ ...welcome(), pairingToken: 'newTok' });
  await vi.advanceTimersByTimeAsync(0);
  expect(c.state.kind).toBe('connected');
  ws.onclose({ code: 1006 });
  await vi.advanceTimersByTimeAsync(60_000);
  expect(c.state).not.toEqual({ kind: 'disconnected', reason: 'PAIRING_REQUIRED' });
  const ws2 = FakeWs.all[1]!;
  expect(ws2).toBeDefined();
  ws2.onopen();
  expect(ws2.sent[0].auth).toEqual({ kind: 'pairingToken', token: 'newTok' });
  ws2.recv(welcome());
  await vi.advanceTimersByTimeAsync(0);
  const warn = (globalThis as any).ui.notifications.warn;
  expect(warn).toHaveBeenCalledTimes(1);
  c.pair('CODE-2');
  const ws3 = FakeWs.all[FakeWs.all.length - 1]!;
  ws3.onopen();
  ws3.recv({ ...welcome(), pairingToken: 'newTok2' });
  await vi.advanceTimersByTimeAsync(0);
  expect(warn).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(warn.mock.calls)).not.toContain('newTok');
  expect(warn.mock.calls[0][0]).toBe('L:AGENT_GATEWAY.Link.storageFull');
});

async function pairWithFullStorage(token = 'newTok') {
  settings = { gatewayUrl: X };
  failWrites = true;
  const c = await boot();
  c.pair('CODE-1');
  const ws = FakeWs.all[0]!;
  ws.onopen();
  ws.recv({ ...welcome(), pairingToken: token });
  await vi.advanceTimersByTimeAsync(0);
  expect(c.state.kind).toBe('connected');
  return c;
}

it('a rejected code falls back to the in-memory session token', async () => {
  const c = await pairWithFullStorage();
  c.pair('BAD');
  const bad = FakeWs.all[FakeWs.all.length - 1]!;
  bad.onopen();
  bad.recv({ type: 'reject', code: 'PAIRING_INVALID', message: 'no' });
  await vi.advanceTimersByTimeAsync(60_000);
  expect(c.state.kind).not.toBe('disconnected');
  const last = FakeWs.all[FakeWs.all.length - 1]!;
  expect(last).not.toBe(bad);
  last.onopen();
  expect(last.sent[0].auth).toEqual({ kind: 'pairingToken', token: 'newTok' });
});

it('stop() then resume() reconnects with the session token', async () => {
  const c = await pairWithFullStorage();
  c.stop();
  const n = FakeWs.all.length;
  c.resume();
  expect(FakeWs.all.length).toBe(n + 1);
  const ws = FakeWs.all[n]!;
  ws.onopen();
  expect(ws.sent[0].auth).toEqual({ kind: 'pairingToken', token: 'newTok' });
});

it('sends nothing to a different gateway URL than the session token was issued for', async () => {
  const c = await pairWithFullStorage();
  c.stop();
  settings.gatewayUrl = Y;
  const n = FakeWs.all.length;
  c.resume();
  expect(FakeWs.all.length).toBe(n);
  expect(c.hasCurrentGatewayToken()).toBe(false);
  expect(JSON.stringify(FakeWs.all.slice(n).map((w) => w.sent))).not.toContain('newTok');
});

it.each([
  ['user', () => ((globalThis as any).game.user = { id: 'u2', name: 'V', role: 1, isGM: false })],
  ['world', () => ((globalThis as any).game.world = { id: 'w2', title: 'W2' })],
])('sends nothing when the %s differs from the session token owner', async (_n, change) => {
  const c = await pairWithFullStorage();
  c.stop();
  change();
  const n = FakeWs.all.length;
  c.resume();
  expect(FakeWs.all.length).toBe(n);
  expect(c.hasCurrentGatewayToken()).toBe(false);
});

it('unpair clears the session token', async () => {
  const c = await pairWithFullStorage();
  expect(c.hasCurrentGatewayToken()).toBe(true);
  await c.unpair();
  expect(c.hasCurrentGatewayToken()).toBe(false);
});

it('a rejected session token is cleared', async () => {
  const c = await pairWithFullStorage();
  c.stop();
  c.resume();
  const ws = FakeWs.all[FakeWs.all.length - 1]!;
  ws.onopen();
  ws.recv({ type: 'reject', code: 'PAIRING_INVALID', message: 'no' });
  await vi.advanceTimersByTimeAsync(0);
  expect(c.hasCurrentGatewayToken()).toBe(false);
  expect(c.state).toEqual({ kind: 'disconnected', reason: 'TOKEN_REJECTED' });
});

it('a successful later store clears the session token', async () => {
  const c = await pairWithFullStorage();
  expect(c.hasCurrentGatewayToken()).toBe(true);
  failWrites = false;
  c.pair('CODE-2');
  const ws = FakeWs.all[FakeWs.all.length - 1]!;
  ws.onopen();
  ws.recv({ ...welcome(), pairingToken: 'stored' });
  await vi.advanceTimersByTimeAsync(0);
  expect(stored()[key(X)].token).toBe('stored');
  // The stored credential now wins; wipe it so only a stale session token could remain.
  ls.clear();
  expect(c.hasCurrentGatewayToken()).toBe(false);
});

async function repairWithStaleStored() {
  settings = { gatewayUrl: X };
  seedMap([X]); // an old, superseded token for the same key
  failWrites = true;
  const c = await boot();
  c.pair('CODE-1');
  const ws = FakeWs.all[0]!;
  ws.onopen();
  ws.recv({ ...welcome(), pairingToken: 'freshTok' });
  await vi.advanceTimersByTimeAsync(0);
  expect(c.state.kind).toBe('connected');
  return { c, ws };
}

it('re-pair with failing writes, drop and reconnect sends the new session token, not the stale one', async () => {
  const { c, ws } = await repairWithStaleStored();
  ws.onclose({ code: 1006 });
  await vi.advanceTimersByTimeAsync(60_000);
  const ws2 = FakeWs.all[FakeWs.all.length - 1]!;
  expect(ws2).not.toBe(ws);
  ws2.onopen();
  expect(ws2.sent[0].auth).toEqual({ kind: 'pairingToken', token: 'freshTok' });
  void c;
});

it('rejecting the session token clears only it, leaving the persisted entry', async () => {
  const { c } = await repairWithStaleStored();
  c.stop();
  c.resume();
  const ws = FakeWs.all[FakeWs.all.length - 1]!;
  ws.onopen();
  expect(ws.sent[0].auth.token).toBe('freshTok');
  failWrites = false; // so a wrongly attempted removal would really delete the entry
  ws.recv({ type: 'reject', code: 'PAIRING_INVALID', message: 'no' });
  await vi.advanceTimersByTimeAsync(0);
  expect(stored()[key(X)]).toBeDefined();
  expect(stored()[key(X)].token).toBe(`tok-${X}`);
  // Only the persisted entry remains, so it is what a later connect presents.
  c.resume();
  c.start();
  const w2 = FakeWs.all[FakeWs.all.length - 1]!;
  w2.onopen();
  expect(w2.sent[0].auth.token).toBe(`tok-${X}`);
  // Its rejection clears the persisted entry.
  w2.recv({ type: 'reject', code: 'PAIRING_INVALID', message: 'no' });
  await vi.advanceTimersByTimeAsync(0);
  expect(stored()[key(X)]).toBeUndefined();
  expect(c.state).toEqual({ kind: 'disconnected', reason: 'TOKEN_REJECTED' });
});

async function pairOnXThenRejectOnY() {
  const c = await boot();
  c.pair('CODE-1');
  const ws = FakeWs.all[0]!;
  ws.onopen();
  ws.recv({ ...welcome(), pairingToken: 'freshTok' });
  await vi.advanceTimersByTimeAsync(0);
  expect(c.state.kind).toBe('connected');
  c.stop();
  settings.gatewayUrl = Y;
  c.start();
  const wy = FakeWs.all[FakeWs.all.length - 1]!;
  wy.onopen();
  wy.recv({ type: 'reject', code: 'PAIRING_INVALID', message: 'no' });
  await vi.advanceTimersByTimeAsync(0);
  expect(c.state).toEqual({ kind: 'disconnected', reason: 'TOKEN_REJECTED' });
  return { c, wy };
}

function reconnectOnX(c: Awaited<ReturnType<typeof boot>>) {
  settings.gatewayUrl = X;
  c.start();
  const wx = FakeWs.all[FakeWs.all.length - 1]!;
  wx.onopen();
  expect(wx.sent[0].auth).toEqual({ kind: 'pairingToken', token: 'freshTok' });
}

it('a rejected keyed token for Y leaves the session token for X', async () => {
  settings = { gatewayUrl: X };
  seedMap([Y]);
  failWrites = true;
  const { c, wy } = await pairOnXThenRejectOnY();
  expect(wy.sent[0].auth.token).toBe(`tok-${Y}`);
  reconnectOnX(c);
});

it('a rejected legacy token for Y leaves the session token for X', async () => {
  settings = { gatewayUrl: X, pairingCredential: JSON.stringify({ url: Y, token: 'legTok' }) };
  failWrites = true;
  const { c, wy } = await pairOnXThenRejectOnY();
  expect(wy.sent[0].auth.token).toBe('legTok');
  reconnectOnX(c);
});

it("the user's own keyed token wins over the legacy credential, which is left alone", async () => {
  const legacy = JSON.stringify({ url: X, token: 'legTok' });
  settings = { gatewayUrl: X, pairingCredential: legacy };
  seedMap([X]);
  const c = await boot();
  c.start();
  const ws = FakeWs.all[0]!;
  ws.onopen();
  expect(ws.sent[0].auth.token).toBe(`tok-${X}`);
  expect(settings.pairingCredential).toBe(legacy);
});
