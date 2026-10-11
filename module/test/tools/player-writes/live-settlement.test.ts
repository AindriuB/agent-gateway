import { expect, it } from 'vitest';
import { settleLiveBatch, startLiveBatch } from './live-settlement.js';

it('waits for late successful creations and tracks their UUIDs before failure cleanup', async () => {
  let finishCreate!: (uuid: string) => void;
  const tracked: string[] = [];
  let cleanup: string[] | undefined;
  const lateCreate = new Promise<string>((resolve) => {
    finishCreate = resolve;
  }).then((uuid) => {
    tracked.push(uuid);
    return uuid;
  });
  const batch = settleLiveBatch([
    Promise.reject(Error('roll validation failed')),
    lateCreate,
  ]).catch((error) => {
    cleanup = [...tracked];
    return error;
  });
  await Promise.resolve();
  await Promise.resolve();
  expect(cleanup).toBeUndefined();
  finishCreate('ChatMessage.late');
  const error = await batch;
  expect(error).toBeInstanceOf(AggregateError);
  expect(cleanup).toEqual(['ChatMessage.late']);
  expect(error.errors).toHaveLength(1);
});

it('preserves input ordering after every successful call settles', async () => {
  expect(await settleLiveBatch([Promise.resolve('chat'), Promise.resolve('page')])).toEqual([
    'chat',
    'page',
  ]);
});

it('keeps cleanup behind a late creation when UI preparation throws before result is awaited', async () => {
  let finishCreate!: (uuid: string) => void;
  const tracked: string[] = [];
  let cleanup: string[] | undefined;
  const lateCreate = new Promise<string>((resolve) => {
    finishCreate = resolve;
  }).then((uuid) => {
    tracked.push(uuid);
    return uuid;
  });
  const batch = startLiveBatch([Promise.reject(Error('native call failed')), lateCreate]);
  const run = (async () => {
    try {
      throw Error('approval screenshot failed');
    } finally {
      await batch.settled;
      cleanup = [...tracked];
    }
  })().catch((error) => error);
  await Promise.resolve();
  await Promise.resolve();
  expect(cleanup).toBeUndefined();
  finishCreate('ChatMessage.late-after-ui-error');
  expect((await run).message).toBe('approval screenshot failed');
  expect(cleanup).toEqual(['ChatMessage.late-after-ui-error']);
});

it('waits for delayed append persistence before assertions or cleanup', async () => {
  const { waitForLiveAudit } = await import('./live-settlement.js');
  let ticks = 0;
  const rows = [{ key: 'chat' }, { key: 'roll' }, { key: 'create' }, { key: 'no-chat' }];
  let cleaned = false;
  const result = await waitForLiveAudit(
    async () => [...rows],
    [...rows.map((r) => r.key), 'append'],
    {
      now: () => ticks * 100,
      sleep: async () => {
        expect(cleaned).toBe(false);
        ticks++;
        if (ticks === 2) rows.push({ key: 'append' });
      },
    },
  );
  cleaned = true;
  expect(result).toHaveLength(5);
  expect(ticks).toBe(2);
});

it('reports a missing append after a bounded persistence wait rather than accepting partial audit', async () => {
  const { waitForLiveAudit } = await import('./live-settlement.js');
  let ticks = 0;
  await expect(
    waitForLiveAudit(async () => [{ key: 'chat' }], ['chat', 'append'], {
      now: () => ticks * 100,
      timeoutMs: 300,
      sleep: async () => {
        ticks++;
      },
    }),
  ).rejects.toThrow('append');
  expect(ticks).toBe(3);
});

it('projects the actual native agent and excludes prior identical fixture rows before correlation', async () => {
  const { readNativeAuditRows, liveAuditKey, waitForLiveAudit } =
    await import('./live-settlement.js');
  const args = {
    toChat: false,
    formula: '1d6 + 2',
    flavor: 'current-run: no-chat validation roll',
  };
  const oldArgs = { ...args, flavor: 'previous-run: no-chat validation roll' };
  const expected = liveAuditKey('player', 'paired-agent', 'roll_formula', args);
  const previous = {
    uuid: 'JournalEntry.audit.JournalEntryPage.old',
    system: {
      entryId: 'old-call',
      userId: 'player',
      agentId: 'paired-agent',
      tool: 'roll_formula',
      args: JSON.stringify(oldArgs),
    },
  };
  const current = {
    uuid: 'JournalEntry.audit.JournalEntryPage.new',
    system: { ...previous.system, entryId: 'current-call', args: JSON.stringify(args) },
  };
  const pages = [previous];
  const previousGame = (globalThis as { game?: unknown }).game;
  Object.assign(globalThis, {
    game: {
      settings: { get: () => 'audit' },
      journal: { get: () => ({ pages: { contents: pages } }) },
    },
  });
  try {
    const read = async () =>
      readNativeAuditRows([previous.uuid]).map((row) => ({
        ...row,
        key: liveAuditKey(row.userId, row.agentId, row.tool, JSON.parse(row.args)),
      }));
    expect(await read()).toEqual([]);
    pages.push({ ...previous, uuid: 'JournalEntry.audit.JournalEntryPage.late-previous' });
    expect((await read())[0]?.key).not.toBe(expected);
    let ticks = 0;
    const found = await waitForLiveAudit(read, [expected], {
      now: () => ticks * 100,
      sleep: async () => {
        ticks++;
        pages.push(current);
      },
    });
    expect(ticks).toBe(1);
    expect(found.find((row) => row.key === expected)).toMatchObject({
      agentId: 'paired-agent',
      entryId: 'current-call',
      uuid: current.uuid,
    });
    expect(liveAuditKey('player', 'other-agent', 'roll_formula', args)).not.toBe(expected);
  } finally {
    if (previousGame === undefined) delete (globalThis as { game?: unknown }).game;
    else Object.assign(globalThis, { game: previousGame });
  }
});
