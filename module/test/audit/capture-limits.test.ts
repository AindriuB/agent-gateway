/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from 'vitest';
import { AuditProtectedError } from '../../src/audit/guard.js';
import { pageData } from '../../src/audit/journal.js';
import { createAuditStage } from '../../src/audit/stage.js';
import { AUDIT_LIMITS as L, type AuditRecord } from '../../src/audit/types.js';
import { undoEntry } from '../../src/audit/undo.js';
import { AuditWitness } from '../../src/audit/witness.js';
import type { OpContext } from '../../src/ops/types.js';
import { reserveFixtureUndo, makeStore, record, target, writable } from './fake.js';

describe.each([true, false])('snapshot budget protection (GM client: %s)', (isGM) => {
  function rig() {
    const store = makeStore();
    const journal = store.add(writable('JournalEntry.audit', {}, 1, store));
    journal.flags = { 'agent-gateway': { auditJournal: true } };
    const page = store.add(writable('JournalEntry.audit.JournalEntryPage.page', {}, 1, store));
    page.parent = journal;
    for (let i = 0; i <= L.targets; i++) store.add(writable(`Actor.a${i}`, {}, 1, store));
    const records: AuditRecord[] = [];
    const stage = createAuditStage({
      categoryOf: () => 'write',
      isGM: () => isGM,
      fromUuid: store.fromUuid,
      requestIntent: async () => true,
      submit: async (r) => {
        records.push(r);
      },
    });
    const ctx: OpContext = {
      user: { id: 'u', isGM },
      agent: { id: 'a', ownerUserId: 'u', headless: false },
      sessionId: 's',
      tool: 'fixture_write',
      args: {},
    };
    const fill = async () => {
      for (let i = 0; i < L.targets; i++) await ctx.snapshot!(`Actor.a${i}`);
    };
    return { stage, ctx, journal, page, fill, records };
  }

  it.each(['journal', 'page'] as const)(
    'refuses a protected %s after the snapshot budget is exhausted',
    async (which) => {
      const { stage, ctx, journal, page, fill } = rig();
      const victim = which === 'journal' ? journal : page;
      const mutate = vi.fn();
      await expect(
        stage.run(ctx, async () => {
          await fill();
          await ctx.snapshot!(victim.uuid);
          mutate();
          return { text: 'changed audit log', structured: {} };
        }),
      ).rejects.toThrow(AuditProtectedError);
      expect(mutate).not.toHaveBeenCalled();
    },
  );

  it('still permits ordinary targets beyond the capture budget and counts them as dropped', async () => {
    const { stage, ctx, fill, records } = rig();
    await expect(
      stage.run(ctx, async () => {
        await fill();
        await ctx.snapshot!(`Actor.a${L.targets}`);
        return { text: 'ordinary write', structured: {} };
      }),
    ).resolves.toMatchObject({ text: 'ordinary write' });
    expect(records[0]!.targets).toHaveLength(L.targets);
    expect(records[0]!.targetsDropped).toBe(1);
  });
});

const fields = (start: number, count: number, value: number) =>
  Object.fromEntries(Array.from({ length: count }, (_, i) => [`f${start + i}`, value]));

describe('complete witnessed changed-path capture', () => {
  const scenarios = [
    {
      name: 'one flat update exceeds the limit',
      updates: [fields(0, L.changedPaths + 1, 1)],
      undoable: false,
    },
    {
      name: 'one nested update exceeds the limit',
      updates: [{ system: fields(0, L.changedPaths + 1, 1) }],
      undoable: false,
    },
    {
      name: 'the combined paths across updates exceed the limit',
      updates: [fields(0, 110, 1), fields(110, 100, 1)],
      undoable: false,
    },
    {
      name: 'exactly the capture limit is complete',
      updates: [fields(0, L.changedPaths, 1)],
      undoable: true,
    },
    {
      name: 'repeated paths across updates do not overflow',
      updates: [fields(0, L.changedPaths, 1), fields(0, 100, 2)],
      undoable: true,
    },
    {
      name: 'a key path is too long to retain completely',
      updates: [{ ['x'.repeat(L.changedPath + 1)]: 1 }],
      undoable: false,
    },
  ];

  it.each(scenarios)('$name', async ({ updates, undoable }) => {
    const store = makeStore();
    const doc = store.add(
      writable('Actor.a1', { ...fields(0, 210, 0), system: fields(0, 210, 0) }, 1, store),
    );
    const witness = new AuditWitness({
      fromUuid: store.fromUuid,
      now: () => 1,
      grace: async () => {},
    });
    const callId = 'call-path001';
    await witness.onIntent({ callId, uuid: doc.uuid }, 'p1');
    for (const update of updates) {
      Object.assign(doc.data, update);
      doc._stats.modifiedTime++;
      witness.onUpdate(doc, update, { agentGateway: { callId } }, 'p1');
    }
    const final = await witness.assemble(
      record({ entryId: callId, relayed: true, targets: [target()] }),
      'p1',
    );
    const captured = final.targets[0]!;
    expect(captured.undoable).toBe(undoable);
    if (!undoable) {
      expect(captured.note).toContain('capture limit');
      expect(captured.changedPaths).toEqual([]);
    } else {
      expect(captured.changedPaths).toHaveLength(L.changedPaths);
    }
    const data = pageData(final) as any;
    const page = { id: 'page', system: data.system, update: vi.fn() };
    const outcome = await undoEntry(page, async () => true, {
      reserve: reserveFixtureUndo,
      isGM: () => true,
      userId: () => 'gm1',
      fromUuid: store.fromUuid,
      canModify: () => true,
      canCreate: () => true,
      now: () => 10,
    });
    expect(outcome.restored).toBe(undoable ? 1 : 0);
    expect(doc.calls.update).toHaveLength(undoable ? 1 : 0);
    if (undoable) expect(Object.keys(doc.calls.update[0]!.data)).toHaveLength(L.changedPaths);
  });
});
