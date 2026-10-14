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
  g.ui = { notifications: { error: vi.fn() } };
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
