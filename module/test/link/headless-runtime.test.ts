/* eslint-disable @typescript-eslint/no-explicit-any */
import { PROTOCOL_VERSION } from '@agent-gateway/protocol';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { HEADLESS_FLAG_KEY } from '../../src/link/bridge.js';
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

let stub: FoundryStub;
let ss: Map<string, string>;

beforeEach(() => {
  vi.useFakeTimers();
  FakeWs.all = [];
  ss = new Map();
  const ls = new Map<string, string>();
  ls.set(
    CREDENTIAL_STORAGE_KEY,
    JSON.stringify({
      [credentialKey({ url: 'ws://gw-x.example/', worldId: 'w1', userId: 'u1' })]: {
        token: 'SECRET-TOKEN',
        at: 1,
      },
    }),
  );
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => ls.get(k) ?? null,
    setItem: (k: string, v: string) => void ls.set(k, v),
    removeItem: (k: string) => void ls.delete(k),
  });
  vi.stubGlobal('sessionStorage', {
    getItem: (k: string) => ss.get(k) ?? null,
    setItem: (k: string, v: string) => void ss.set(k, v),
  });
  vi.stubGlobal('WebSocket', FakeWs);
});
afterEach(() => {
  stub?.uninstall();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function boot(headless: boolean) {
  if (headless) ss.set(HEADLESS_FLAG_KEY, '1');
  vi.resetModules();
  stub = installFoundry(14);
  const g = globalThis as any;
  g.game.user = { id: 'u1', name: 'U', role: 1, isGM: false };
  g.game.world = { id: 'w1', title: 'W' };
  g.game.settings.get = (_ns: string, k: string) => (k === 'gatewayUrl' ? 'ws://gw-x.example/' : '');
  g.game.settings.set = async () => undefined;
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
  const rt = await import('../../src/link/runtime.js');
  return { rt, client: rt.getLinkClient() };
}

it('sends hello.headless from runtime.ts when the flag is set', async () => {
  const { client } = await boot(true);
  client.start();
  FakeWs.all[0]!.onopen();
  expect(FakeWs.all[0]!.sent[0].headless).toBe(true);
});

it('sends no hello.headless without the flag', async () => {
  const { client } = await boot(false);
  client.start();
  FakeWs.all[0]!.onopen();
  expect('headless' in FakeWs.all[0]!.sent[0]).toBe(false);
});

it('mirrors the link state into session storage when headless, with no secret', async () => {
  const { rt, client } = await boot(true);
  client.start();
  const ws = FakeWs.all[0]!;
  ws.onopen();
  expect(ss.get(rt.HEADLESS_LINK_KEY)).toBe('connecting');
  ws.recv({
    type: 'welcome',
    gatewayVersion: '0',
    protocolVersion: PROTOCOL_VERSION,
    connectionId: 'c1',
    agentId: 'a1',
    pairingToken: 'SECRET-TOKEN',
  });
  await vi.advanceTimersByTimeAsync(0);
  expect(ss.get(rt.HEADLESS_LINK_KEY)).toBe('connected');
  ws.onclose?.({ code: 1000, reason: 'replaced' });
  await vi.advanceTimersByTimeAsync(0);
  expect(ss.get(rt.HEADLESS_LINK_KEY)).toBe('replaced');
  expect([...ss.values()].join(' ')).not.toContain('SECRET');
});

it('writes nothing without the flag', async () => {
  const { rt, client } = await boot(false);
  client.start();
  FakeWs.all[0]!.onopen();
  expect(ss.has(rt.HEADLESS_LINK_KEY)).toBe(false);
  expect(ss.size).toBe(0);
});
