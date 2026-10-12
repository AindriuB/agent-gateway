/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  parseOfflineEventPolicy,
  readOfflineEventPolicy,
  registerOfflineEventSettings,
  saveOfflineEventPolicy,
  purgeOfflineEvents,
  installOfflineEventPolicy,
  onOfflineEventSettingChange,
} from '../../src/events/offline-setting.js';
let user: any, settings: any;
beforeEach(() => {
  user = { id: 'gm', isGM: true };
  settings = {
    get: vi.fn(() => ({ enabled: true, retentionDays: 7 })),
    set: vi.fn(async () => {}),
    register: vi.fn(),
  };
  (globalThis as any).game = { user, users: new Map([['gm', user]]), settings };
});
afterEach(() => {
  delete (globalThis as any).game;
});
it('fails invalid settings closed and registers a restricted world default', () => {
  for (const v of [
    null,
    {},
    true,
    { enabled: true, retentionDays: 0 },
    { enabled: true, retentionDays: 366 },
    { enabled: true, retentionDays: 1.5 },
    { enabled: true, retentionDays: 14, world: 'other' },
  ])
    expect(parseOfflineEventPolicy(v)).toEqual({ enabled: false, retentionDays: 14 });
  expect(readOfflineEventPolicy()).toEqual({ enabled: true, retentionDays: 7 });
  registerOfflineEventSettings();
  expect(settings.register).toHaveBeenCalledWith(
    'agent-gateway',
    'offlineEventReading',
    expect.objectContaining({
      scope: 'world',
      restricted: true,
      default: { enabled: false, retentionDays: 14 },
    }),
  );
});
it('publishes on each welcome and setting change with idempotent installation', () => {
  let listener: any;
  const client = {
    onState: vi.fn((fn) => {
      listener = fn;
    }),
    sendEventPolicy: vi.fn(),
  } as any;
  const refresh = installOfflineEventPolicy(client);
  expect(installOfflineEventPolicy(client)).toBe(refresh);
  onOfflineEventSettingChange(refresh);
  registerOfflineEventSettings();
  listener({ kind: 'disconnected' });
  expect(client.sendEventPolicy).not.toHaveBeenCalled();
  listener({ kind: 'connected' });
  expect(client.sendEventPolicy).toHaveBeenCalledWith({ enabled: true, retentionDays: 7 });
  settings.register.mock.calls[0][2].onChange();
  expect(client.sendEventPolicy).toHaveBeenCalledTimes(2);
});
it('requires canonical current GM and refuses demotion during awaited save', async () => {
  user.isGM = false;
  await expect(saveOfflineEventPolicy({ enabled: true, retentionDays: 14 })).rejects.toThrow('GM');
  expect(settings.set).not.toHaveBeenCalled();
  user.isGM = true;
  settings.set.mockImplementation(async () => {
    user.isGM = false;
  });
  await expect(saveOfflineEventPolicy({ enabled: true, retentionDays: 14 })).rejects.toThrow('GM');
});
it('rejects forged current-user identity and post-await purge demotion', async () => {
  (globalThis as any).game.user = { id: 'gm', isGM: true };
  const client = { purgeEvents: vi.fn(async () => 1) } as any;
  await expect(purgeOfflineEvents(client)).rejects.toThrow('GM');
  expect(client.purgeEvents).not.toHaveBeenCalled();
  (globalThis as any).game.user = user;
  client.purgeEvents.mockImplementation(async () => {
    user.isGM = false;
    return 2;
  });
  await expect(purgeOfflineEvents(client)).rejects.toThrow('GM');
});
