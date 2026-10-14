/* eslint-disable @typescript-eslint/no-explicit-any */
import { PROTOCOL_VERSION, HelloMessage } from '@agent-gateway/protocol';
import { afterEach, expect, it, vi } from 'vitest';
import { installFoundry, type FoundryStub } from '../stubs/foundry.js';

let stub: FoundryStub;
afterEach(() => {
  stub?.uninstall();
  vi.unstubAllGlobals();
});

async function identityFor(name: string): Promise<any> {
  vi.resetModules();
  stub = installFoundry(14);
  const g = globalThis as any;
  g.game.user = { id: 'u1', name, role: 1, isGM: false };
  g.game.world = { id: 'w1', title: 'W' };
  g.game.settings.get = () => '';
  g.ui = { notifications: { error: vi.fn() } };
  let captured: any;
  vi.doMock('../../src/link/client.js', () => ({
    LinkClient: class {
      constructor(deps: any) {
        captured = deps;
      }
    },
  }));
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
  getLinkClient();
  vi.doUnmock('../../src/link/client.js');
  vi.doUnmock('../../src/link/toolset.js');
  vi.doUnmock('../../src/events/offline-setting.js');
  return captured.getIdentity();
}

it('trims a user name over 100 characters to 100', async () => {
  const id = await identityFor('n'.repeat(250));
  expect(id.user.name).toBe('n'.repeat(100));
});

it('leaves a name of 100 characters or fewer alone', async () => {
  expect((await identityFor('n'.repeat(100))).user.name).toBe('n'.repeat(100));
  expect((await identityFor('Alice')).user.name).toBe('Alice');
});

it('a 150-character name, trimmed, makes a hello that parses under the capped HelloMessage', async () => {
  const id = await identityFor('n'.repeat(150));
  const frame = {
    type: 'hello',
    protocolVersion: PROTOCOL_VERSION,
    ...id,
    auth: { kind: 'pairingCode', code: 'AAAA-AAAA-AAAA' },
  };
  expect(HelloMessage.safeParse(frame).success).toBe(true);
  expect(
    HelloMessage.safeParse({ ...frame, user: { ...id.user, name: 'n'.repeat(150) } }).success,
  ).toBe(false);
});
