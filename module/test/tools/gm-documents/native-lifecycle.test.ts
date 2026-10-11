/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, expect, it, vi } from 'vitest';
import { discoverNativeFixtures, prepareNativeCleanup } from './native-lifecycle.js';
afterEach(() => vi.unstubAllGlobals());
it('settles late create/error and drains audit before sole-GM invalidation or cleanup', async () => {
  const events: string[] = [];
  let observed = false;
  await prepareNativeCleanup({
    settle: async () => {
      await Promise.resolve();
      events.push('late-create-error');
    },
    drain: async () => {
      observed = true;
      events.push('persisted');
    },
    assertNoReservation: async () => {
      events.push('reservation-clear');
    },
    invalidatePending: async () => {
      expect(observed).toBe(true);
      events.push('reload');
    },
    discover: async () => {
      events.push('discover');
    },
    remove: async () => {
      events.push('delete');
    },
  });
  expect(events).toEqual([
    'late-create-error',
    'persisted',
    'reservation-clear',
    'reload',
    'discover',
    'delete',
  ]);
});
it('a live human Undo reservation prevents reload/deletion after failure', async () => {
  const remove = vi.fn(),
    invalidatePending = vi.fn();
  await expect(
    prepareNativeCleanup({
      settle: async () => {},
      drain: async () => {},
      assertNoReservation: async () => {
        throw Error('human recovery required');
      },
      invalidatePending,
      discover: async () => {},
      remove,
    }),
  ).rejects.toThrow('human recovery');
  expect(remove).not.toHaveBeenCalled();
  expect(invalidatePending).not.toHaveBeenCalled();
});
it('discovers a failed nonce create and exact correlated imported Item without name-based Item cleanup', async () => {
  const actor = {
    uuid: 'Actor.a',
    name: 'ag-task23-current-npc',
    effects: { contents: [{ uuid: 'Actor.a.ActiveEffect.e', name: 'ag-task23-current-effect' }] },
  };
  const imported = { uuid: 'Item.returned', documentName: 'Item', name: 'Dagger', parent: null };
  const docs: any = {
    audit: {
      system: {
        tool: 'compendium_import',
        args: JSON.stringify({ uuid: 'Compendium.pf2e.equipment-srd.Item.rQWaJhI5Bko5x14Z' }),
        targets: [{ uuid: imported.uuid, existed: false }],
      },
    },
    [imported.uuid]: imported,
  };
  vi.stubGlobal('game', {
    actors: { contents: [actor, { uuid: 'Actor.other', name: 'other' }] },
    journal: { contents: [] },
  });
  vi.stubGlobal('fromUuid', async (uuid: string) => docs[uuid]);
  expect(
    await discoverNativeFixtures({ prefix: 'ag-task23-current', retained: ['audit'] }),
  ).toEqual(['Actor.a', 'Actor.a.ActiveEffect.e', 'Item.returned']);
  expect(await discoverNativeFixtures({ prefix: 'missing', retained: [] })).toEqual([]);
});

it('stops promptly without reload/delete if a native call cannot be proven terminal', async () => {
  const invalidatePending = vi.fn(),
    remove = vi.fn();
  await expect(
    prepareNativeCleanup({
      settle: () => new Promise(() => {}),
      settleTimeoutMs: 1,
      drain: async () => {},
      assertNoReservation: async () => {},
      invalidatePending,
      discover: async () => {},
      remove,
    }),
  ).rejects.toThrow('not terminal');
  expect(invalidatePending).not.toHaveBeenCalled();
  expect(remove).not.toHaveBeenCalled();
});
it('does no discovery, invalidation or deletion before a fixture baseline exists', async () => {
  const mutation = vi.fn();
  await prepareNativeCleanup({
    baselineCaptured: false,
    settle: mutation,
    drain: mutation,
    assertNoReservation: mutation,
    invalidatePending: mutation,
    discover: mutation,
    remove: mutation,
  });
  expect(mutation).not.toHaveBeenCalled();
});
